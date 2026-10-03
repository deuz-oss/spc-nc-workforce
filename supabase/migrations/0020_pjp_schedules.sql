-- PJP (Permanent Journey Plan): planned store visits per NC per day.
-- Run after 0019_consumer_current_stage.sql.
--
-- The schedules table has existed since 0001 but nothing wrote to it. With
-- the app's PJP screen it becomes live, so:
--   1. schedules_write let any TL/ARCO write ANY NC's plan; now a TL plans
--      only their team's NCs and an ARCO only NCs of their teams (super_admin
--      and admin_data_entry: everyone).
--   2. planned_date is normalized to the WIB day (00:00 WIB) and one store
--      can be planned once per NC per day.
--   3. actual_visit_id is server-owned: it links the NC's first check-in at
--      that store on that WIB day — set when the plan is saved (visit already
--      made) and when a matching visit arrives later. Clients can't forge it,
--      so the Admin Data Entry "PJP schedule updates" KPI (0006) and the plan
--      compliance shown in the app are real.
--   4. schedules joins the realtime publication.

-- =========================================================
-- 1. Scoped write access
-- =========================================================
create or replace function public.can_manage_schedule(p_nc_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role() in ('super_admin', 'admin_data_entry')
      or (public.current_role() = 'tl' and exists (
            select 1 from public.profiles p
             where p.id = p_nc_id and p.role = 'nc' and p.team_id = public.current_team_id()))
      or (public.current_role() = 'arco' and exists (
            select 1 from public.profiles p
             where p.id = p_nc_id and p.role = 'nc' and p.team_id in (select public.current_arco_team_ids())))
$$;

revoke execute on function public.can_manage_schedule(uuid) from public, anon;
grant execute on function public.can_manage_schedule(uuid) to authenticated;

drop policy if exists schedules_write on public.schedules;
create policy schedules_write on public.schedules for all
using (public.can_manage_schedule(nc_id))
with check (public.can_manage_schedule(nc_id));

-- =========================================================
-- 2 + 3. WIB day, one per NC/store/day, server-owned visit link
-- =========================================================
create or replace function public.wib_day_start(p timestamptz) returns timestamptz
language sql immutable as $$
  select (date_trunc('day', p at time zone 'Asia/Jakarta')) at time zone 'Asia/Jakarta'
$$;

-- First check-in of this NC at this store on that WIB day, if any.
create or replace function public.schedule_visit(p_nc_id uuid, p_store_id text, p_day timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select v.id from public.visits v
   where v.nc_id = p_nc_id and v.store_id = p_store_id
     and v.check_in_at >= p_day and v.check_in_at < p_day + interval '1 day'
   order by v.check_in_at
   limit 1
$$;

create or replace function public.schedules_server_checks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.planned_date := public.wib_day_start(new.planned_date);
  new.actual_visit_id := public.schedule_visit(new.nc_id, new.store_id, new.planned_date);
  return new;
end;
$$;

drop trigger if exists schedules_server_checks_trg on public.schedules;
create trigger schedules_server_checks_trg
  before insert or update on public.schedules
  for each row execute function public.schedules_server_checks();

-- Normalize + link what already exists (fires the trigger), then dedupe.
update public.schedules set planned_date = planned_date;
delete from public.schedules s
 using public.schedules d
 where s.nc_id = d.nc_id and s.store_id = d.store_id and s.planned_date = d.planned_date and s.id > d.id;
create unique index if not exists schedules_nc_store_day_uniq on public.schedules (nc_id, store_id, planned_date);

-- A visit arriving later links the plan it fulfils.
create or replace function public.visits_link_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.schedules s
     set actual_visit_id = new.id -- recomputed by schedules_server_checks (keeps the day's first visit)
   where s.nc_id = new.nc_id
     and s.store_id = new.store_id
     and s.planned_date = public.wib_day_start(new.check_in_at)
     and s.actual_visit_id is null;
  return null;
end;
$$;

drop trigger if exists visits_link_schedule_trg on public.visits;
create trigger visits_link_schedule_trg
  after insert on public.visits
  for each row execute function public.visits_link_schedule();

revoke execute on function public.schedule_visit(uuid, text, timestamptz) from public, anon, authenticated;

-- =========================================================
-- 4. Realtime
-- =========================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedules') then
    alter publication supabase_realtime add table public.schedules;
  end if;
end $$;
