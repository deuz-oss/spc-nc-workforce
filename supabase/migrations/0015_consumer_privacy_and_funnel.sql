-- Consumer funnel integrity, consent records, client-side PII limits, push
-- tokens. Run after 0014_server_side_field_checks.sql.
--
-- 1. NTG FUNNEL. Steps could be recorded in any order (approached → gwp_given
--    straight away, or back to an earlier stage), and one mother could be
--    registered by several NCs — each counted as a "new user". Now:
--    a. a consumer's stages only move forward, never repeat;
--    b. gwp_given / wa_followup_scheduled only after ntg_confirmed;
--    c. WhatsApp numbers are normalized (wa_normalized, 62…), must look like an
--       Indonesian mobile number, and can't be registered twice.
--
-- 2. CONSENT (UU PDP). consent was a bare boolean. The server now records when
--    it was given, by which NC, and against which version of the consent text
--    (consent_at / consent_by / consent_version — not client-settable). A
--    consumer can't be created without consent. erase_consumer() implements
--    the data subject's deletion request: personal fields are blanked, quiz
--    answers wiped, the funnel rows (no personal data) stay for program counts.
--
-- 3. RECKITT (client) VIEW. "Reckitt sees no PII" held only for consumers. Via
--    the API it could also read every staff member's phone number and push
--    token (profiles), every NC's GPS trail (route_points, live_positions) and
--    consumer-linked quiz answers (survey_responses). Now:
--    a. phone numbers live in profile_contacts (own, super_admin, PM, and the
--       person's TL/ARCO only). profiles.phone stays as a write-only inlet so
--       older app builds and the provisioning trigger keep working: a trigger
--       moves any value written there into profile_contacts.
--    b. route_points and live_positions() exclude reckitt_client;
--    c. reckitt_client reads only survey responses not tied to a consumer.
--
-- 4. PUSH TOKENS move to push_tokens, which no client can read (anyone who can
--    read an Expo push token can send that phone notifications). A token
--    belongs to one device and the user last signed in on it — set_my_push_token
--    re-assigns it — so a shared phone no longer receives the previous user's
--    chat messages. clear_my_push_token() is called at logout. Requires the
--    updated send-push edge function (redeploy it with this migration).

-- =========================================================
-- 1. Funnel progression + WhatsApp numbers
-- =========================================================
create or replace function public.ntg_stage_rank(p text) returns int
language sql immutable as $$
  select array_position(
    array['approached','quiz_completed','consultation_delivered','ntg_confirmed','gwp_given','wa_followup_scheduled'], p)
$$;

create or replace function public.ntg_gwp_progression_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur int;
  nxt int := public.ntg_stage_rank(new.stage);
begin
  select max(public.ntg_stage_rank(g.stage)) into cur
    from public.ntg_gwp g
   where g.consumer_id = new.consumer_id and g.id <> new.id;
  if cur is not null and nxt <= cur then
    raise exception 'Tahap funnel tidak boleh mundur atau diulang.';
  end if;
  if nxt > public.ntg_stage_rank('ntg_confirmed') and coalesce(cur, 0) < public.ntg_stage_rank('ntg_confirmed') then
    raise exception 'GWP dan follow-up WA hanya bisa dicatat setelah NTG terkonfirmasi.';
  end if;
  return new;
end;
$$;

drop trigger if exists ntg_gwp_progression_check_trg on public.ntg_gwp;
create trigger ntg_gwp_progression_check_trg
  before insert on public.ntg_gwp
  for each row execute function public.ntg_gwp_progression_check();

-- '0812-3456 789' / '+62 812…' / '812…' → '62812…'. Must match normalizeWa in src/utils/wa.ts.
create or replace function public.normalize_wa(p text) returns text
language sql immutable as $$
  select case
    when d = '' then ''
    when d like '62%' then d
    when d like '0%' then '62' || substr(d, 2)
    when d like '8%' then '62' || d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

alter table public.consumers
  add column if not exists wa_normalized text generated always as (public.normalize_wa(wa_contact)) stored;
create index if not exists consumers_wa_normalized_idx on public.consumers (wa_normalized);

-- =========================================================
-- 2. Consent record + erasure
-- =========================================================
alter table public.consumers add column if not exists consent_at timestamptz;
alter table public.consumers add column if not exists consent_version text;
alter table public.consumers add column if not exists consent_by uuid references public.profiles(id);
alter table public.consumers add column if not exists erased_at timestamptz;

create or replace function public.consumers_server_checks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wa text := public.normalize_wa(new.wa_contact);
begin
  -- WhatsApp number: validated and unique whenever it is set or changed.
  if new.erased_at is null and (tg_op = 'INSERT' or new.wa_contact is distinct from old.wa_contact) then
    if wa !~ '^628[0-9]{7,12}$' then
      raise exception 'Nomor WhatsApp tidak valid — gunakan nomor HP Indonesia, mis. 0812xxxxxxxx.';
    end if;
    if exists (select 1 from public.consumers c
                where c.wa_normalized = wa and c.id <> new.id and c.erased_at is null) then
      raise exception 'Nomor WhatsApp ini sudah terdaftar sebagai konsumen (oleh Anda atau NC lain).';
    end if;
  end if;

  -- Consent: required to create; its record is server-stamped and immutable.
  if tg_op = 'INSERT' and not new.consent then
    raise exception 'Consent konsumen wajib sebelum data disimpan (UU PDP).';
  end if;
  if tg_op = 'UPDATE' and old.consent and new.consent then
    new.consent_at := old.consent_at;
    new.consent_by := old.consent_by;
    new.consent_version := old.consent_version;
  elsif new.consent and (tg_op = 'INSERT' or not old.consent) then
    new.consent_at := now();
    new.consent_by := auth.uid();
    -- Builds from before this migration don't send a version.
    new.consent_version := coalesce(nullif(new.consent_version, ''), 'unversioned');
  end if;
  return new;
end;
$$;

drop trigger if exists consumers_server_checks_trg on public.consumers;
create trigger consumers_server_checks_trg
  before insert or update on public.consumers
  for each row execute function public.consumers_server_checks();

-- Data subject deletion request (UU PDP): blank the personal data, keep the
-- consumer id + funnel rows so program totals don't change.
create or replace function public.erase_consumer(p_consumer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.consumers c
     where c.id = p_consumer_id
       and (c.created_by_nc_id = auth.uid() or public.current_role() in ('super_admin', 'pm'))
  ) then
    raise exception 'Tidak diizinkan menghapus data konsumen ini.';
  end if;
  update public.consumers
     set name = '(data dihapus)', wa_contact = '', current_brand = null, quiz_result = null,
         child_age_bracket = null, consent = false, erased_at = now()
   where id = p_consumer_id and erased_at is null;
  update public.survey_responses set answers = '{}'::jsonb where consumer_id = p_consumer_id;
end;
$$;

revoke execute on function public.erase_consumer(text) from public, anon;
grant execute on function public.erase_consumer(text) to authenticated;

-- =========================================================
-- 3a. Staff phone numbers out of profiles
-- =========================================================
create table if not exists public.profile_contacts (
  -- Deferred: the provisioning trigger writes the contact while the profiles
  -- row is still being inserted.
  user_id    uuid primary key references public.profiles(id) on delete cascade deferrable initially deferred,
  phone      text,
  updated_at timestamptz not null default now()
);

alter table public.profile_contacts enable row level security;
drop policy if exists profile_contacts_select on public.profile_contacts;
create policy profile_contacts_select on public.profile_contacts for select
using (
  user_id = auth.uid()
  or public.current_role() in ('super_admin', 'pm')
  or (public.current_role() = 'tl'
      and user_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco'
      and user_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
);
-- No client write policy: written only through profiles.phone (trigger below).

create or replace function public.profiles_move_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is not null then
    insert into public.profile_contacts (user_id, phone, updated_at)
    values (new.id, nullif(trim(new.phone), ''), now())
    on conflict (user_id) do update set phone = excluded.phone, updated_at = now();
    new.phone := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_move_phone_trg on public.profiles;
create trigger profiles_move_phone_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_move_phone();

update public.profiles set phone = phone where phone is not null; -- moves (and blanks) existing values

-- =========================================================
-- 3b. No GPS trail / live positions for the client role
-- =========================================================
drop policy if exists route_points_select on public.route_points;
create policy route_points_select on public.route_points for select
using (
  (public.is_monitor_role() and public.current_role() <> 'reckitt_client')
  or (public.current_role() = 'tl'
      and user_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco'
      and user_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
  or user_id = auth.uid()
);

create or replace function public.live_positions()
returns table (
  user_id uuid,
  attendance_id text,
  lat double precision,
  lng double precision,
  recorded_at timestamptz,
  clock_in_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select a.user_id,
         a.id,
         coalesce(rp.lat, a.clock_in_lat),
         coalesce(rp.lng, a.clock_in_lng),
         coalesce(rp.recorded_at, a.clock_in_at),
         a.clock_in_at
    from public.attendances a
    left join lateral (
      select p.lat, p.lng, p.recorded_at
        from public.route_points p
       where p.attendance_id = a.id
       order by p.recorded_at desc
       limit 1
    ) rp on true
   where a.clock_out_at is null
     and a.clock_in_at > now() - interval '24 hours'
     and a.user_id <> auth.uid()
     -- attendances stay readable for the client's KPIs, but not as a live tracker
     and coalesce(public.current_role(), '') <> 'reckitt_client'
$$;

-- =========================================================
-- 3c. Consumer-linked quiz answers hidden from the client role
-- =========================================================
drop policy if exists survey_responses_select on public.survey_responses;
create policy survey_responses_select on public.survey_responses for select
using (
  case
    when public.current_role() = 'reckitt_client' then consumer_id is null
    else public.is_monitor_role() or (visit_id is not null and public.visit_is_own_or_scoped(visit_id))
  end
);

-- =========================================================
-- 4. Push tokens
-- =========================================================
create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
-- No policies at all: only the RPCs below and the send-push function (service role) touch it.

insert into public.push_tokens (token, user_id)
select push_token, id from public.profiles where push_token is not null
on conflict (token) do nothing;

alter table public.profiles drop column if exists push_token;

create or replace function public.set_my_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(p_token, '') = '' then
    return;
  end if;
  insert into public.push_tokens (token, user_id, updated_at)
  values (p_token, auth.uid(), now())
  on conflict (token) do update set user_id = excluded.user_id, updated_at = now();
end;
$$;

create or replace function public.clear_my_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke execute on function public.set_my_push_token(text) from public, anon;
revoke execute on function public.clear_my_push_token(text) from public, anon;
grant execute on function public.set_my_push_token(text) to authenticated;
grant execute on function public.clear_my_push_token(text) to authenticated;
