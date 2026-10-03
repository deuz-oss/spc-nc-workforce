-- Scorecard fairness + atomic consumer save. Run after 0016_audit_log_outlier_autoclose.sql.
--
-- 1. SCORECARDS (compute_scorecards_core — body from 0006, with only these changes):
--    a. NC "attendance" divided days attended by CALENDAR days, Sundays
--       included, so a full 6-day week could never score 100. It now uses
--       working days, Monday–Saturday (work_days_between) — adjust that
--       function if the program's schedule differs (e.g. per-NC PJP rest days).
--    b. A subject with no computable KPI got a score of 0 and "needs
--       attention" (every Data Analyst, every month; a Lead Trainer in a month
--       without certifications). Such subjects now get no scorecard row at all
--       — the app shows "belum dapat dinilai" instead of a fabricated failure.
--    c. The inline role check is gone from the core: the compute_scorecards()
--       wrapper (0010) enforces it, and the nightly job runs without a user.
--
-- 2. CONSUMER + FIRST FUNNEL STEP were two separate writes; if the second one
--    failed, a consumer existed with no funnel stage. save_consumer_with_step()
--    does both in one transaction. SECURITY INVOKER: the caller's RLS policies
--    and every consumer / ntg_gwp trigger (0014, 0015) still apply.

-- =========================================================
-- 1. Working days + scorecard core
-- =========================================================
-- Monday–Saturday days in [p_from, p_to).
create or replace function public.work_days_between(p_from date, p_to date) returns int
language sql immutable as $$
  select count(*)::int
    from generate_series(p_from, p_to - 1, interval '1 day') g(d)
   where extract(isodow from g.d) <> 7
$$;

create or replace function public.compute_scorecards_core(p_period_key text)
returns void
language plpgsql
security definer
set search_path = public
set timezone to 'Asia/Jakarta'
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
    v_cal_days := greatest(1, public.work_days_between(period_start::date, least(period_end, now())::date));
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

    if computable_weight = 0 then
      -- Nothing computable this period: no score rather than a fabricated 0.
      delete from public.scorecards where subject_id = subj.id and period_key = p_period_key;
      continue;
    end if;

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

    if computable_weight = 0 then
      -- Nothing computable this period: no score rather than a fabricated 0.
      delete from public.scorecards where subject_id = subj.id and period_key = p_period_key;
      continue;
    end if;

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

    if computable_weight = 0 then
      -- Nothing computable this period: no score rather than a fabricated 0.
      delete from public.scorecards where subject_id = subj.id and period_key = p_period_key;
      continue;
    end if;

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

    if computable_weight = 0 then
      -- Nothing computable this period: no score rather than a fabricated 0.
      delete from public.scorecards where subject_id = subj.id and period_key = p_period_key;
      continue;
    end if;

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

    if computable_weight = 0 then
      -- Nothing computable this period: no score rather than a fabricated 0.
      delete from public.scorecards where subject_id = subj.id and period_key = p_period_key;
      continue;
    end if;

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
  -- Data Analyst: none of the PRD §9 KPIs has a data source yet — no score at
  -- all rather than a misleading 0 / "needs attention" (see 0017).
  delete from public.scorecards where role = 'data_analyst' and period_key = p_period_key;

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

    if computable_weight = 0 then
      -- Nothing computable this period: no score rather than a fabricated 0.
      delete from public.scorecards where subject_id = subj.id and period_key = p_period_key;
      continue;
    end if;

    insert into public.scorecards (id, subject_id, role, period_key, score, status, breakdown, computed_at)
    values ('sc_' || subj.id || '_' || p_period_key, subj.id, 'admin_data_entry', p_period_key, score, status,
            kpis || jsonb_build_object('_skipped', to_jsonb(skipped)), now())
    on conflict (subject_id, period_key) do update set
      role = excluded.role, score = excluded.score, status = excluded.status,
      breakdown = excluded.breakdown, computed_at = excluded.computed_at;
  end loop;
end;
$$;

revoke execute on function public.compute_scorecards_core(text) from public, anon, authenticated;

-- =========================================================
-- 2. Consumer + funnel step in one transaction
-- =========================================================
create or replace function public.save_consumer_with_step(p_consumer jsonb, p_is_new boolean, p_step jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_is_new then
    insert into public.consumers (id, name, wa_contact, consent, consent_version, child_age_bracket,
                                  current_brand, quiz_result, created_by_nc_id, created_at)
    values (p_consumer ->> 'id', p_consumer ->> 'name', p_consumer ->> 'wa_contact',
            (p_consumer ->> 'consent')::boolean, p_consumer ->> 'consent_version',
            p_consumer ->> 'child_age_bracket', p_consumer ->> 'current_brand', p_consumer ->> 'quiz_result',
            auth.uid(), coalesce((p_consumer ->> 'created_at')::timestamptz, now()));
  else
    update public.consumers
       set name = p_consumer ->> 'name',
           wa_contact = p_consumer ->> 'wa_contact',
           consent = (p_consumer ->> 'consent')::boolean,
           consent_version = p_consumer ->> 'consent_version',
           child_age_bracket = p_consumer ->> 'child_age_bracket',
           current_brand = p_consumer ->> 'current_brand',
           quiz_result = p_consumer ->> 'quiz_result'
     where id = p_consumer ->> 'id';
    if not found then
      raise exception 'Data konsumen tidak ditemukan atau bukan milik Anda.';
    end if;
  end if;

  if p_step is not null then
    insert into public.ntg_gwp (id, consumer_id, visit_id, stage, gwp_item, gwp_qty, offtake_id, created_at)
    values (p_step ->> 'id', p_consumer ->> 'id', p_step ->> 'visit_id', p_step ->> 'stage',
            p_step ->> 'gwp_item', (p_step ->> 'gwp_qty')::numeric, p_step ->> 'offtake_id',
            (p_step ->> 'created_at')::timestamptz);
  end if;
end;
$$;

revoke execute on function public.save_consumer_with_step(jsonb, boolean, jsonb) from public, anon;
grant execute on function public.save_consumer_with_step(jsonb, boolean, jsonb) to authenticated;
