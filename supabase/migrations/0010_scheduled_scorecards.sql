-- Automatic scorecards (PRD §9) + a hole in compute_scorecards' access check.
-- Run after 0009_targets_uniqueness.sql.
--
-- 1. SECURITY: compute_scorecards() guards itself with
--      if public.current_role() not in ('data_analyst','pm','super_admin') then raise ...
--    For a caller with no active profile, current_role() is NULL, and
--    `NULL not in (...)` is NULL, which plpgsql treats as false — so the
--    check silently passes. Postgres also grants EXECUTE on new functions to
--    PUBLIC by default. Net effect (verified against the live project before
--    this migration): the public anon key alone could run a full
--    program-wide scorecard computation, on demand, as often as it liked.
--    Fix: the original becomes an internal-only compute_scorecards_core();
--    a new compute_scorecards() wrapper enforces the role check NULL-safely.
--
-- 2. SCHEDULE: scores were only recomputed when someone pressed "Hitung
--    Skorkartu", so they went stale after every target change or late
--    offline sync. A nightly pg_cron job now recomputes the current month
--    (WIB), and — for the first 5 days of a month — the previous month too,
--    so reports synced late from offline phones still land in last month's
--    final score.
--
-- 3. Also revokes anon EXECUTE on the other callable helpers/RPCs (none has
--    any use without a signed-in user; report_visit_id/report_created_at
--    would otherwise let anyone map report ids to visits and timestamps).

-- =========================================================
-- 1. Lock down compute_scorecards
-- =========================================================
alter function public.compute_scorecards(text) rename to compute_scorecards_core;
revoke execute on function public.compute_scorecards_core(text) from public, anon, authenticated;
-- (keeps its `set timezone = 'Asia/Jakarta'` from 0008)

create or replace function public.compute_scorecards(p_period_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_role(), '') not in ('data_analyst', 'pm', 'super_admin') then
    raise exception 'forbidden: data_analyst, pm, or super_admin only';
  end if;
  if p_period_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid period_key %, expected YYYY-MM', p_period_key;
  end if;
  perform public.compute_scorecards_core(p_period_key);
end;
$$;

revoke execute on function public.compute_scorecards(text) from public, anon;
grant execute on function public.compute_scorecards(text) to authenticated;

-- =========================================================
-- 2. Nightly schedule
-- =========================================================
create extension if not exists pg_cron;

-- Runs as the job owner (postgres) with no auth.uid(): calls the core
-- function directly. Not callable through the API.
create or replace function public.run_scheduled_scorecards()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  wib timestamp := now() at time zone 'Asia/Jakarta';
begin
  perform public.compute_scorecards_core(to_char(wib, 'YYYY-MM'));
  if extract(day from wib) <= 5 then
    perform public.compute_scorecards_core(to_char(wib - interval '1 month', 'YYYY-MM'));
  end if;
end;
$$;

revoke execute on function public.run_scheduled_scorecards() from public, anon, authenticated;

-- 18:00 UTC = 01:00 WIB, after the field day's offline syncs have landed.
-- cron.schedule() with an existing job name updates that job, so re-running
-- this migration is safe.
select cron.schedule('nightly-scorecards', '0 18 * * *', 'select public.run_scheduled_scorecards()');

-- =========================================================
-- 3. No anonymous access to callable helpers / RPCs
-- =========================================================
revoke execute on function public.report_visit_id(text, text) from public, anon;
revoke execute on function public.report_created_at(text, text) from public, anon;
revoke execute on function public.can_converse(text, uuid, uuid) from public, anon;
revoke execute on function public.finish_visit(text, timestamptz) from public, anon;
revoke execute on function public.mark_messages_read(text) from public, anon;
revoke execute on function public.set_my_push_token(text) from public, anon;
grant execute on function public.report_visit_id(text, text) to authenticated;
grant execute on function public.report_created_at(text, text) to authenticated;
grant execute on function public.can_converse(text, uuid, uuid) to authenticated;
grant execute on function public.finish_visit(text, timestamptz) to authenticated;
grant execute on function public.mark_messages_read(text) to authenticated;
grant execute on function public.set_my_push_token(text) to authenticated;
