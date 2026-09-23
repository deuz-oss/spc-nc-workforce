-- Phase 4a ("TL/ARCO validation console + PM/Reckitt dashboards" — PRD §16):
-- exception-based report review (PRD §8 review note) and the TL coaching
-- visit log (PRD §8).
--
-- Confirmed genuinely missing (checked 0001_init.sql before writing this):
-- stock_taking/share_of_shelf/offtake/paid_visibility/price_monitoring have
-- no review/approval status column, and there is no coaching-log table.

-- Generic review table instead of altering all 5 report tables — one row per
-- (report_type, report_id). NCs never self-approve; write is TL/ARCO (their
-- own scope) or super_admin.
create table public.report_reviews (
  id           text primary key,
  report_type  text not null check (report_type in ('stock_taking','share_of_shelf','offtake','paid_visibility','price_monitoring')),
  report_id    text not null,
  status       text not null default 'pending' check (status in ('pending','approved','flagged')),
  reviewed_by  uuid references public.profiles(id),
  reviewed_at  timestamptz,
  note         text,
  unique (report_type, report_id)
);

-- Resolves a (report_type, report_id) pair to its underlying visit_id so RLS
-- can reuse the existing visit_is_own_or_scoped()/visit_is_own() functions
-- instead of duplicating the TL/ARCO scoping logic a third time.
create or replace function public.report_visit_id(p_report_type text, p_report_id text) returns text
language sql stable security definer set search_path = public as $$
  select case p_report_type
    when 'stock_taking' then (select visit_id from public.stock_taking where id = p_report_id)
    when 'share_of_shelf' then (select visit_id from public.share_of_shelf where id = p_report_id)
    when 'offtake' then (select visit_id from public.offtake where id = p_report_id)
    when 'paid_visibility' then (select visit_id from public.paid_visibility where id = p_report_id)
    when 'price_monitoring' then (select visit_id from public.price_monitoring where id = p_report_id)
  end
$$;

alter table public.report_reviews enable row level security;

create policy report_reviews_select on public.report_reviews for select
using (public.visit_is_own_or_scoped(public.report_visit_id(report_type, report_id)));

-- Write restricted to TL/ARCO (their own team/scope only) + super_admin — PRD
-- §8 is a TL/ARCO console; NCs never self-approve their own reports.
create policy report_reviews_write on public.report_reviews for all
using (
  public.current_role() = 'super_admin'
  or (public.current_role() = 'tl'
      and exists (
        select 1 from public.visits v
        where v.id = public.report_visit_id(report_type, report_id)
        and v.nc_id in (select id from public.profiles where team_id = public.current_team_id())
      ))
  or (public.current_role() = 'arco'
      and exists (
        select 1 from public.visits v
        where v.id = public.report_visit_id(report_type, report_id)
        and v.nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids()))
      ))
)
with check (
  public.current_role() = 'super_admin'
  or (public.current_role() = 'tl'
      and exists (
        select 1 from public.visits v
        where v.id = public.report_visit_id(report_type, report_id)
        and v.nc_id in (select id from public.profiles where team_id = public.current_team_id())
      ))
  or (public.current_role() = 'arco'
      and exists (
        select 1 from public.visits v
        where v.id = public.report_visit_id(report_type, report_id)
        and v.nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids()))
      ))
);

create table public.coaching_logs (
  id          text primary key,
  tl_id       uuid not null references public.profiles(id),
  nc_id       uuid not null references public.profiles(id),
  date        timestamptz not null,
  note        text not null,
  created_at  timestamptz not null default now()
);
create index coaching_logs_nc_idx on public.coaching_logs(nc_id, date);

alter table public.coaching_logs enable row level security;

create policy coaching_logs_select on public.coaching_logs for select
using (
  public.is_monitor_role()
  or tl_id = auth.uid()
  or nc_id = auth.uid()
  or (public.current_role() = 'arco' and nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
);

-- A TL may only log entries against their own team's NCs (nc_id checked, not
-- just tl_id = self, so a TL can't backdate a coaching note for someone
-- else's NC). ARCO may log for any NC across the teams they oversee.
create policy coaching_logs_write on public.coaching_logs for all
using (
  public.current_role() = 'super_admin'
  or (public.current_role() = 'tl' and tl_id = auth.uid() and nc_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco' and nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
)
with check (
  public.current_role() = 'super_admin'
  or (public.current_role() = 'tl' and tl_id = auth.uid() and nc_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco' and nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
);

-- Same gap Phase 3 found and fixed for its own 5 tables: new tables are never
-- automatically part of supabase_realtime, so subscribeRealtime() listeners
-- for them would silently never fire without this.
alter publication supabase_realtime add table
  public.report_reviews, public.coaching_logs;
