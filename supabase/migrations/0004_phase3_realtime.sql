-- Phase 3 ("Bi-weekly/periodic modules" — PRD §16): Share of Shelf, Paid
-- Visibility, Price Monitoring, Survey (+ Nutrition Quiz, PRD §6).
--
-- No RLS changes needed here — 0001_init.sql already enabled RLS with correct
-- policies on share_of_shelf/paid_visibility/price_monitoring/surveys/
-- survey_responses (verified against the same visit_is_own_or_scoped /
-- visit_is_own pattern used by stock_taking/offtake, and against the
-- consumers RLS bug 0003 already fixed — no equivalent gap found here).
--
-- What WAS missing: these 5 tables were never added to the `supabase_realtime`
-- publication (0001_init.sql's publication statement only covers
-- profiles/teams/stores/visits/attendances/route_points/messages; 0003 added
-- products/stock_taking/offtake/consumers/ntg_gwp). Without this, the
-- subscribeRealtime() listeners added for these tables in useStore.ts would
-- silently never fire.
alter publication supabase_realtime add table
  public.share_of_shelf, public.paid_visibility, public.price_monitoring,
  public.surveys, public.survey_responses;
