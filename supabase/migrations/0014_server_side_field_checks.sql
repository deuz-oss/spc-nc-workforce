-- Server-side checks for field data the app used to be trusted with. Run after
-- 0013_route_buffer_and_report_dedup.sql.
--
-- 1. GEOFENCE. visits.geo_valid / store_distance_m and attendances.geo_fence_ok
--    were computed on the phone and stored as sent — any modified client could
--    claim "in the store". They are now computed here from the stored store pin
--    / team home-base pin; whatever the client sends is overwritten. A location
--    the phone reports as mocked (fake-GPS app, Android) is never geo-valid.
--    Clock-in geofence: teams get an optional home-base pin + radius; a team
--    without one can't be checked, so its clock-ins stay geo_fence_ok = true.
--
-- 2. TIMESTAMPS. Times are client-minted (offline work must keep its real
--    time), but now bounded: never in the future, never older than the
--    offline window (7 days); a store check-in must fall inside one of the
--    NC's attendance sessions; a report / NTG step must fall inside its visit
--    (no reports after check-out, no backdating into an older visit).
--    Reports also get received_at (server time, client can't set it) so a
--    report synced long after it was made — offline, or a phone with its clock
--    set back — is visible to the reviewer. visits/attendances already have a
--    server created_at, now enforced the same way.
--
-- 3. UNDER-1 RULE (PRD §6, PP 33/2012). A consumer whose child is under one
--    year old must never advance past "approached" (no NTG, no GWP, no
--    follow-up) — this was enforced only inside the Nutrition Quiz screen.
--    consumers.child_age_bracket is also restricted to the app's bracket keys
--    (src/config.ts CHILD_AGE_BRACKETS) — it was free text, which a rule like
--    this can't read. Existing rows are untouched unless the bracket is changed.

-- =========================================================
-- Shared helpers
-- =========================================================
create or replace function public.haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Must match VISIT_VALID_RADIUS_M in src/config.ts.
create or replace function public.visit_valid_radius_m() returns double precision
language sql immutable as $$ select 300::double precision $$;

-- How long a phone may hold work offline before it's refused as too old.
create or replace function public.max_offline_age() returns interval
language sql immutable as $$ select interval '7 days' $$;

-- Must match CHILD_AGE_BRACKETS in src/config.ts.
create or replace function public.is_valid_age_bracket(p text) returns boolean
language sql immutable as $$ select p in ('0-6bulan', '6-12bulan', '1-2tahun', '2-3tahun', '3tahun+') $$;

create or replace function public.is_under1_bracket(p text) returns boolean
language sql immutable as $$ select coalesce(p in ('0-6bulan', '6-12bulan'), false) $$;

-- =========================================================
-- 1. Columns
-- =========================================================
alter table public.teams add column if not exists base_lat double precision;
alter table public.teams add column if not exists base_lng double precision;
alter table public.teams add column if not exists base_radius_m double precision not null default 10000
  check (base_radius_m > 0);

alter table public.attendances add column if not exists location_mocked boolean not null default false;
alter table public.visits add column if not exists location_mocked boolean not null default false;

-- received_at on reports: existing rows get their created_at (no meaningful lag).
do $$
declare t text;
begin
  foreach t in array array['stock_taking','offtake','share_of_shelf','paid_visibility','price_monitoring','ntg_gwp'] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'received_at') then
      execute format('alter table public.%I add column received_at timestamptz', t);
      execute format('update public.%I set received_at = created_at', t);
      execute format('alter table public.%I alter column received_at set default now(), alter column received_at set not null', t);
    end if;
  end loop;
end $$;

-- =========================================================
-- 2. Attendances: time bounds + clock-in geofence
-- =========================================================
create or replace function public.attendances_server_checks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  if auth.uid() is null then
    return new; -- service role / maintenance
  end if;
  new.created_at := now();
  if new.clock_in_at > now() + interval '5 minutes' or new.clock_in_at < now() - public.max_offline_age() then
    raise exception 'Waktu clock-in di luar batas yang diizinkan — periksa tanggal & jam HP.';
  end if;

  select t.base_lat, t.base_lng, t.base_radius_m into b
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.id = new.user_id;
  if new.location_mocked then
    new.geo_fence_ok := false;
  elsif b.base_lat is not null and b.base_lng is not null then
    new.geo_fence_ok := public.haversine_m(b.base_lat, b.base_lng, new.clock_in_lat, new.clock_in_lng) <= b.base_radius_m;
  else
    new.geo_fence_ok := true; -- no home-base pin for this team (yet): nothing to check against
  end if;
  return new;
end;
$$;

drop trigger if exists attendances_server_checks_trg on public.attendances;
create trigger attendances_server_checks_trg
  before insert on public.attendances
  for each row execute function public.attendances_server_checks();

-- =========================================================
-- 3. Visits: time bounds, inside an attendance, store geofence
-- =========================================================
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
       and (a.clock_out_at is null or new.check_in_at <= a.clock_out_at)
  ) then
    raise exception 'Check-in toko harus dilakukan selama sesi absensi (clock-in dulu).';
  end if;

  select lat, lng into s from public.stores where id = new.store_id;
  if s.lat is null or s.lng is null then
    new.store_distance_m := null;
    new.geo_valid := false; -- store has no pin: no location evidence
  else
    new.store_distance_m := round(public.haversine_m(s.lat, s.lng, new.lat, new.lng)::numeric);
    new.geo_valid := not new.location_mocked and new.store_distance_m <= public.visit_valid_radius_m();
  end if;
  return new;
end;
$$;

drop trigger if exists visits_server_checks_trg on public.visits;
create trigger visits_server_checks_trg
  before insert on public.visits
  for each row execute function public.visits_server_checks();

-- =========================================================
-- 4. Reports + NTG steps: inside their visit, server receive time
-- =========================================================
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
  select check_in_at, check_out_at into v from public.visits where id = new.visit_id;
  if not found then
    return new; -- the FK reports the missing visit
  end if;
  if new.created_at > now() + interval '5 minutes'
     or new.created_at < v.check_in_at - interval '1 minute'
     or (v.check_out_at is not null and new.created_at > v.check_out_at + interval '1 minute') then
    raise exception 'Laporan hanya bisa dibuat selama kunjungan berlangsung (antara check-in dan check-out).';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['stock_taking','offtake','share_of_shelf','paid_visibility','price_monitoring','ntg_gwp'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_server_checks', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.report_server_checks()',
      t || '_server_checks', t);
  end loop;
end $$;

-- =========================================================
-- 5. Under-1 rule + age bracket keys
-- =========================================================
create or replace function public.ntg_gwp_under1_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage <> 'approached'
     and exists (select 1 from public.consumers c
                 where c.id = new.consumer_id and public.is_under1_bracket(c.child_age_bracket)) then
    raise exception 'Anak di bawah 1 tahun: tahap NTG & GWP tidak boleh dimajukan (hanya edukasi ASI/MPASI).';
  end if;
  return new;
end;
$$;

drop trigger if exists ntg_gwp_under1_check_trg on public.ntg_gwp;
create trigger ntg_gwp_under1_check_trg
  before insert on public.ntg_gwp
  for each row execute function public.ntg_gwp_under1_check();

create or replace function public.consumers_age_bracket_check()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.child_age_bracket, '') <> ''
     and (tg_op = 'INSERT' or new.child_age_bracket is distinct from old.child_age_bracket)
     and not public.is_valid_age_bracket(new.child_age_bracket) then
    raise exception 'Bracket usia anak tidak dikenal: %', new.child_age_bracket;
  end if;
  return new;
end;
$$;

drop trigger if exists consumers_age_bracket_check_trg on public.consumers;
create trigger consumers_age_bracket_check_trg
  before insert or update on public.consumers
  for each row execute function public.consumers_age_bracket_check();
