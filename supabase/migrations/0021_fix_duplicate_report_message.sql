-- Fix the duplicate-report message (0013). Run after 0020_pjp_schedules.sql.
--
-- reject_duplicate_report() built its message with one CASE over
-- new.category / new.visibility_type / new.sku. PL/pgSQL resolves every
-- field in an expression, so on a table without one of those columns (e.g.
-- stock_taking has no category) a duplicate raised 42703 undefined_column
-- instead of the intended P0001 with a readable message. Each branch now
-- builds its own message and only reads its own table's columns.

create or replace function public.reject_duplicate_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msg text;
begin
  if tg_table_name = 'stock_taking' then
    if exists (select 1 from public.stock_taking r
               where r.visit_id = new.visit_id and lower(r.sku) = lower(new.sku) and r.id <> new.id) then
      msg := 'SKU ' || new.sku || ' sudah dilaporkan di kunjungan ini';
    end if;
  elsif tg_table_name = 'offtake' then
    if exists (select 1 from public.offtake r
               where r.visit_id = new.visit_id and lower(r.sku) = lower(new.sku) and r.id <> new.id) then
      msg := 'SKU ' || new.sku || ' sudah dilaporkan di kunjungan ini';
    end if;
  elsif tg_table_name = 'price_monitoring' then
    if exists (select 1 from public.price_monitoring r
               where r.visit_id = new.visit_id and lower(r.sku) = lower(new.sku) and r.id <> new.id) then
      msg := 'SKU ' || new.sku || ' sudah dilaporkan di kunjungan ini';
    end if;
  elsif tg_table_name = 'share_of_shelf' then
    if exists (select 1 from public.share_of_shelf r
               where r.visit_id = new.visit_id and r.category = new.category and r.id <> new.id) then
      msg := 'Share of Shelf kategori ' || new.category || ' sudah dilaporkan di kunjungan ini';
    end if;
  elsif tg_table_name = 'paid_visibility' then
    if exists (select 1 from public.paid_visibility r
               where r.visit_id = new.visit_id and r.visibility_type = new.visibility_type and r.id <> new.id) then
      msg := 'Paid Visibility jenis ' || new.visibility_type || ' sudah dilaporkan di kunjungan ini';
    end if;
  end if;

  if msg is not null then
    -- P0001 (raise_exception): the app treats it as a permanent rejection and
    -- shows this message — never as the 23505 "already saved" replay case.
    raise exception '%', msg;
  end if;
  return new;
end;
$$;
