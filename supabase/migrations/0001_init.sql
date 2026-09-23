-- SPC NC Workforce — Phase 1 foundation schema.
-- Run this once in the Supabase SQL editor (or via `supabase db push`) on a
-- fresh project, then 0002_visit_media_storage.sql.
--
-- Scaffolded from spc-field-force's proven schema shape (auth/RLS pattern,
-- attendances/route_points, admin-users provisioning trigger), adapted to
-- PRD §12's data model plus two entities added during PRD review
-- (`certifications`, `schedules`) and the §17 in-app messaging entities.
--
-- Phase 1 wires real app code against: teams, profiles, stores, visits,
-- attendances, route_points. The 7 report-module tables, consumer/NTG-GWP,
-- surveys, scorecards, targets, certifications, schedules, and messaging are
-- defined here (with RLS) so the schema is complete per the PRD, but no
-- screen reads/writes them yet — that's Phase 2/3/4 (PRD §16).

-- =========================================================
-- 1. TEAMS  (a TL's team of NCs; ARCO scopes via arco_id, not multiple TLs)
-- =========================================================
create table public.teams (
  id         text primary key,                 -- client-minted via uid('t_')
  name       text not null,
  city       text not null,
  tl_id      uuid,                              -- FK to profiles added after profiles exists (circular)
  arco_id    uuid,
  created_at timestamptz not null default now()
);

-- =========================================================
-- 2. PROFILES  (1:1 with auth.users; source of truth for role/team for RLS)
-- =========================================================
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  username   text not null unique,              -- lowercase, matches login form input
  role       text not null check (role in (
               'super_admin','reckitt_client','pm','arco','tl','nc',
               'lead_trainer','trainer','data_analyst','admin_data_entry'
             )),
  team_id    text references public.teams(id),
  city       text,
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index profiles_team_id_idx on public.profiles(team_id);

alter table public.teams add constraint teams_tl_id_fkey foreign key (tl_id) references public.profiles(id);
alter table public.teams add constraint teams_arco_id_fkey foreign key (arco_id) references public.profiles(id);

-- =========================================================
-- 3. STORES
-- =========================================================
-- channel (DMS/LMT/MTI) kept as free text: definition still pending client
-- clarification per PRD §15 — do not hard-enum until confirmed.
create table public.stores (
  id               text primary key,            -- uid('st_')
  name             text not null,
  address          text not null default '',
  city             text not null default '',
  channel          text not null default '',
  account          text,
  category         text not null check (category in ('premium','super_premium')),
  lat              double precision,
  lng              double precision,
  assigned_nc_id   uuid references public.profiles(id),
  team_id          text references public.teams(id),
  source           text not null check (source in ('imported','manual')),
  archived         boolean not null default false,
  created_at       timestamptz not null default now()
);
create index stores_team_id_idx on public.stores(team_id);
create index stores_assigned_nc_idx on public.stores(assigned_nc_id);

-- =========================================================
-- 4. VISITS  (store check-in/out; report evidence lives on each report table)
-- =========================================================
create table public.visits (
  id                text primary key,          -- uid('v_')
  store_id          text not null references public.stores(id),
  nc_id             uuid not null references public.profiles(id),
  check_in_at       timestamptz not null default now(),
  check_out_at      timestamptz,
  lat               double precision not null,
  lng               double precision not null,
  store_distance_m  numeric,
  geo_valid         boolean not null,
  created_at        timestamptz not null default now()
);
create index visits_nc_id_idx on public.visits(nc_id);
create index visits_store_id_idx on public.visits(store_id);

-- =========================================================
-- 5. ATTENDANCES  (route lives in route_points, not a JSONB column here)
-- =========================================================
create table public.attendances (
  id             text primary key,              -- uid('a_')
  user_id        uuid not null references public.profiles(id),
  clock_in_at    timestamptz not null default now(),
  clock_in_lat   double precision not null,
  clock_in_lng   double precision not null,
  clock_out_at   timestamptz,
  clock_out_lat  double precision,
  clock_out_lng  double precision,
  geo_fence_ok   boolean not null,
  -- MWH (Market Working Hours) definition still open per PRD §7/§15 — until
  -- decided, MWH = Working Hours and this column stays unused (null).
  non_market_ms  bigint,
  created_at     timestamptz not null default now()
);
create index attendances_user_id_idx on public.attendances(user_id);
create index attendances_open_idx on public.attendances(user_id) where clock_out_at is null;
alter table public.attendances replica identity full;   -- so UPDATE (clock-out) realtime payload carries full row

-- =========================================================
-- 6. ROUTE_POINTS  (one row per GPS ping — realtime-friendly)
-- =========================================================
create table public.route_points (
  id            bigint generated always as identity primary key,
  attendance_id text not null references public.attendances(id) on delete cascade,
  user_id       uuid not null references public.profiles(id),   -- denormalized, avoids join in RLS hot path
  lat           double precision not null,
  lng           double precision not null,
  recorded_at   timestamptz not null default now()
);
create index route_points_attendance_idx on public.route_points(attendance_id, recorded_at);
create index route_points_user_recent_idx on public.route_points(user_id, recorded_at desc);

-- =========================================================
-- 7. Report modules (PRD §5) — schema defined now, screens are Phase 2/3 stubs
-- =========================================================
create table public.stock_taking (
  id            text primary key,
  visit_id      text not null references public.visits(id),
  store_id      text not null references public.stores(id),
  sku           text not null,
  qty_on_hand   numeric not null check (qty_on_hand >= 0),
  out_of_stock  boolean not null default false,
  photo_url     text,
  created_at    timestamptz not null default now()
);
create index stock_taking_visit_idx on public.stock_taking(visit_id);

create table public.share_of_shelf (
  id                  text primary key,
  visit_id            text not null references public.visits(id),
  store_id            text not null references public.stores(id),
  channel             text not null default '',
  category            text not null check (category in ('premium','super_premium')),
  own_facing_count    int not null check (own_facing_count >= 0),
  total_facing_count  int not null check (total_facing_count >= 0),
  photo_url           text not null,             -- required evidence — PRD §5.2
  created_at          timestamptz not null default now(),
  constraint sos_facing_check check (own_facing_count <= total_facing_count)
);
create index share_of_shelf_visit_idx on public.share_of_shelf(visit_id);

create table public.offtake (
  id          text primary key,
  visit_id    text not null references public.visits(id),
  store_id    text not null references public.stores(id),
  sku         text not null,
  units_sold  numeric not null check (units_sold >= 0),
  revenue     numeric,
  is_outlier  boolean not null default false,     -- >3x trailing 7-day avg — PRD §5.3
  created_at  timestamptz not null default now()
);
create index offtake_visit_idx on public.offtake(visit_id);
create index offtake_store_sku_date_idx on public.offtake(store_id, sku, created_at);

create table public.paid_visibility (
  id                     text primary key,
  visit_id               text not null references public.visits(id),
  store_id               text not null references public.stores(id),
  visibility_type        text not null default '',
  compliance_checklist   jsonb not null default '{}',
  photo_url              text not null,           -- required evidence — PRD §5.5
  created_at             timestamptz not null default now()
);
create index paid_visibility_visit_idx on public.paid_visibility(visit_id);

create table public.price_monitoring (
  id                   text primary key,
  visit_id             text not null references public.visits(id),
  store_id             text not null references public.stores(id),
  sku                  text not null,
  own_price            numeric not null check (own_price >= 0),
  competitor_prices    numeric[] not null default '{}',
  photo_url            text,
  created_at           timestamptz not null default now()
);
create index price_monitoring_visit_idx on public.price_monitoring(visit_id);

-- =========================================================
-- 8. Consumer / NTG & GWP (PRD §5.4, §6)
-- =========================================================
create table public.consumers (
  id                 text primary key,
  name               text not null,
  wa_contact         text not null default '',
  consent            boolean not null default false,   -- explicit consent screen before any question — PRD §6
  child_age_bracket  text,
  current_brand      text,
  quiz_result        text,                              -- segment tag, not a medical assessment — PRD §6
  created_at         timestamptz not null default now()
);

create table public.ntg_gwp (
  id           text primary key,
  consumer_id  text not null references public.consumers(id),
  visit_id     text not null references public.visits(id),
  stage        text not null check (stage in (
                 'approached','quiz_completed','consultation_delivered',
                 'ntg_confirmed','gwp_given','wa_followup_scheduled'
               )),
  gwp_item     text,
  gwp_qty      numeric,
  -- Added during PRD review: explicit link so "GWP spike without matching
  -- offtake" anomaly detection (PRD §5.4) is actually computable.
  offtake_id   text references public.offtake(id),
  created_at   timestamptz not null default now()
);
create index ntg_gwp_visit_idx on public.ntg_gwp(visit_id);
create index ntg_gwp_consumer_idx on public.ntg_gwp(consumer_id);

-- =========================================================
-- 9. Surveys / Nutrition Quiz (PRD §5.7, §6)
-- =========================================================
create table public.surveys (
  id            text primary key,
  title         text not null,
  questions     jsonb not null default '[]',
  campaign_tag  text,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now()
);

create table public.survey_responses (
  id           text primary key,
  survey_id    text not null references public.surveys(id),
  -- Nutrition Quiz responses may not be tied to a visit — PRD §5.7/§6.
  visit_id     text references public.visits(id),
  consumer_id  text references public.consumers(id),
  answers      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index survey_responses_survey_idx on public.survey_responses(survey_id);

-- =========================================================
-- 10. Scorecards / targets (PRD §9)
-- =========================================================
create table public.scorecards (
  id           text primary key,
  subject_id   uuid not null references public.profiles(id),
  role         text not null,
  period_key   text not null,                    -- e.g. "2026-09"
  score        numeric not null,
  status       text not null check (status in ('on_track','needs_attention','below_target')),
  breakdown    jsonb not null default '{}',
  computed_at  timestamptz not null default now(),
  unique (subject_id, period_key)
);

-- Editable per PRD review recommendation — weights should not be hardcoded,
-- since NTG/channel/MWH definitions are still open and will likely need
-- post-pilot tuning.
create table public.scorecard_weight_config (
  role        text not null,
  kpi_key     text not null,
  weight_pct  numeric not null check (weight_pct >= 0 and weight_pct <= 100),
  primary key (role, kpi_key)
);

create table public.targets (
  id                text primary key,
  store_id          text references public.stores(id),
  nc_id             uuid references public.profiles(id),
  period_key        text not null,
  offtake_target    numeric,
  gwp_allocation    numeric,
  set_by            uuid not null references public.profiles(id)   -- data_analyst
);

-- =========================================================
-- 11. Certifications, schedules — added during PRD review (§12)
-- =========================================================
create table public.certifications (
  id         text primary key,
  user_id    uuid not null references public.profiles(id),   -- NC or TL
  cert_type  text not null,
  date       timestamptz not null,
  passed     boolean not null
);
create index certifications_user_idx on public.certifications(user_id);

create table public.schedules (
  id               text primary key,
  nc_id            uuid not null references public.profiles(id),
  store_id         text not null references public.stores(id),
  planned_date     timestamptz not null,
  actual_visit_id  text references public.visits(id)
);
create index schedules_nc_idx on public.schedules(nc_id, planned_date);

-- =========================================================
-- 12. In-app messaging (PRD §17)
-- =========================================================
create table public.conversations (
  id              text primary key,
  type            text not null check (type in ('nc_tl','tl_arco')),
  participant_a   uuid not null references public.profiles(id),
  participant_b   uuid not null references public.profiles(id),
  created_at      timestamptz not null default now()
);

create table public.messages (
  id               text primary key,
  conversation_id  text not null references public.conversations(id) on delete cascade,
  sender_id        uuid not null references public.profiles(id),
  body             text not null,
  created_at       timestamptz not null default now(),
  read_at          timestamptz
);
create index messages_conversation_idx on public.messages(conversation_id, created_at);

-- =========================================================
-- 13. Helper functions (avoid RLS self-recursion on profiles)
-- =========================================================
create or replace function public.current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_team_id() returns text
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid()
$$;

-- Roles that monitor the whole program (not scoped to one team) — PRD §2.
create or replace function public.is_monitor_role() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role() in (
    'super_admin','pm','reckitt_client','data_analyst','lead_trainer','trainer','admin_data_entry'
  )
$$;

-- Team ids an ARCO oversees (a team's arco_id = caller).
create or replace function public.current_arco_team_ids() returns setof text
language sql stable security definer set search_path = public as $$
  select id from public.teams where arco_id = auth.uid()
$$;

-- =========================================================
-- 14. RLS policies — core Phase 1 tables
-- =========================================================
alter table public.profiles enable row level security;

create policy profiles_select on public.profiles for select
using (
  id = auth.uid()
  or public.is_monitor_role()
  or (public.current_role() = 'tl' and active and team_id = public.current_team_id())
  or (public.current_role() = 'arco' and active and team_id in (select public.current_arco_team_ids()))
);
-- Monitor roles must see inactive profiles too (not just active) — Postgres RLS
-- for UPDATE...RETURNING (which PostgREST always uses under the hood) requires
-- the SELECT policy to hold for the resulting row, or toggling active status
-- makes its own RETURNING row invisible (explicit RLS error) or the
-- already-inactive row untargetable in the first place. See spc-field-force's
-- 0001_init.sql profiles_select comment for the incident this avoids repeating.

create policy profiles_write_super_admin on public.profiles for update
using (public.current_role() = 'super_admin')
with check (public.current_role() = 'super_admin');
-- No client-side INSERT policy: new profile rows are only ever created by the
-- handle_new_auth_user trigger below (security definer, bypasses RLS).

alter table public.teams enable row level security;

create policy teams_select on public.teams for select using (true);   -- any authenticated role
create policy teams_write on public.teams for all
using (public.current_role() = 'super_admin')
with check (public.current_role() = 'super_admin');

alter table public.stores enable row level security;

create policy stores_select on public.stores for select
using (
  ( not archived and public.is_monitor_role() )
  or ( not archived and public.current_role() = 'tl' and team_id = public.current_team_id() )
  or ( not archived and public.current_role() = 'arco' and team_id in (select public.current_arco_team_ids()) )
  or ( not archived and public.current_role() = 'nc' and assigned_nc_id = auth.uid() )
);

create policy stores_insert on public.stores for insert
with check (
  public.current_role() in ('super_admin','admin_data_entry')
  or (public.current_role() = 'tl' and (team_id = public.current_team_id() or team_id is null))
  or (public.current_role() = 'arco' and (team_id in (select public.current_arco_team_ids()) or team_id is null))
);

create policy stores_update on public.stores for update
using (
  public.current_role() in ('super_admin','admin_data_entry')
  or (public.current_role() = 'tl' and team_id = public.current_team_id())
  or (public.current_role() = 'arco' and team_id in (select public.current_arco_team_ids()))
)
with check (
  public.current_role() in ('super_admin','admin_data_entry')
  or (public.current_role() = 'tl' and team_id = public.current_team_id())
  or (public.current_role() = 'arco' and team_id in (select public.current_arco_team_ids()))
);

alter table public.visits enable row level security;

create policy visits_select on public.visits for select
using (
  public.is_monitor_role()
  or (public.current_role() = 'tl'
      and nc_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco'
      and nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
  or nc_id = auth.uid()
);

create policy visits_write_own on public.visits for all
using (nc_id = auth.uid())
with check (nc_id = auth.uid());

alter table public.attendances enable row level security;

create policy attendances_select on public.attendances for select
using (
  public.is_monitor_role()
  or (public.current_role() = 'tl'
      and user_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco'
      and user_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
  or user_id = auth.uid()
);

create policy attendances_insert_own on public.attendances for insert
with check (user_id = auth.uid());

create policy attendances_update_own on public.attendances for update
using (user_id = auth.uid() and clock_out_at is null)
with check (user_id = auth.uid());

alter table public.route_points enable row level security;

create policy route_points_select on public.route_points for select
using (
  public.is_monitor_role()
  or (public.current_role() = 'tl'
      and user_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco'
      and user_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
  or user_id = auth.uid()
);

create policy route_points_insert_own on public.route_points for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.attendances a
    where a.id = attendance_id and a.user_id = auth.uid() and a.clock_out_at is null
  )
);
-- No update/delete policy -> immutable ping log by default-deny.

-- =========================================================
-- 15. RLS policies — report modules & related (Phase 2/3/4 tables, secured now)
-- =========================================================
-- Shared shape: readable by monitor roles + the visit's own TL/ARCO scope +
-- the NC who owns the visit; writable only by that NC, via the visit link.
create or replace function public.visit_is_own_or_scoped(v_visit_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.visits v
    where v.id = v_visit_id
    and (
      v.nc_id = auth.uid()
      or public.is_monitor_role()
      or (public.current_role() = 'tl'
          and v.nc_id in (select id from public.profiles where team_id = public.current_team_id()))
      or (public.current_role() = 'arco'
          and v.nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
    )
  )
$$;

create or replace function public.visit_is_own(v_visit_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.visits v where v.id = v_visit_id and v.nc_id = auth.uid())
$$;

alter table public.stock_taking enable row level security;
create policy stock_taking_select on public.stock_taking for select using (public.visit_is_own_or_scoped(visit_id));
create policy stock_taking_write on public.stock_taking for all
using (public.visit_is_own(visit_id)) with check (public.visit_is_own(visit_id));

alter table public.share_of_shelf enable row level security;
create policy share_of_shelf_select on public.share_of_shelf for select using (public.visit_is_own_or_scoped(visit_id));
create policy share_of_shelf_write on public.share_of_shelf for all
using (public.visit_is_own(visit_id)) with check (public.visit_is_own(visit_id));

alter table public.offtake enable row level security;
create policy offtake_select on public.offtake for select using (public.visit_is_own_or_scoped(visit_id));
create policy offtake_write on public.offtake for all
using (public.visit_is_own(visit_id)) with check (public.visit_is_own(visit_id));

alter table public.paid_visibility enable row level security;
create policy paid_visibility_select on public.paid_visibility for select using (public.visit_is_own_or_scoped(visit_id));
create policy paid_visibility_write on public.paid_visibility for all
using (public.visit_is_own(visit_id)) with check (public.visit_is_own(visit_id));

alter table public.price_monitoring enable row level security;
create policy price_monitoring_select on public.price_monitoring for select using (public.visit_is_own_or_scoped(visit_id));
create policy price_monitoring_write on public.price_monitoring for all
using (public.visit_is_own(visit_id)) with check (public.visit_is_own(visit_id));

alter table public.consumers enable row level security;
create policy consumers_select on public.consumers for select
using (
  public.is_monitor_role()
  or exists (select 1 from public.ntg_gwp g where g.consumer_id = consumers.id and public.visit_is_own_or_scoped(g.visit_id))
);
create policy consumers_write on public.consumers for all
using (public.current_role() = 'nc') with check (public.current_role() = 'nc');

alter table public.ntg_gwp enable row level security;
create policy ntg_gwp_select on public.ntg_gwp for select using (public.visit_is_own_or_scoped(visit_id));
create policy ntg_gwp_write on public.ntg_gwp for all
using (public.visit_is_own(visit_id)) with check (public.visit_is_own(visit_id));

alter table public.surveys enable row level security;
create policy surveys_select on public.surveys for select using (true);   -- any authenticated role — needed to render the quiz
create policy surveys_write on public.surveys for all
using (public.current_role() = 'data_analyst' or public.current_role() = 'super_admin')
with check (public.current_role() = 'data_analyst' or public.current_role() = 'super_admin');

alter table public.survey_responses enable row level security;
create policy survey_responses_select on public.survey_responses for select
using (public.is_monitor_role() or (visit_id is not null and public.visit_is_own_or_scoped(visit_id)));
create policy survey_responses_insert on public.survey_responses for insert
with check (visit_id is null or public.visit_is_own(visit_id));

alter table public.scorecards enable row level security;
create policy scorecards_select on public.scorecards for select
using (
  public.is_monitor_role()
  or subject_id = auth.uid()
  or (public.current_role() = 'tl' and subject_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco' and subject_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
);
-- No client write policy: scorecards are server-computed (Phase 4 job/RPC), not client-editable.

alter table public.scorecard_weight_config enable row level security;
create policy scorecard_weight_config_select on public.scorecard_weight_config for select using (true);
create policy scorecard_weight_config_write on public.scorecard_weight_config for all
using (public.current_role() in ('super_admin','data_analyst'))
with check (public.current_role() in ('super_admin','data_analyst'));

alter table public.targets enable row level security;
create policy targets_select on public.targets for select using (true);
create policy targets_write on public.targets for all
using (public.current_role() in ('super_admin','data_analyst'))
with check (public.current_role() in ('super_admin','data_analyst'));

alter table public.certifications enable row level security;
create policy certifications_select on public.certifications for select
using (public.is_monitor_role() or user_id = auth.uid());
create policy certifications_write on public.certifications for all
using (public.current_role() in ('super_admin','lead_trainer','trainer'))
with check (public.current_role() in ('super_admin','lead_trainer','trainer'));

alter table public.schedules enable row level security;
create policy schedules_select on public.schedules for select
using (
  public.is_monitor_role()
  or nc_id = auth.uid()
  or (public.current_role() = 'tl' and nc_id in (select id from public.profiles where team_id = public.current_team_id()))
  or (public.current_role() = 'arco' and nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
);
create policy schedules_write on public.schedules for all
using (public.current_role() in ('super_admin','admin_data_entry','tl','arco'))
with check (public.current_role() in ('super_admin','admin_data_entry','tl','arco'));

alter table public.conversations enable row level security;
create policy conversations_select on public.conversations for select
using (participant_a = auth.uid() or participant_b = auth.uid() or public.current_role() = 'super_admin');
create policy conversations_insert on public.conversations for insert
with check (participant_a = auth.uid() or participant_b = auth.uid());

alter table public.messages enable row level security;
create policy messages_select on public.messages for select
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (c.participant_a = auth.uid() or c.participant_b = auth.uid())
  )
  or public.current_role() = 'super_admin'
);
create policy messages_insert on public.messages for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (c.participant_a = auth.uid() or c.participant_b = auth.uid())
  )
);

-- =========================================================
-- 16. finish_visit RPC — closes a visit; lets an NC close their own visit
--     without needing a direct UPDATE grant beyond visits_write_own.
-- =========================================================
create or replace function public.finish_visit(p_visit_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.visits set check_out_at = now()
  where id = p_visit_id and nc_id = auth.uid();

  if not found then
    raise exception 'visit not found or not owned by caller';
  end if;
end;
$$;

grant execute on function public.finish_visit(text) to authenticated;

-- =========================================================
-- 17. auth.users -> profiles provisioning trigger
--     (only creation path: admin-provisioned via scripts/seed-supabase.ts
--      or supabase/functions/admin-users — never public signUp())
-- =========================================================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, username, role, team_id, city, phone, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'username'),
    new.raw_user_meta_data->>'username',
    coalesce(new.raw_user_meta_data->>'role', 'nc'),
    new.raw_user_meta_data->>'team_id',
    new.raw_user_meta_data->>'city',
    new.raw_user_meta_data->>'phone',
    true
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- =========================================================
-- 18. Realtime: publish the tables live-tracking viewers need to subscribe to
-- =========================================================
alter publication supabase_realtime add table
  public.profiles, public.teams, public.stores, public.visits,
  public.attendances, public.route_points, public.messages;
