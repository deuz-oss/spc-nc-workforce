-- Client error log + server-side management dashboard summary.
-- Run after 0017_scorecard_fairness_atomic_consumer.sql.
--
-- 1. CLIENT ERRORS. A crash on an NC's phone left no trace anywhere. The app
--    now reports uncaught errors and render crashes (ErrorBoundary) here —
--    a minimal, self-hosted crash log until a crash-reporting service (e.g.
--    Sentry) is set up. Users insert only their own rows (rate-limited);
--    super_admin reads them; nobody edits or deletes them through the API.
--
-- 2. DASHBOARD SUMMARY. The management dashboard (PM / Reckitt / Data Analyst)
--    summed every report row on the device — which meant every monitor login
--    pulled the whole program's 62-day history of offtake, share of shelf and
--    NTG rows (hundreds of thousands at 195 NCs). management_summary() returns
--    the same figures computed in Postgres, for any period and store filter.
--    It's SECURITY INVOKER: the caller's RLS decides what is counted.

-- =========================================================
-- 1. Client error log
-- =========================================================
create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid default auth.uid() references public.profiles(id) on delete set null,
  message     text not null check (char_length(message) <= 2000),
  stack       text check (char_length(stack) <= 8000),
  context     text check (char_length(context) <= 200),
  platform    text check (char_length(platform) <= 40),
  app_version text check (char_length(app_version) <= 40)
);
create index if not exists client_errors_at_idx on public.client_errors (at desc);

alter table public.client_errors enable row level security;
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors for insert
with check (user_id = auth.uid());
drop policy if exists client_errors_select on public.client_errors;
create policy client_errors_select on public.client_errors for select
using (public.current_role() = 'super_admin');

-- A crash loop must not flood the table: at most 50 reports per user per hour.
create or replace function public.client_errors_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.at := now();
  if (select count(*) from public.client_errors
       where user_id = new.user_id and at > now() - interval '1 hour') >= 50 then
    return null; -- silently dropped
  end if;
  return new;
end;
$$;

drop trigger if exists client_errors_rate_limit_trg on public.client_errors;
create trigger client_errors_rate_limit_trg
  before insert on public.client_errors
  for each row execute function public.client_errors_rate_limit();

-- =========================================================
-- 2. Management dashboard summary
-- =========================================================
-- Figures for reports created in [p_from, p_to), for the given stores (null =
-- every store the caller can see). Days are WIB dates, like the app's buckets.
create or replace function public.management_summary(p_from timestamptz, p_to timestamptz, p_store_ids text[] default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with sos as (
    select r.created_at, r.channel, r.category, r.own_facing_count as own, r.total_facing_count as total
      from public.share_of_shelf r
     where r.created_at >= p_from and r.created_at < p_to
       and (p_store_ids is null or r.store_id = any (p_store_ids))
  ),
  otk as (
    select r.created_at, r.units_sold
      from public.offtake r
     where r.created_at >= p_from and r.created_at < p_to
       and (p_store_ids is null or r.store_id = any (p_store_ids))
  ),
  ntg as (
    select g.consumer_id, g.stage, g.gwp_qty
      from public.ntg_gwp g
      join public.visits v on v.id = g.visit_id
     where g.created_at >= p_from and g.created_at < p_to
       and (p_store_ids is null or v.store_id = any (p_store_ids))
  ),
  days as (
    select d, sum(own) as own, sum(total) as total, sum(units) as units
      from (
        select (created_at at time zone 'Asia/Jakarta')::date as d, own, total, 0::numeric as units from sos
        union all
        select (created_at at time zone 'Asia/Jakarta')::date, 0, 0, units_sold from otk
      ) x
     group by d
  )
  select jsonb_build_object(
    'own_facing', (select coalesce(sum(own), 0) from sos),
    'total_facing', (select coalesce(sum(total), 0) from sos),
    'offtake_units', (select coalesce(sum(units_sold), 0) from otk),
    'gwp_given_qty', (select coalesce(sum(gwp_qty), 0) from ntg where stage = 'gwp_given'),
    'ntg_consumers', (select count(distinct consumer_id) from ntg
                       where stage in ('ntg_confirmed', 'gwp_given', 'wa_followup_scheduled')),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'own', own, 'total', total, 'units', units) order by d)
                         from days), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('channel', channel, 'category', category, 'own', own, 'total', total))
                            from (select channel, category, sum(own) as own, sum(total) as total
                                    from sos group by channel, category) c), '[]'::jsonb)
  )
$$;

revoke execute on function public.management_summary(timestamptz, timestamptz, text[]) from public, anon;
grant execute on function public.management_summary(timestamptz, timestamptz, text[]) to authenticated;
