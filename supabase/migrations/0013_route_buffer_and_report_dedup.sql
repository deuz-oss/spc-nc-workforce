-- Late-arriving GPS points + one report per visit. Run after 0012_live_positions.sql.
--
-- 1. ROUTE POINTS. The app now buffers GPS points on the phone (so they
--    survive no-signal stretches and a killed app — src/utils/routeBuffer.ts)
--    and uploads them later, possibly more than once if a response is lost.
--    a. Idempotent uploads: (attendance_id, recorded_at) becomes unique, and
--       the app inserts with ON CONFLICT DO NOTHING.
--    b. route_points_insert_own (0001) only accepted points while the
--       attendance was still open, so every point still buffered at clock-out
--       — and the clock-out position itself — was rejected. It now accepts a
--       point whose timestamp falls inside the session (clock-in .. clock-out,
--       or .. now while open), and never one from the future.
--
-- 2. DUPLICATE REPORTS. Submitting a module twice for the same visit doubled
--    the numbers (two Offtake submissions = twice the units sold, inflating
--    achievement and scorecards). A BEFORE INSERT trigger now rejects a second
--    row for the same visit + SKU (Stock Taking, Offtake, Price Monitoring),
--    visit + category (Share of Shelf) or visit + visibility type (Paid
--    Visibility). It's a trigger rather than a unique index so existing rows
--    are left untouched, and it ignores a row with the same id (an offline
--    replay of a batch that already landed still ends in the primary-key
--    conflict the app treats as "already saved").

-- =========================================================
-- 1a. Unique (attendance_id, recorded_at)
-- =========================================================
delete from public.route_points p
 using public.route_points d
 where p.attendance_id = d.attendance_id
   and p.recorded_at = d.recorded_at
   and p.id > d.id;

create unique index if not exists route_points_attendance_time_uniq
  on public.route_points (attendance_id, recorded_at);
-- Same columns as the unique index above, which now serves live_positions()
-- and route reads.
drop index if exists public.route_points_attendance_idx;

-- =========================================================
-- 1b. Accept points recorded during the session, whenever they arrive
-- =========================================================
drop policy if exists route_points_insert_own on public.route_points;
create policy route_points_insert_own on public.route_points for insert
with check (
  user_id = auth.uid()
  and recorded_at <= now() + interval '5 minutes'
  and exists (
    select 1 from public.attendances a
    where a.id = attendance_id
      and a.user_id = auth.uid()
      and recorded_at >= a.clock_in_at - interval '1 minute'
      and (a.clock_out_at is null or recorded_at <= a.clock_out_at)
  )
);

-- =========================================================
-- 2. One report per visit per SKU / category / visibility type
-- =========================================================
create or replace function public.reject_duplicate_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dup boolean;
begin
  if tg_table_name = 'stock_taking' then
    select exists (select 1 from public.stock_taking r
                   where r.visit_id = new.visit_id and lower(r.sku) = lower(new.sku) and r.id <> new.id) into dup;
  elsif tg_table_name = 'offtake' then
    select exists (select 1 from public.offtake r
                   where r.visit_id = new.visit_id and lower(r.sku) = lower(new.sku) and r.id <> new.id) into dup;
  elsif tg_table_name = 'price_monitoring' then
    select exists (select 1 from public.price_monitoring r
                   where r.visit_id = new.visit_id and lower(r.sku) = lower(new.sku) and r.id <> new.id) into dup;
  elsif tg_table_name = 'share_of_shelf' then
    select exists (select 1 from public.share_of_shelf r
                   where r.visit_id = new.visit_id and r.category = new.category and r.id <> new.id) into dup;
  elsif tg_table_name = 'paid_visibility' then
    select exists (select 1 from public.paid_visibility r
                   where r.visit_id = new.visit_id and r.visibility_type = new.visibility_type and r.id <> new.id) into dup;
  end if;

  if dup then
    -- P0001 (raise_exception): the app treats it as a permanent rejection and
    -- shows this message — never as the 23505 "already saved" replay case.
    raise exception '%', case tg_table_name
      when 'share_of_shelf' then 'Share of Shelf kategori ' || new.category || ' sudah dilaporkan di kunjungan ini'
      when 'paid_visibility' then 'Paid Visibility jenis ' || new.visibility_type || ' sudah dilaporkan di kunjungan ini'
      else 'SKU ' || new.sku || ' sudah dilaporkan di kunjungan ini'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_taking_reject_duplicate on public.stock_taking;
create trigger stock_taking_reject_duplicate before insert on public.stock_taking
  for each row execute function public.reject_duplicate_report();

drop trigger if exists offtake_reject_duplicate on public.offtake;
create trigger offtake_reject_duplicate before insert on public.offtake
  for each row execute function public.reject_duplicate_report();

drop trigger if exists price_monitoring_reject_duplicate on public.price_monitoring;
create trigger price_monitoring_reject_duplicate before insert on public.price_monitoring
  for each row execute function public.reject_duplicate_report();

drop trigger if exists share_of_shelf_reject_duplicate on public.share_of_shelf;
create trigger share_of_shelf_reject_duplicate before insert on public.share_of_shelf
  for each row execute function public.reject_duplicate_report();

drop trigger if exists paid_visibility_reject_duplicate on public.paid_visibility;
create trigger paid_visibility_reject_duplicate before insert on public.paid_visibility
  for each row execute function public.reject_duplicate_report();
