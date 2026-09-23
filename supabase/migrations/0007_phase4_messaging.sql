-- Phase 4b ("scorecard computation + in-app messaging" — PRD §16): push-token
-- storage for in-app messaging (PRD §17), plus two realtime-publication gaps
-- found while wiring this phase.

-- =========================================================
-- 1. push_token on profiles, written only via a scoped RPC.
--
-- Deliberately NOT a self-service RLS UPDATE policy: `profiles` already has
-- exactly one UPDATE policy (`profiles_write_super_admin`, super_admin only —
-- 0001 migration). Postgres RLS OR's multiple permissive policies for the
-- same command together, so adding a second permissive policy like
-- `using (auth.uid() = id)` for "update your own push_token" would actually
-- let any authenticated user update ANY column of their OWN row — including
-- `role` — not just push_token, since RLS policies gate whole rows, not
-- columns. A security-definer RPC (mirroring finish_visit's pattern, 0001
-- migration) scopes the write to exactly one column with no such leak.
-- =========================================================
alter table public.profiles add column if not exists push_token text;

create or replace function public.set_my_push_token(p_token text) returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set push_token = p_token where id = auth.uid();
$$;

grant execute on function public.set_my_push_token(text) to authenticated;

-- =========================================================
-- 2. Realtime publication gaps.
--
-- `public.conversations` was never added (only `messages` was, in 0001) —
-- needed now that ChatListScreen/useStore.ts subscribe to it for live
-- conversation updates.
--
-- `public.targets` was ALSO never added, since Phase 1 (0001's publication
-- list is profiles/teams/stores/visits/attendances/route_points/messages —
-- no targets). This predates Phase 4b entirely: Phase 4a wired a full
-- targets realtime listener into useStore.ts's subscribeRealtime() assuming
-- it would fire, but without this it's been silent dead code since that
-- phase — the same class of gap Phase 3 and Phase 4a each independently
-- found and fixed for their OWN new tables, just missed here because
-- `targets` wasn't a table either of those phases created. Fixing it now
-- since it's directly adjacent to this migration's publication work.
-- =========================================================
alter publication supabase_realtime add table
  public.conversations, public.targets;
