-- Phase 2 ("Core daily loop" — PRD §16): product master for Stock Taking /
-- Offtake SKU pickers (PRD §5.1 "SKU list from product master"), the Offtake
-- outlier trigger (PRD §5.3), and a consumers-table RLS fix found while
-- wiring the NTG & GWP screens. Run after 0001_init.sql / 0002_visit_media_storage.sql.

-- =========================================================
-- 1. Product master
-- =========================================================
-- Deliberately NOT a hard FK target from stock_taking.sku / offtake.sku /
-- price_monitoring.sku (those stay free text, as already defined in
-- 0001_init.sql) — product master data may be incomplete for a given store's
-- actual inventory during rollout, and a hard FK would block field
-- submissions on master-data gaps. This table is a UI picklist source, not a
-- referential-integrity constraint. id/sku pattern matches the rest of the
-- schema (client-minted text id via uid(), not a DB-generated uuid).
create table public.products (
  id         text primary key,          -- uid('p_')
  sku        text not null unique,
  name       text not null,
  category   text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;
create policy products_select on public.products for select using (true);  -- shared reference data, any authenticated role
create policy products_write on public.products for all
using (public.current_role() in ('super_admin','admin_data_entry','data_analyst'))
with check (public.current_role() in ('super_admin','admin_data_entry','data_analyst'));

-- =========================================================
-- 2. Offtake outlier trigger (PRD §5.3)
-- =========================================================
-- Server-side (not client-computed) so offline-queued writes are flagged
-- correctly whenever they actually land, regardless of when that is relative
-- to "today" — a client-side flag computed at compose time could go stale by
-- the time a queued row finally syncs.
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
begin
  select nc_id into v_nc_id from public.visits where id = new.visit_id;

  select avg(o.units_sold), count(distinct o.created_at::date)
    into v_avg, v_days
  from public.offtake o
  join public.visits v on v.id = o.visit_id
  where v.nc_id = v_nc_id
    and o.sku = new.sku
    and o.created_at >= now() - interval '7 days'
    and o.created_at < date_trunc('day', new.created_at);

  -- Need at least 1 prior day of history before an average means anything —
  -- otherwise every NC's very first entry for a SKU would flag as an outlier.
  if v_days is not null and v_days >= 1 and v_avg is not null and new.units_sold > 3 * v_avg then
    new.is_outlier := true;
  else
    new.is_outlier := false;
  end if;

  return new;
end;
$$;

create trigger offtake_flag_outlier_trg
  before insert on public.offtake
  for each row execute function public.offtake_flag_outlier();

-- =========================================================
-- 3. Consumers ownership fix
-- =========================================================
-- 0001_init.sql's consumers_write policy (`using (current_role() = 'nc')`)
-- lets ANY authenticated NC update or delete ANY other NC's consumer rows,
-- not just their own — caught while building the NTG & GWP screens that
-- actually exercise this table (Phase 2). Add an ownership column and split
-- the old catch-all policy into scoped insert/update policies.
alter table public.consumers add column created_by_nc_id uuid references public.profiles(id);

drop policy consumers_write on public.consumers;

create policy consumers_insert on public.consumers for insert
with check (public.current_role() = 'nc' and created_by_nc_id = auth.uid());

create policy consumers_update on public.consumers for update
using (created_by_nc_id = auth.uid())
with check (created_by_nc_id = auth.uid());
-- No delete policy: consumer records (consent, WA contact) are retained once
-- created — consistent with the soft-delete pattern used elsewhere in this
-- schema (stores.archived) rather than modeling a destructive reset path.

-- =========================================================
-- 4. Realtime: extend the live-sync set to the Phase 2 tables
-- =========================================================
alter publication supabase_realtime add table
  public.products, public.stock_taking, public.offtake, public.consumers, public.ntg_gwp;
