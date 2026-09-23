-- Targets screen (Data Analyst / Super Admin): one per-NC target row per
-- month. Every reader already treats it that way — compute_scorecards()
-- SUMs targets per nc_id + period_key, so a duplicate row would silently
-- double an NC's target and halve their offtake-achievement score.
-- Run after 0008_audit_hardening.sql.

-- Collapse any pre-existing duplicates (there was no UI writing targets
-- before this migration, so normally there are none): keep the highest id.
delete from public.targets t
using public.targets d
where t.store_id is null and d.store_id is null
  and t.nc_id = d.nc_id and t.period_key = d.period_key
  and t.id < d.id;

create unique index if not exists targets_nc_period_uniq
  on public.targets (nc_id, period_key)
  where store_id is null and nc_id is not null;

-- 0006's data_analyst scorecard notes "target_gwp_allocation_timeliness"
-- needs a timestamp on targets to be computable at all.
alter table public.targets add column if not exists updated_at timestamptz not null default now();

create or replace function public.targets_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists targets_touch_updated_at_trg on public.targets;
create trigger targets_touch_updated_at_trg
  before update on public.targets
  for each row execute function public.targets_touch_updated_at();
