-- Admin audit log, offtake outlier window, auto-closing forgotten sessions.
-- Run after 0015_consumer_privacy_and_funnel.sql (needs pg_cron, enabled by 0010).
--
-- 1. AUDIT LOG. Nothing recorded who changed a role, deactivated an account,
--    moved a store's GPS pin (which decides geo-validity) or changed a target.
--    admin_audit_log now records those changes with the acting user, via
--    triggers for client writes and explicitly from the admin-users edge
--    function (account creation, password reset — service-role writes the
--    triggers can't attribute). Readable by super_admin and PM only; nobody can
--    write or edit it through the API.
--
-- 2. OFFTAKE OUTLIER (0003). The trailing 7-day window was anchored on now()
--    — the time the row reached the server — not on when the offtake was
--    recorded, so a report synced late from an offline phone was compared with
--    the wrong week; and "previous days" were cut at UTC midnight (07:00 WIB).
--    Both now use the row's own created_at, in WIB.
--
-- 3. FORGOTTEN SESSIONS. An attendance or store visit that was never closed
--    stayed open forever: working hours kept growing, the NC couldn't check in
--    anywhere else, and GPS kept recording. An hourly job now closes
--      - visits still open while their attendance is closed (at the clock-out),
--      - visits open longer than 12 hours,
--      - attendances open longer than 16 hours,
--    at the last moment there is evidence the person was working (last report /
--    route point / visit), never "now". They are marked auto_closed so KPIs and
--    reviewers can tell, and a real clock-out / check-out that arrives later
--    (an offline phone syncing) still replaces the estimate.

-- =========================================================
-- 1. Audit log
-- =========================================================
create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   text,
  details     jsonb not null default '{}'
);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);

alter table public.admin_audit_log enable row level security;
drop policy if exists admin_audit_log_select on public.admin_audit_log;
create policy admin_audit_log_select on public.admin_audit_log for select
using (public.current_role() in ('super_admin', 'pm'));
-- No insert/update/delete policy: written only by the triggers below
-- (security definer) and the admin-users function (service role).

-- Records which of `cols` changed between old and new (both jsonb rows).
create or replace function public.audit_changes(p_old jsonb, p_new jsonb, cols text[])
returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(c, jsonb_build_object('from', p_old -> c, 'to', p_new -> c)), '{}'::jsonb)
    from unnest(cols) c
   where (p_old -> c) is distinct from (p_new -> c)
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cols text[] := tg_argv::text[];
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  changes jsonb;
begin
  -- Service-role / scheduled writes have no auth.uid(): the admin-users
  -- function logs its own actions; maintenance jobs aren't admin actions.
  if auth.uid() is null then
    return null;
  end if;
  changes := case tg_op
    when 'UPDATE' then public.audit_changes(o, n, cols)
    when 'INSERT' then public.audit_changes('{}'::jsonb, n, cols)
    else public.audit_changes(o, '{}'::jsonb, cols)
  end;
  if changes = '{}'::jsonb then
    return null; -- none of the audited columns changed
  end if;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name,
          coalesce(n ->> 'id', o ->> 'id'), changes);
  return null;
end;
$$;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after update on public.profiles
  for each row execute function public.audit_row_change('role', 'team_id', 'active', 'name');

drop trigger if exists teams_audit on public.teams;
create trigger teams_audit after insert or update or delete on public.teams
  for each row execute function public.audit_row_change('name', 'city', 'tl_id', 'arco_id', 'base_lat', 'base_lng', 'base_radius_m');

drop trigger if exists stores_audit on public.stores;
create trigger stores_audit after update on public.stores
  for each row execute function public.audit_row_change('assigned_nc_id', 'team_id', 'lat', 'lng', 'archived');

drop trigger if exists targets_audit on public.targets;
create trigger targets_audit after insert or update or delete on public.targets
  for each row execute function public.audit_row_change('nc_id', 'period_key', 'offtake_target', 'gwp_allocation');

drop trigger if exists report_reviews_audit on public.report_reviews;
create trigger report_reviews_audit after insert or update on public.report_reviews
  for each row execute function public.audit_row_change('status', 'note');

drop trigger if exists consumers_audit on public.consumers;
create trigger consumers_audit after update on public.consumers
  for each row execute function public.audit_row_change('erased_at');

drop trigger if exists scorecard_weight_config_audit on public.scorecard_weight_config;
create trigger scorecard_weight_config_audit after insert or update or delete on public.scorecard_weight_config
  for each row execute function public.audit_row_change('role', 'kpi_key', 'weight_pct');

-- =========================================================
-- 2. Offtake outlier relative to the row's own time, in WIB
-- =========================================================
create or replace function public.offtake_flag_outlier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nc_id uuid;
  v_avg   numeric;
  v_days  int;
  v_day   date := (new.created_at at time zone 'Asia/Jakarta')::date;
begin
  select nc_id into v_nc_id from public.visits where id = new.visit_id;

  -- Trailing 7 WIB calendar days before the row's own day.
  select avg(o.units_sold), count(distinct (o.created_at at time zone 'Asia/Jakarta')::date)
    into v_avg, v_days
  from public.offtake o
  join public.visits v on v.id = o.visit_id
  where v.nc_id = v_nc_id
    and o.sku = new.sku
    and o.id <> new.id
    and (o.created_at at time zone 'Asia/Jakarta')::date >= v_day - 7
    and (o.created_at at time zone 'Asia/Jakarta')::date < v_day;

  -- Need at least 1 prior day of history before an average means anything.
  new.is_outlier := v_days is not null and v_days >= 1 and v_avg is not null and new.units_sold > 3 * v_avg;
  return new;
end;
$$;

-- =========================================================
-- 3. Auto-close forgotten visits / attendances
-- =========================================================
alter table public.visits add column if not exists auto_closed boolean not null default false;
alter table public.attendances add column if not exists auto_closed boolean not null default false;

-- Must match AUTO_CLOSE_* in src/config.ts.
create or replace function public.auto_close_visit_after() returns interval
language sql immutable as $$ select interval '12 hours' $$;
create or replace function public.auto_close_attendance_after() returns interval
language sql immutable as $$ select interval '16 hours' $$;

-- Last moment there is evidence of work inside a visit.
create or replace function public.visit_last_activity(p_visit_id text) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(
    v.check_in_at,
    (select max(created_at) from public.stock_taking where visit_id = v.id),
    (select max(created_at) from public.offtake where visit_id = v.id),
    (select max(created_at) from public.share_of_shelf where visit_id = v.id),
    (select max(created_at) from public.paid_visibility where visit_id = v.id),
    (select max(created_at) from public.price_monitoring where visit_id = v.id),
    (select max(created_at) from public.ntg_gwp where visit_id = v.id)
  )
  from public.visits v where v.id = p_visit_id
$$;

create or replace function public.auto_close_stale_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- a. Visits left open after their attendance was closed.
  update public.visits v
     set check_out_at = greatest(v.check_in_at, least(public.visit_last_activity(v.id), a.clock_out_at)),
         auto_closed = true
    from public.attendances a
   where v.check_out_at is null
     and a.user_id = v.nc_id
     and a.clock_out_at is not null
     and v.check_in_at >= a.clock_in_at
     and v.check_in_at <= a.clock_out_at;

  -- b. Visits open too long.
  update public.visits v
     set check_out_at = public.visit_last_activity(v.id),
         auto_closed = true
   where v.check_out_at is null
     and v.check_in_at < now() - public.auto_close_visit_after();

  -- c. Attendances open too long — closed at the last route point / visit of
  --    THIS session: visits before the user's next clock-in, and never later
  --    than the auto-close limit itself.
  update public.attendances a
     set clock_out_at = least(
           a.clock_in_at + public.auto_close_attendance_after(),
           greatest(
             a.clock_in_at,
             (select max(p.recorded_at) from public.route_points p where p.attendance_id = a.id),
             (select max(coalesce(v.check_out_at, v.check_in_at)) from public.visits v
               where v.nc_id = a.user_id
                 and v.check_in_at >= a.clock_in_at
                 and v.check_in_at < coalesce(
                       (select min(a2.clock_in_at) from public.attendances a2
                         where a2.user_id = a.user_id and a2.clock_in_at > a.clock_in_at),
                       'infinity'::timestamptz))
           )
         ),
         auto_closed = true
   where a.clock_out_at is null
     and a.clock_in_at < now() - public.auto_close_attendance_after();
end;
$$;

revoke execute on function public.auto_close_stale_sessions() from public, anon, authenticated;
revoke execute on function public.visit_last_activity(text) from public, anon, authenticated;
-- Ops / smoke test can run it on demand with the service role.
grant execute on function public.auto_close_stale_sessions() to service_role;
grant execute on function public.visit_last_activity(text) to service_role;

select cron.schedule('auto-close-stale-sessions', '7 * * * *', 'select public.auto_close_stale_sessions()');

-- A real clock-out / check-out arriving after the job (an offline phone
-- syncing) replaces the estimate instead of being silently dropped.
drop policy if exists attendances_update_own on public.attendances;
create policy attendances_update_own on public.attendances for update
using (user_id = auth.uid() and (clock_out_at is null or auto_closed))
with check (user_id = auth.uid());

create or replace function public.attendances_clear_auto_closed()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and new.clock_out_at is distinct from old.clock_out_at then
    new.auto_closed := false;
  end if;
  return new;
end;
$$;

drop trigger if exists attendances_clear_auto_closed_trg on public.attendances;
create trigger attendances_clear_auto_closed_trg
  before update on public.attendances
  for each row execute function public.attendances_clear_auto_closed();

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
  if v.check_out_at is not null and not v.auto_closed then
    return; -- already closed by the NC (e.g. offline replay of a check-out that already landed)
  end if;
  update public.visits
     set check_out_at = greatest(v.check_in_at, least(coalesce(p_check_out_at, now()), now())),
         auto_closed = false
   where id = p_visit_id;
end;
$$;

-- An auto-closed end time is an estimate, so it must not be used to refuse
-- work that a phone recorded offline and syncs afterwards (0014's checks).
create or replace function public.visits_server_checks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  if auth.uid() is null then
    return new;
  end if;
  new.created_at := now();
  if new.check_in_at > now() + interval '5 minutes' or new.check_in_at < now() - public.max_offline_age() then
    raise exception 'Waktu check-in di luar batas yang diizinkan — periksa tanggal & jam HP.';
  end if;
  if not exists (
    select 1 from public.attendances a
     where a.user_id = new.nc_id
       and a.clock_in_at <= new.check_in_at + interval '1 minute'
       and (a.clock_out_at is null or a.auto_closed or new.check_in_at <= a.clock_out_at)
  ) then
    raise exception 'Check-in toko harus dilakukan selama sesi absensi (clock-in dulu).';
  end if;

  select lat, lng into s from public.stores where id = new.store_id;
  if s.lat is null or s.lng is null then
    new.store_distance_m := null;
    new.geo_valid := false;
  else
    new.store_distance_m := round(public.haversine_m(s.lat, s.lng, new.lat, new.lng)::numeric);
    new.geo_valid := not new.location_mocked and new.store_distance_m <= public.visit_valid_radius_m();
  end if;
  return new;
end;
$$;

create or replace function public.report_server_checks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  new.received_at := now();
  if auth.uid() is null then
    return new;
  end if;
  select check_in_at, check_out_at, auto_closed into v from public.visits where id = new.visit_id;
  if not found then
    return new;
  end if;
  if new.created_at > now() + interval '5 minutes'
     or new.created_at < v.check_in_at - interval '1 minute'
     or (v.check_out_at is not null and not v.auto_closed and new.created_at > v.check_out_at + interval '1 minute') then
    raise exception 'Laporan hanya bisa dibuat selama kunjungan berlangsung (antara check-in dan check-out).';
  end if;
  return new;
end;
$$;
