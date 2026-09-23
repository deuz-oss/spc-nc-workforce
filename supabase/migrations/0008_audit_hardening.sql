-- Audit hardening pass — security, data-integrity, and "feature silently
-- doesn't work" fixes found in a full code audit after 0001-0007 were applied
-- to the live project. Purely additive/replacing (drop + recreate policies and
-- functions); safe to run once after 0007_phase4_messaging.sql.
--
-- Summary (each section below explains its own why):
--   1. Self-signup privilege escalation: handle_new_auth_user trusted the
--      user-writable raw_user_meta_data for `role`, so anyone holding the
--      public anon key could supabase.auth.signUp({ data: { role:
--      'super_admin' } }) and get a super_admin profile. New profiles now start
--      INACTIVE; only the admin-users edge function / seed script (service
--      role) activate them. current_role()/current_team_id() ignore inactive
--      profiles, which also closes the "deactivated user keeps full RLS rights
--      until their JWT expires" gap.
--   2. profiles_select: NCs could not see their own TL's profile (and TLs
--      could not see their ARCO's), so ChatListScreen always showed "no Team
--      Leader" and NC<->TL / TL<->ARCO chat could never be opened.
--   3. consumers_select: (a) a freshly created consumer was invisible to the
--      NC who created it until an ntg_gwp row linked it, which also broke
--      upsert; (b) reckitt_client (a monitor role) could read every
--      consumer's name + WhatsApp number straight from the API — the
--      "structural" PII hiding existed only in the UI.
--   4. Report tables / ntg_gwp / visits: `for all` write policies let an NC
--      UPDATE or DELETE their own submitted reports and visits after the
--      fact (e.g. flip geo_valid to true, delete an approved report, edit
--      counts after TL review), and attribute a report to a store other than
--      the visit's store. Now insert-only, with store consistency checked.
--   5. finish_visit: always stamped now() — an offline check-out replayed
--      hours later recorded the replay time, inflating visit duration/CFT —
--      and raised on a second call, so a replay of an already-applied
--      check-out could never leave the offline queue.
--   6. attendances: an NC could rewrite clock_in_at / geo_fence_ok on their
--      open attendance row. Immutable columns are now guarded.
--   7. messages: there was no UPDATE policy, so markMessagesRead silently
--      updated 0 rows and "unread" badges never cleared. Scoped RPC added.
--   8. conversations_insert: any user could open a conversation with any
--      other user. Now restricted to the NC<->TL / TL<->ARCO pairs PRD §17
--      defines.
--   9. compute_scorecards: day/month boundaries were computed in UTC, so
--      anything logged 00:00-07:00 WIB landed in the previous day/month.
--  10. Storage: NCs could delete their own report evidence photos after
--      submission (report_media_delete). Evidence is now append-only.
--
-- ALSO REQUIRED (dashboard setting, not SQL): Authentication -> Providers ->
-- Email -> disable "Allow new users to sign up". Section 1 makes self-signup
-- harmless, but there is no reason to leave it enabled.

-- =========================================================
-- 1. Provisioning + role helpers
-- =========================================================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Profile starts inactive regardless of metadata: raw_user_meta_data is
  -- writable by the signing-up user, so it can never be trusted to grant a
  -- working account. The admin-users edge function and the seed script
  -- (both service role) set role/team explicitly and flip active=true.
  insert into public.profiles (id, name, username, role, team_id, city, phone, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'username', new.email),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'nc'),
    null,
    new.raw_user_meta_data->>'city',
    new.raw_user_meta_data->>'phone',
    false
  );
  return new;
end;
$$;

create or replace function public.current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.current_team_id() returns text
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid() and active
$$;

-- =========================================================
-- 2. profiles_select — let an NC/TL see their own team's TL and ARCO
-- =========================================================
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
using (
  id = auth.uid()
  or public.is_monitor_role()
  or (public.current_role() = 'tl' and active and team_id = public.current_team_id())
  or (public.current_role() = 'arco' and active and team_id in (select public.current_arco_team_ids()))
  or (public.current_role() in ('nc','tl') and id in (
        select t.tl_id from public.teams t where t.id = public.current_team_id()
        union
        select t.arco_id from public.teams t where t.id = public.current_team_id()
      ))
);

-- =========================================================
-- 3. consumers_select — creator + creator's TL/ARCO + monitor roles except Reckitt
-- =========================================================
drop policy if exists consumers_select on public.consumers;
create policy consumers_select on public.consumers for select
using (
  (public.is_monitor_role() and public.current_role() <> 'reckitt_client')
  or created_by_nc_id = auth.uid()
  or (public.current_role() = 'tl'
      and created_by_nc_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco'
      and created_by_nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
  or (public.current_role() in ('nc','tl','arco')
      and exists (select 1 from public.ntg_gwp g
                  where g.consumer_id = consumers.id and public.visit_is_own_or_scoped(g.visit_id)))
);

-- =========================================================
-- 4. Insert-only report / visit writes, store-consistent
-- =========================================================
create or replace function public.visit_is_own_for_store(v_visit_id text, v_store_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.visits v
    where v.id = v_visit_id and v.nc_id = auth.uid() and v.store_id = v_store_id
  )
$$;

drop policy if exists stock_taking_write on public.stock_taking;
create policy stock_taking_insert on public.stock_taking for insert
with check (public.visit_is_own_for_store(visit_id, store_id));

drop policy if exists share_of_shelf_write on public.share_of_shelf;
create policy share_of_shelf_insert on public.share_of_shelf for insert
with check (public.visit_is_own_for_store(visit_id, store_id));

drop policy if exists offtake_write on public.offtake;
create policy offtake_insert on public.offtake for insert
with check (public.visit_is_own_for_store(visit_id, store_id));

drop policy if exists paid_visibility_write on public.paid_visibility;
create policy paid_visibility_insert on public.paid_visibility for insert
with check (public.visit_is_own_for_store(visit_id, store_id));

drop policy if exists price_monitoring_write on public.price_monitoring;
create policy price_monitoring_insert on public.price_monitoring for insert
with check (public.visit_is_own_for_store(visit_id, store_id));

drop policy if exists ntg_gwp_write on public.ntg_gwp;
create policy ntg_gwp_insert on public.ntg_gwp for insert
with check (public.visit_is_own(visit_id));

-- Visits: NC inserts their own open visit; closing goes through finish_visit.
drop policy if exists visits_write_own on public.visits;
create policy visits_insert_own on public.visits for insert
with check (nc_id = auth.uid() and public.current_role() = 'nc' and check_out_at is null);

-- Field roles only (ClockCard is shown to nc/tl/arco).
drop policy if exists attendances_insert_own on public.attendances;
create policy attendances_insert_own on public.attendances for insert
with check (user_id = auth.uid() and public.current_role() in ('nc','tl','arco'));

drop policy if exists survey_responses_insert on public.survey_responses;
create policy survey_responses_insert on public.survey_responses for insert
with check (public.current_role() = 'nc' and (visit_id is null or public.visit_is_own(visit_id)));

-- =========================================================
-- 5. finish_visit — honors the offline check-out time, idempotent
-- =========================================================
drop function if exists public.finish_visit(text);
create or replace function public.finish_visit(p_visit_id text, p_check_out_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.visits%rowtype;
begin
  select * into v from public.visits where id = p_visit_id and nc_id = auth.uid();
  if not found then
    raise exception 'visit not found or not owned by caller';
  end if;
  if v.check_out_at is not null then
    return; -- already closed (e.g. offline replay of a check-out that already landed)
  end if;
  update public.visits
     set check_out_at = greatest(v.check_in_at, least(coalesce(p_check_out_at, now()), now()))
   where id = p_visit_id;
end;
$$;

grant execute on function public.finish_visit(text, timestamptz) to authenticated;

-- =========================================================
-- 6. attendances — clock-in facts are immutable for end users
-- =========================================================
create or replace function public.attendances_guard_update()
returns trigger
language plpgsql
as $$
begin
  -- auth.uid() is null for service-role/admin maintenance — allowed through.
  if auth.uid() is not null then
    if new.user_id is distinct from old.user_id
       or new.clock_in_at is distinct from old.clock_in_at
       or new.clock_in_lat is distinct from old.clock_in_lat
       or new.clock_in_lng is distinct from old.clock_in_lng
       or new.geo_fence_ok is distinct from old.geo_fence_ok then
      raise exception 'clock-in fields are immutable';
    end if;
    if new.clock_out_at is not null
       and (new.clock_out_at < old.clock_in_at or new.clock_out_at > now() + interval '5 minutes') then
      raise exception 'clock_out_at out of range';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists attendances_guard_update_trg on public.attendances;
create trigger attendances_guard_update_trg
  before update on public.attendances
  for each row execute function public.attendances_guard_update();

-- =========================================================
-- 7. messages — scoped read-receipt RPC
-- =========================================================
create or replace function public.mark_messages_read(p_conversation_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages m
     set read_at = now()
   where m.conversation_id = p_conversation_id
     and m.sender_id <> auth.uid()
     and m.read_at is null
     and exists (
       select 1 from public.conversations c
       where c.id = p_conversation_id and (c.participant_a = auth.uid() or c.participant_b = auth.uid())
     );
$$;

grant execute on function public.mark_messages_read(text) to authenticated;

-- =========================================================
-- 8. conversations — only the PRD §17 pairings
-- =========================================================
create or replace function public.can_converse(p_type text, p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_type
    when 'nc_tl' then exists (
      select 1 from public.profiles n, public.profiles l
      where n.role = 'nc' and l.role = 'tl' and n.active and l.active
        and n.id in (p_a, p_b) and l.id in (p_a, p_b) and n.id <> l.id
        and (n.team_id = l.team_id
             or exists (select 1 from public.teams t where t.id = n.team_id and t.tl_id = l.id))
    )
    when 'tl_arco' then exists (
      select 1 from public.profiles l, public.profiles r
      where l.role = 'tl' and r.role = 'arco' and l.active and r.active
        and l.id in (p_a, p_b) and r.id in (p_a, p_b) and l.id <> r.id
        and exists (select 1 from public.teams t where t.arco_id = r.id and (t.id = l.team_id or t.tl_id = l.id))
    )
    else false
  end
$$;

drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations for insert
with check (
  (participant_a = auth.uid() or participant_b = auth.uid())
  and public.can_converse(type, participant_a, participant_b)
);

-- =========================================================
-- 9. Scorecards in local (WIB) time
-- =========================================================
alter function public.compute_scorecards(text) set timezone to 'Asia/Jakarta';

-- =========================================================
-- 10. Report evidence is append-only
-- =========================================================
drop policy if exists report_media_delete on storage.objects;
