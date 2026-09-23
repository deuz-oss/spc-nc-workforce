-- Phase 4b ("scorecard computation + in-app messaging" — PRD §16): automated
-- scorecard engine (PRD §9). Weights are config-driven (scorecard_weight_config
-- already exists since Phase 1, per the PRD review recommendation) and the
-- compute function only scores KPIs that are genuinely backed by data already
-- in this schema — anything without a real table/column behind it is left out
-- of the weighted average entirely (renormalized among the computable KPIs)
-- and listed in `breakdown._skipped`, never fabricated. See the per-role
-- comments below for exactly what's computed vs. skipped and why.
--
-- NOT verified against a live Postgres instance — no Supabase project is
-- connected yet (credentials pending, per the session). This SQL is carefully
-- written and internally reviewed, but should be smoke-tested against a real
-- database (call `select compute_scorecards('2026-09');` after seeding some
-- offtake/visit data) before being trusted in production.

-- =========================================================
-- 1. Default weights (PRD §9 table) — idempotent, safe to re-run.
-- scorecard_weight_config's primary key is (role, kpi_key), so ON CONFLICT
-- DO NOTHING means re-running this migration never clobbers weights a
-- Data Analyst has since tuned via the app.
-- =========================================================
insert into public.scorecard_weight_config (role, kpi_key, weight_pct) values
  ('nc','offtake_achievement',40),
  ('nc','new_user_recruitment',25),
  ('nc','competitor_conversion',15),
  ('nc','reporting_compliance',10),
  ('nc','attendance',10),

  ('tl','team_offtake',35),
  ('tl','team_new_users_conversion',20),
  ('tl','same_day_validation',15),
  ('tl','coaching_visits',15),
  ('tl','team_retention',15),

  ('arco','regional_offtake',35),
  ('arco','regional_new_users_conversion',20),
  ('arco','activation_execution',15),
  ('arco','fulfilment_sla_retention',15),
  ('arco','reporting_accuracy',15),

  ('pm','program_offtake_new_users',40),
  ('pm','fulfilment_sla',20),
  ('pm','attrition_vs_target',15),
  ('pm','reporting_accuracy',15),
  ('pm','client_review_score',10),

  ('lead_trainer','training_schedule_adherence',25),
  ('lead_trainer','certification_pass_rate',25),
  ('lead_trainer','kpi_uplift_post_training',25),
  ('lead_trainer','mystery_shopper',15),
  ('lead_trainer','tl_coach_certification',10),

  ('data_analyst','monthly_report_timeliness',30),
  ('data_analyst','data_error_rate',25),
  ('data_analyst','target_gwp_allocation_timeliness',20),
  ('data_analyst','adopted_recommendations',15),
  ('data_analyst','ad_hoc_turnaround',10),

  ('admin_data_entry','daily_consolidation_timeliness',30),
  ('admin_data_entry','payroll_incentive_accuracy',30),
  ('admin_data_entry','pjp_schedule_updates',15),
  ('admin_data_entry','gwp_absorption_reporting',15),
  ('admin_data_entry','competitor_activity_reports',10)
on conflict (role, kpi_key) do nothing;

-- =========================================================
-- 2. report_created_at() — companion to report_visit_id() (0005 migration).
-- Needed for the TL "same_day_validation" KPI: whether a review happened the
-- same calendar day the underlying report was submitted.
-- =========================================================
create or replace function public.report_created_at(p_report_type text, p_report_id text) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case p_report_type
    when 'stock_taking' then (select created_at from public.stock_taking where id = p_report_id)
    when 'share_of_shelf' then (select created_at from public.share_of_shelf where id = p_report_id)
    when 'offtake' then (select created_at from public.offtake where id = p_report_id)
    when 'paid_visibility' then (select created_at from public.paid_visibility where id = p_report_id)
    when 'price_monitoring' then (select created_at from public.price_monitoring where id = p_report_id)
  end
$$;

-- =========================================================
-- 3. compute_scorecards(period_key) — the server-computed job/RPC the
-- `scorecards` table's own comment (0001 migration) says is required, since
-- that table deliberately has no client write policy. security definer so it
-- can read/write across every subject regardless of the caller's own RLS
-- scope; access is gated by an explicit role check inside the function body
-- instead (data_analyst/pm/super_admin only), not by a table grant.
--
-- period_key format: 'YYYY-MM' (matches the app's existing monthlyKey
-- convention in ManagementDashboard.tsx / kpi.ts).
--
-- Scoring convention: every KPI that can be computed is normalized to a
-- 0-100(+) scale (150 cap on "vs. target"-style KPIs to allow visible
-- over-achievement without letting one blown-out KPI dominate the weighted
-- average); the final score is a weight-renormalized average over only the
-- KPIs that were computable for that subject this period — see the inline
-- weighted-average query, which divides by the sum of weights among
-- computable KPIs only, not the role's full nominal 100.
-- =========================================================
create or replace function public.compute_scorecards(p_period_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  period_start timestamptz;
  period_end timestamptz;
  subj record;
  kpis jsonb;
  skipped text[];
  score numeric;
  status text;
  computable_weight numeric;
  v_offtake numeric;
  v_target numeric;
  v_ntg_count numeric;
  v_conv_count numeric;
  v_days_total numeric;
  v_days_with_reports numeric;
  v_cal_days numeric;
  v_days_with_attendance numeric;
  v_nc_count numeric;
  v_reviewed_count numeric;
  v_total_reports numeric;
  v_coaching_count numeric;
begin
  if public.current_role() not in ('data_analyst','pm','super_admin') then
    raise exception 'forbidden: data_analyst, pm, or super_admin only';
  end if;

  period_start := to_date(p_period_key || '-01', 'YYYY-MM-DD');
  period_end := period_start + interval '1 month';

  -- ===================================================================
  -- NC — all 5 PRD §9 KPIs are computable from existing tables.
  -- ===================================================================
  for subj in select id from public.profiles where role = 'nc' and active loop
    kpis := '{}'::jsonb;
    skipped := array[]::text[];

    select coalesce(sum(o.units_sold), 0) into v_offtake
    from public.offtake o join public.visits v on v.id = o.visit_id
    where v.nc_id = subj.id and o.created_at >= period_start and o.created_at < period_end;

    select coalesce(sum(t.offtake_target), 0) into v_target
    from public.targets t where t.nc_id = subj.id and t.period_key = p_period_key;

    if v_target > 0 then
      kpis := kpis || jsonb_build_object('offtake_achievement', least(150, round(100.0 * v_offtake / v_target)));
    else
      skipped := array_append(skipped, 'offtake_achievement');
    end if;

    select count(distinct g.consumer_id) into v_ntg_count
    from public.ntg_gwp g join public.visits v on v.id = g.visit_id
    where v.nc_id = subj.id and g.stage in ('ntg_confirmed','gwp_given','wa_followup_scheduled')
      and g.created_at >= period_start and g.created_at < period_end;
    -- No PRD-specified monthly target for "new user recruitment" — scored on a
    -- documented default curve (5 new users/month = 100%), capped at 150%.
    kpis := kpis || jsonb_build_object('new_user_recruitment', least(150, round(100.0 * v_ntg_count / 5.0)));

    select count(distinct g.consumer_id) into v_conv_count
    from public.ntg_gwp g
    join public.visits v on v.id = g.visit_id
    join public.consumers c on c.id = g.consumer_id
    where v.nc_id = subj.id and g.stage in ('ntg_confirmed','gwp_given','wa_followup_scheduled')
      and g.created_at >= period_start and g.created_at < period_end
      and coalesce(c.current_brand, '') <> '';
    -- Same documented-default-curve approach: 3 competitor conversions/month = 100%.
    kpis := kpis || jsonb_build_object('competitor_conversion', least(150, round(100.0 * v_conv_count / 3.0)));

    select count(distinct date_trunc('day', v.check_in_at)) into v_days_total
    from public.visits v where v.nc_id = subj.id and v.check_in_at >= period_start and v.check_in_at < period_end;

    select count(distinct d.day) into v_days_with_reports
    from (
      select distinct date_trunc('day', v.check_in_at) as day
      from public.visits v where v.nc_id = subj.id and v.check_in_at >= period_start and v.check_in_at < period_end
    ) d
    where exists (select 1 from public.stock_taking st join public.visits v2 on v2.id = st.visit_id where v2.nc_id = subj.id and date_trunc('day', v2.check_in_at) = d.day)
      and exists (select 1 from public.offtake o2 join public.visits v3 on v3.id = o2.visit_id where v3.nc_id = subj.id and date_trunc('day', v3.check_in_at) = d.day)
      and exists (select 1 from public.ntg_gwp g2 join public.visits v4 on v4.id = g2.visit_id where v4.nc_id = subj.id and date_trunc('day', v4.check_in_at) = d.day);

    if v_days_total > 0 then
      kpis := kpis || jsonb_build_object('reporting_compliance', round(100.0 * v_days_with_reports / v_days_total));
    else
      skipped := array_append(skipped, 'reporting_compliance');
    end if;

    select count(distinct date_trunc('day', a.clock_in_at)) into v_days_with_attendance
    from public.attendances a where a.user_id = subj.id and a.clock_in_at >= period_start and a.clock_in_at < least(period_end, now());

    -- Rough calendar-day denominator (no per-NC work-schedule model exists to
    -- compare against — `schedules`/PJP data may be sparse) — good enough for
    -- a v1 attendance-rate approximation, not a precise scheduled-vs-actual figure.
    v_cal_days := greatest(1, (least(period_end, now())::date - period_start::date));
    kpis := kpis || jsonb_build_object('attendance', least(100, round(100.0 * v_days_with_attendance / v_cal_days)));

    select coalesce(sum(swc.weight_pct * (kpis->>swc.kpi_key)::numeric) / nullif(sum(swc.weight_pct), 0), 0),
           coalesce(sum(swc.weight_pct), 0)
      into score, computable_weight
      from public.scorecard_weight_config swc
      where swc.role = 'nc' and kpis ? swc.kpi_key;

    status := case when computable_weight = 0 then 'needs_attention'
                   when score >= 80 then 'on_track'
                   when score >= 60 then 'needs_attention'
                   else 'below_target' end;

    insert into public.scorecards (id, subject_id, role, period_key, score, status, breakdown, computed_at)
    values ('sc_' || subj.id || '_' || p_period_key, subj.id, 'nc', p_period_key, score, status,
            kpis || jsonb_build_object('_skipped', to_jsonb(skipped)), now())
    on conflict (subject_id, period_key) do update set
      role = excluded.role, score = excluded.score, status = excluded.status,
      breakdown = excluded.breakdown, computed_at = excluded.computed_at;
  end loop;

  -- ===================================================================
  -- TL — 4 of 5 computable. "team_retention" skipped: no termination/turnover
  -- table exists anywhere in the schema (PRD §9 review note).
  -- ===================================================================
  for subj in select id, team_id from public.profiles where role = 'tl' and active loop
    kpis := '{}'::jsonb;
    skipped := array[]::text[];

    select coalesce(sum(o.units_sold), 0) into v_offtake
    from public.offtake o join public.visits v on v.id = o.visit_id join public.profiles p on p.id = v.nc_id
    where p.team_id = subj.team_id and p.role = 'nc' and o.created_at >= period_start and o.created_at < period_end;

    select coalesce(sum(t.offtake_target), 0) into v_target
    from public.targets t join public.profiles p on p.id = t.nc_id
    where p.team_id = subj.team_id and p.role = 'nc' and t.period_key = p_period_key;

    if v_target > 0 then
      kpis := kpis || jsonb_build_object('team_offtake', least(150, round(100.0 * v_offtake / v_target)));
    else
      skipped := array_append(skipped, 'team_offtake');
    end if;

    select count(distinct g.consumer_id) into v_ntg_count
    from public.ntg_gwp g join public.visits v on v.id = g.visit_id join public.profiles p on p.id = v.nc_id
    where p.team_id = subj.team_id and p.role = 'nc'
      and g.stage in ('ntg_confirmed','gwp_given','wa_followup_scheduled')
      and g.created_at >= period_start and g.created_at < period_end;

    select count(*) into v_nc_count from public.profiles where team_id = subj.team_id and role = 'nc' and active;
    kpis := kpis || jsonb_build_object('team_new_users_conversion', least(150, round(100.0 * v_ntg_count / greatest(1, v_nc_count * 5.0))));

    -- same_day_validation: proxy = % of this team's report_reviews (that
    -- happened this period) whose reviewed_at fell on the same calendar day
    -- as the report's created_at. No pending rows exist in report_reviews by
    -- construction (a row is only ever written by an explicit approve/flag
    -- action — see ReportReview's TS comment) so "% resolved" would trivially
    -- be 100%; measuring same-day turnaround is the actually meaningful proxy.
    select count(*) filter (
             where date_trunc('day', rr.reviewed_at) = date_trunc('day', public.report_created_at(rr.report_type, rr.report_id))
           ),
           count(*)
      into v_reviewed_count, v_total_reports
      from public.report_reviews rr
      join public.visits v on v.id = public.report_visit_id(rr.report_type, rr.report_id)
      join public.profiles p on p.id = v.nc_id
      where p.team_id = subj.team_id and p.role = 'nc'
        and rr.reviewed_at >= period_start and rr.reviewed_at < period_end;

    if v_total_reports > 0 then
      kpis := kpis || jsonb_build_object('same_day_validation', round(100.0 * v_reviewed_count / v_total_reports));
    else
      -- Exception-based queue (PRD §8): nothing needed manual review this
      -- period is a good outcome, not missing data — score as fully caught up.
      kpis := kpis || jsonb_build_object('same_day_validation', 100);
    end if;

    select count(*) into v_coaching_count
    from public.coaching_logs cl where cl.tl_id = subj.id and cl.date >= period_start and cl.date < period_end;
    -- Documented default target: >=1 coaching visit per NC per month = 100%.
    kpis := kpis || jsonb_build_object('coaching_visits', least(100, round(100.0 * v_coaching_count / greatest(1, v_nc_count))));

    skipped := array_append(skipped, 'team_retention');

    select coalesce(sum(swc.weight_pct * (kpis->>swc.kpi_key)::numeric) / nullif(sum(swc.weight_pct), 0), 0),
           coalesce(sum(swc.weight_pct), 0)
      into score, computable_weight
      from public.scorecard_weight_config swc
      where swc.role = 'tl' and kpis ? swc.kpi_key;

    status := case when computable_weight = 0 then 'needs_attention'
                   when score >= 80 then 'on_track'
                   when score >= 60 then 'needs_attention'
                   else 'below_target' end;

    insert into public.scorecards (id, subject_id, role, period_key, score, status, breakdown, computed_at)
    values ('sc_' || subj.id || '_' || p_period_key, subj.id, 'tl', p_period_key, score, status,
            kpis || jsonb_build_object('_skipped', to_jsonb(skipped)), now())
    on conflict (subject_id, period_key) do update set
      role = excluded.role, score = excluded.score, status = excluded.status,
      breakdown = excluded.breakdown, computed_at = excluded.computed_at;
  end loop;

  -- ===================================================================
  -- ARCO — 3 of 5 computable. "activation_execution" and
  -- "fulfilment_sla_retention" skipped: no data mapping exists for either
  -- (no activation-program or fulfilment/turnover tables in this schema).
  -- ===================================================================
  for subj in select id from public.profiles where role = 'arco' and active loop
    kpis := '{}'::jsonb;
    skipped := array[]::text[];

    select coalesce(sum(o.units_sold), 0) into v_offtake
    from public.offtake o join public.visits v on v.id = o.visit_id join public.profiles p on p.id = v.nc_id
    where p.role = 'nc' and p.team_id in (select id from public.teams where arco_id = subj.id)
      and o.created_at >= period_start and o.created_at < period_end;

    select coalesce(sum(t.offtake_target), 0) into v_target
    from public.targets t join public.profiles p on p.id = t.nc_id
    where p.role = 'nc' and p.team_id in (select id from public.teams where arco_id = subj.id) and t.period_key = p_period_key;

    if v_target > 0 then
      kpis := kpis || jsonb_build_object('regional_offtake', least(150, round(100.0 * v_offtake / v_target)));
    else
      skipped := array_append(skipped, 'regional_offtake');
    end if;

    select count(distinct g.consumer_id) into v_ntg_count
    from public.ntg_gwp g join public.visits v on v.id = g.visit_id join public.profiles p on p.id = v.nc_id
    where p.role = 'nc' and p.team_id in (select id from public.teams where arco_id = subj.id)
      and g.stage in ('ntg_confirmed','gwp_given','wa_followup_scheduled')
      and g.created_at >= period_start and g.created_at < period_end;

    select count(*) into v_nc_count from public.profiles
      where role = 'nc' and active and team_id in (select id from public.teams where arco_id = subj.id);

    kpis := kpis || jsonb_build_object('regional_new_users_conversion', least(150, round(100.0 * v_ntg_count / greatest(1, v_nc_count * 5.0))));

    skipped := array_append(skipped, 'activation_execution');
    skipped := array_append(skipped, 'fulfilment_sla_retention');

    -- reporting_accuracy proxy: 100 - flagged-rate among this region's
    -- reviewed reports this period (fewer flags = more accurate field reporting).
    select count(*) filter (where rr.status = 'flagged'), count(*)
      into v_reviewed_count, v_total_reports
      from public.report_reviews rr
      join public.visits v on v.id = public.report_visit_id(rr.report_type, rr.report_id)
      join public.profiles p on p.id = v.nc_id
      where p.role = 'nc' and p.team_id in (select id from public.teams where arco_id = subj.id)
        and rr.reviewed_at >= period_start and rr.reviewed_at < period_end;

    if v_total_reports > 0 then
      kpis := kpis || jsonb_build_object('reporting_accuracy', round(100.0 * (v_total_reports - v_reviewed_count) / v_total_reports));
    else
      kpis := kpis || jsonb_build_object('reporting_accuracy', 100);
    end if;

    select coalesce(sum(swc.weight_pct * (kpis->>swc.kpi_key)::numeric) / nullif(sum(swc.weight_pct), 0), 0),
           coalesce(sum(swc.weight_pct), 0)
      into score, computable_weight
      from public.scorecard_weight_config swc
      where swc.role = 'arco' and kpis ? swc.kpi_key;

    status := case when computable_weight = 0 then 'needs_attention'
                   when score >= 80 then 'on_track'
                   when score >= 60 then 'needs_attention'
                   else 'below_target' end;

    insert into public.scorecards (id, subject_id, role, period_key, score, status, breakdown, computed_at)
    values ('sc_' || subj.id || '_' || p_period_key, subj.id, 'arco', p_period_key, score, status,
            kpis || jsonb_build_object('_skipped', to_jsonb(skipped)), now())
    on conflict (subject_id, period_key) do update set
      role = excluded.role, score = excluded.score, status = excluded.status,
      breakdown = excluded.breakdown, computed_at = excluded.computed_at;
  end loop;

  -- ===================================================================
  -- PM — 2 of 5 computable. "fulfilment_sla" (no SLA/staffing-fulfilment
  -- table), "attrition_vs_target" (attrition signal exists per-NC via
  -- kpi.ts's attritionSignal, but no *target* rate to compare it against is
  -- ever set anywhere), and "client_review_score" (comes from Reckitt, no
  -- capture mechanism exists) are all skipped — no fabricated numbers.
  -- ===================================================================
  for subj in select id from public.profiles where role = 'pm' and active loop
    kpis := '{}'::jsonb;
    skipped := array[]::text[];

    select coalesce(sum(o.units_sold), 0) into v_offtake from public.offtake o
      where o.created_at >= period_start and o.created_at < period_end;
    select coalesce(sum(t.offtake_target), 0) into v_target from public.targets t where t.period_key = p_period_key;
    select count(distinct g.consumer_id) into v_ntg_count from public.ntg_gwp g
      where g.stage in ('ntg_confirmed','gwp_given','wa_followup_scheduled')
        and g.created_at >= period_start and g.created_at < period_end;
    select count(*) into v_nc_count from public.profiles where role = 'nc' and active;

    if v_target > 0 then
      -- PRD §9 names this as one combined KPI ("program offtake/new users") —
      -- averaging the two normalized components rather than picking one.
      kpis := kpis || jsonb_build_object('program_offtake_new_users',
        round((least(150, 100.0 * v_offtake / v_target) + least(150, 100.0 * v_ntg_count / greatest(1, v_nc_count * 5.0))) / 2.0));
    else
      skipped := array_append(skipped, 'program_offtake_new_users');
    end if;

    skipped := array_append(skipped, 'fulfilment_sla');
    skipped := array_append(skipped, 'attrition_vs_target');
    skipped := array_append(skipped, 'client_review_score');

    select count(*) filter (where rr.status = 'flagged'), count(*)
      into v_reviewed_count, v_total_reports
      from public.report_reviews rr
      where rr.reviewed_at >= period_start and rr.reviewed_at < period_end;

    if v_total_reports > 0 then
      kpis := kpis || jsonb_build_object('reporting_accuracy', round(100.0 * (v_total_reports - v_reviewed_count) / v_total_reports));
    else
      kpis := kpis || jsonb_build_object('reporting_accuracy', 100);
    end if;

    select coalesce(sum(swc.weight_pct * (kpis->>swc.kpi_key)::numeric) / nullif(sum(swc.weight_pct), 0), 0),
           coalesce(sum(swc.weight_pct), 0)
      into score, computable_weight
      from public.scorecard_weight_config swc
      where swc.role = 'pm' and kpis ? swc.kpi_key;

    status := case when computable_weight = 0 then 'needs_attention'
                   when score >= 80 then 'on_track'
                   when score >= 60 then 'needs_attention'
                   else 'below_target' end;

    insert into public.scorecards (id, subject_id, role, period_key, score, status, breakdown, computed_at)
    values ('sc_' || subj.id || '_' || p_period_key, subj.id, 'pm', p_period_key, score, status,
            kpis || jsonb_build_object('_skipped', to_jsonb(skipped)), now())
    on conflict (subject_id, period_key) do update set
      role = excluded.role, score = excluded.score, status = excluded.status,
      breakdown = excluded.breakdown, computed_at = excluded.computed_at;
  end loop;

  -- ===================================================================
  -- Lead Trainer — 2 of 5 partially computable, and both depend on the
  -- `certifications` table, which has NO data-entry UI built anywhere yet
  -- (the table has existed since Phase 1, but no screen writes to it) — so
  -- in practice these will show as skipped ("no certifications this period")
  -- until that UI exists. The other 3 ("training_schedule_adherence",
  -- "kpi_uplift_post_training", "mystery_shopper") have no data source at
  -- all in this schema.
  -- ===================================================================
  for subj in select id from public.profiles where role = 'lead_trainer' and active loop
    kpis := '{}'::jsonb;
    skipped := array[]::text[];

    select count(*) filter (where c.passed), count(*)
      into v_reviewed_count, v_total_reports
      from public.certifications c where c.date >= period_start and c.date < period_end;

    if v_total_reports > 0 then
      kpis := kpis || jsonb_build_object('certification_pass_rate', round(100.0 * v_reviewed_count / v_total_reports));
    else
      skipped := array_append(skipped, 'certification_pass_rate');
    end if;

    -- Convention: certifications.cert_type = 'tl_coach' identifies TL-coach
    -- certifications specifically (cert_type is free text — no UI enforces
    -- this value yet, another consequence of the missing certifications UI above).
    select count(*) filter (where c.passed), count(*)
      into v_reviewed_count, v_total_reports
      from public.certifications c where c.cert_type = 'tl_coach' and c.date >= period_start and c.date < period_end;

    if v_total_reports > 0 then
      kpis := kpis || jsonb_build_object('tl_coach_certification', round(100.0 * v_reviewed_count / v_total_reports));
    else
      skipped := array_append(skipped, 'tl_coach_certification');
    end if;

    skipped := array_append(skipped, 'training_schedule_adherence');
    skipped := array_append(skipped, 'kpi_uplift_post_training');
    skipped := array_append(skipped, 'mystery_shopper');

    select coalesce(sum(swc.weight_pct * (kpis->>swc.kpi_key)::numeric) / nullif(sum(swc.weight_pct), 0), 0),
           coalesce(sum(swc.weight_pct), 0)
      into score, computable_weight
      from public.scorecard_weight_config swc
      where swc.role = 'lead_trainer' and kpis ? swc.kpi_key;

    status := case when computable_weight = 0 then 'needs_attention'
                   when score >= 80 then 'on_track'
                   when score >= 60 then 'needs_attention'
                   else 'below_target' end;

    insert into public.scorecards (id, subject_id, role, period_key, score, status, breakdown, computed_at)
    values ('sc_' || subj.id || '_' || p_period_key, subj.id, 'lead_trainer', p_period_key, score, status,
            kpis || jsonb_build_object('_skipped', to_jsonb(skipped)), now())
    on conflict (subject_id, period_key) do update set
      role = excluded.role, score = excluded.score, status = excluded.status,
      breakdown = excluded.breakdown, computed_at = excluded.computed_at;
  end loop;

  -- ===================================================================
  -- Data Analyst — 0 of 5 computable. None of "monthly_report_timeliness",
  -- "data_error_rate", "adopted_recommendations", or "ad_hoc_turnaround" have
  -- any supporting table in this schema. "target_gwp_allocation_timeliness"
  -- specifically would need a created_at column on `targets` to measure
  -- timeliness against — that column doesn't exist (not added here; it's a
  -- schema change out of scope for this pass, noted for a future migration).
  -- Honest all-skip rather than a fabricated score.
  -- ===================================================================
  for subj in select id from public.profiles where role = 'data_analyst' and active loop
    skipped := array['monthly_report_timeliness','data_error_rate','target_gwp_allocation_timeliness','adopted_recommendations','ad_hoc_turnaround'];
    insert into public.scorecards (id, subject_id, role, period_key, score, status, breakdown, computed_at)
    values ('sc_' || subj.id || '_' || p_period_key, subj.id, 'data_analyst', p_period_key, 0, 'needs_attention',
            jsonb_build_object('_skipped', to_jsonb(skipped), '_note', 'Tidak ada KPI Data Analyst yang dapat dihitung dari data yang tersedia saat ini — lihat PRD §15.'),
            now())
    on conflict (subject_id, period_key) do update set
      role = excluded.role, score = excluded.score, status = excluded.status,
      breakdown = excluded.breakdown, computed_at = excluded.computed_at;
  end loop;

  -- ===================================================================
  -- Admin Data Entry — 2 of 5 computable. "daily_consolidation_timeliness"
  -- and "competitor_activity_reports" have no supporting table.
  -- "payroll_incentive_accuracy" is skipped per the still-open PRD §15
  -- question of whether payroll stays a separate SALTAB-fed process — there
  -- is no in-app payroll data to measure accuracy against.
  -- ===================================================================
  for subj in select id from public.profiles where role = 'admin_data_entry' and active loop
    kpis := '{}'::jsonb;
    skipped := array[]::text[];

    select count(*) filter (where s.actual_visit_id is not null), count(*)
      into v_reviewed_count, v_total_reports
      from public.schedules s where s.planned_date >= period_start and s.planned_date < period_end;

    if v_total_reports > 0 then
      kpis := kpis || jsonb_build_object('pjp_schedule_updates', round(100.0 * v_reviewed_count / v_total_reports));
    else
      skipped := array_append(skipped, 'pjp_schedule_updates');
    end if;

    -- Proxy: reuses the same GWP-given-vs-allocated ratio shown on the
    -- PM/Reckitt dashboard, as a stand-in for "how current the GWP absorption
    -- reporting is" — approximates the KPI's intent rather than measuring the
    -- reporting *activity* itself, which isn't separately tracked.
    select coalesce(sum(g.gwp_qty), 0) into v_ntg_count
      from public.ntg_gwp g where g.stage = 'gwp_given' and g.created_at >= period_start and g.created_at < period_end;
    select coalesce(sum(t.gwp_allocation), 0) into v_target from public.targets t where t.period_key = p_period_key;

    if v_target > 0 then
      kpis := kpis || jsonb_build_object('gwp_absorption_reporting', least(150, round(100.0 * v_ntg_count / v_target)));
    else
      skipped := array_append(skipped, 'gwp_absorption_reporting');
    end if;

    skipped := array_append(skipped, 'daily_consolidation_timeliness');
    skipped := array_append(skipped, 'payroll_incentive_accuracy');
    skipped := array_append(skipped, 'competitor_activity_reports');

    select coalesce(sum(swc.weight_pct * (kpis->>swc.kpi_key)::numeric) / nullif(sum(swc.weight_pct), 0), 0),
           coalesce(sum(swc.weight_pct), 0)
      into score, computable_weight
      from public.scorecard_weight_config swc
      where swc.role = 'admin_data_entry' and kpis ? swc.kpi_key;

    status := case when computable_weight = 0 then 'needs_attention'
                   when score >= 80 then 'on_track'
                   when score >= 60 then 'needs_attention'
                   else 'below_target' end;

    insert into public.scorecards (id, subject_id, role, period_key, score, status, breakdown, computed_at)
    values ('sc_' || subj.id || '_' || p_period_key, subj.id, 'admin_data_entry', p_period_key, score, status,
            kpis || jsonb_build_object('_skipped', to_jsonb(skipped)), now())
    on conflict (subject_id, period_key) do update set
      role = excluded.role, score = excluded.score, status = excluded.status,
      breakdown = excluded.breakdown, computed_at = excluded.computed_at;
  end loop;
end;
$$;

grant execute on function public.compute_scorecards(text) to authenticated;

-- No cron/scheduler infrastructure exists in this codebase (no pg_cron, no
-- scheduled Edge Function) and none is added here speculatively — real
-- scheduling (e.g. a monthly pg_cron job calling this RPC, or a scheduled
-- Edge Function) is a deferred ops decision. For now this is triggered
-- manually via a "Hitung Skorkartu" action in ManagementDashboard.tsx.
