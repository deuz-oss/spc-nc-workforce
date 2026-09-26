-- Live team positions for TL / ARCO / monitor roles. Run after 0011.
--
-- Field report: an NC's background GPS was recording correctly (28 points in
-- 14 minutes, verified in route_points), but the TL could not see the NC's
-- location anywhere. The app only loaded the viewer's OWN route points, and
-- the Validasi live map only showed store check-ins, not clocked-in NCs.
--
-- live_positions() returns ONE row per open attendance (clocked in, not yet
-- clocked out, clock-in within the last 24h): the latest route point, or the
-- clock-in position if no point has arrived yet. It is SECURITY INVOKER (the
-- default), so the caller's existing RLS on attendances / route_points does
-- the scoping: a TL sees their team, an ARCO their teams, monitor roles
-- everyone. The caller's own row is excluded.
--
-- Cost: DISTINCT ON over route_points_attendance_idx (attendance_id,
-- recorded_at) — one index probe per open attendance, not a scan of every
-- ping of the day.

create or replace function public.live_positions()
returns table (
  user_id uuid,
  attendance_id text,
  lat double precision,
  lng double precision,
  recorded_at timestamptz,
  clock_in_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select a.user_id,
         a.id,
         coalesce(rp.lat, a.clock_in_lat),
         coalesce(rp.lng, a.clock_in_lng),
         coalesce(rp.recorded_at, a.clock_in_at),
         a.clock_in_at
    from public.attendances a
    left join lateral (
      select p.lat, p.lng, p.recorded_at
        from public.route_points p
       where p.attendance_id = a.id
       order by p.recorded_at desc
       limit 1
    ) rp on true
   where a.clock_out_at is null
     and a.clock_in_at > now() - interval '24 hours'
     and a.user_id <> auth.uid()
$$;

revoke execute on function public.live_positions() from public, anon;
grant execute on function public.live_positions() to authenticated;
