import { supabase } from '../lib/supabase';
import { settle } from '../store/replay';
import { loadQueue } from './offlineQueue';
import { BufferedPoint, readBufferedPoints, removeBufferedPoints } from './routeBuffer';

const UPLOAD_CHUNK = 500;

let flushing: Promise<FlushResult> | null = null;

/** 'offline' = stopped at a network/server error; the rest stays buffered. */
export type FlushResult = 'ok' | 'offline';

/**
 * Uploads the user's buffered route points (routeBuffer.ts). Safe to call from
 * anywhere, any number of times — the app on reconnect / after the offline
 * queue drains / before a clock-out, and the background location task after
 * every batch (also headless: it only needs the persisted session and queue).
 *
 * Points of an attendance whose clock-in is still in the offline queue wait:
 * the attendances row doesn't exist server-side yet. Uploads are idempotent
 * (ON CONFLICT DO NOTHING on attendance_id + recorded_at, migration 0013), so
 * a response lost mid-flight just re-sends harmlessly.
 */
export function flushRouteBuffer(userId: string): Promise<FlushResult> {
  if (!flushing) {
    flushing = flushOnce(userId).finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function flushOnce(userId: string): Promise<FlushResult> {
  const points = await readBufferedPoints(userId);
  if (!points.length) return 'ok';

  // Only ever upload as this user. Without a usable session (offline with an
  // expired token, signed out, another user) the requests would go out as
  // anon, RLS would reject them as permanent failures, and the points would
  // be dropped — keep them for later instead.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user.id !== userId) return 'offline';

  const queue = await loadQueue(userId);
  const unsyncedAttendances = new Set(queue.flatMap((op) => (op.type === 'clockIn' ? [op.attendance.id] : [])));

  const byAttendance = new Map<string, BufferedPoint[]>();
  for (const p of points) {
    if (unsyncedAttendances.has(p.attendanceId)) continue;
    const list = byAttendance.get(p.attendanceId) ?? [];
    list.push(p);
    byAttendance.set(p.attendanceId, list);
  }

  for (const [attendanceId, list] of byAttendance) {
    for (let i = 0; i < list.length; i += UPLOAD_CHUNK) {
      const chunk = list.slice(i, i + UPLOAD_CHUNK);
      const rows = chunk.map((p) => ({
        attendance_id: attendanceId,
        user_id: userId,
        lat: p.lat,
        lng: p.lng,
        recorded_at: new Date(p.t).toISOString(),
      }));
      let { error } = await supabase
        .from('route_points')
        .upsert(rows, { onConflict: 'attendance_id,recorded_at', ignoreDuplicates: true });
      // 42P10: no unique index to resolve the conflict on — migration 0013 not
      // applied yet. Plain insert still works, just without the dedup.
      if (error?.code === '42P10') ({ error } = await supabase.from('route_points').insert(rows));

      const result = settle(error);
      if (result === 'retry') return 'offline';
      if (result === 'failed') {
        // 23503: the attendance isn't on the server (yet) — keep its points.
        if (error?.code === '23503') break;
        // Anything else won't succeed on retry (e.g. the point lies outside the
        // session, RLS) — drop rather than block the buffer forever.
        console.warn(`route points rejected for ${attendanceId}, dropping ${chunk.length}:`, error?.message);
      }
      await removeBufferedPoints(userId, chunk);
    }
  }
  return 'ok';
}
