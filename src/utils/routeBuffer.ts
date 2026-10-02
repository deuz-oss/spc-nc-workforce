import AsyncStorage from '@react-native-async-storage/async-storage';
import { appendCapped, RoutePointInput, selectNewPoints } from './routeFilter';

export type { RoutePointInput };

/**
 * On-device buffer of GPS route points, between the location callback and the
 * server. Every point is persisted here first and uploaded later
 * (routeSync.ts), so a point survives no signal, a failed request, and a
 * killed app. Deliberately independent of the zustand store: when Android
 * restarts the background task headless (app killed), the store was never
 * hydrated — this module only needs AsyncStorage.
 */

export interface BufferedPoint extends RoutePointInput {
  attendanceId: string;
}

/** What the background task needs to record points without the store: whose
 * session is being tracked, and the last point kept (for the min-step filter). */
export interface TrackingContext {
  userId: string;
  attendanceId: string;
  last: RoutePointInput | null;
}

const CONTEXT_KEY = 'spc_nc_tracking_ctx_v1';
const bufferKey = (userId: string) => `spc_nc_route_buffer_v1:${userId}`;

/** ~ a week of 15-second pings; beyond that the oldest points are dropped
 * rather than letting the buffer grow without bound on a phone that never syncs. */
export const MAX_BUFFERED_POINTS = 20000;

// Serializes read-modify-write cycles within this JS runtime (the location
// callback and an upload finishing can interleave).
let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort — e.g. storage full */
  }
}

export function getTrackingContext(): Promise<TrackingContext | null> {
  return readJson<TrackingContext | null>(CONTEXT_KEY, null);
}

/**
 * Starts (or keeps) tracking `attendanceId`. If the stored context already
 * tracks this attendance, its last point is kept — it may be newer than the
 * store's copy of the route (points recorded while the app was killed).
 */
export function startTrackingContext(userId: string, attendanceId: string, fallbackLast: RoutePointInput | null): Promise<void> {
  return withLock(async () => {
    const current = await getTrackingContext();
    if (current && current.attendanceId === attendanceId && current.userId === userId) return;
    await writeJson(CONTEXT_KEY, { userId, attendanceId, last: fallbackLast } satisfies TrackingContext);
  });
}

export function clearTrackingContext(): Promise<void> {
  return withLock(async () => {
    try {
      await AsyncStorage.removeItem(CONTEXT_KEY);
    } catch {
      /* best-effort */
    }
  });
}

type RecordedListener = (userId: string, points: BufferedPoint[]) => void;
const listeners = new Set<RecordedListener>();

/** Notified (in this runtime) after points are buffered — the store uses it to
 * extend the open attendance's route on screen. */
export function onPointsRecorded(fn: RecordedListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Buffers the worthwhile points of one location batch for the tracked
 * session. Returns the tracked user (null when nothing is being tracked). */
export function recordLocations(batch: RoutePointInput[], minStepM: number): Promise<string | null> {
  return withLock(async () => {
    const ctx = await getTrackingContext();
    if (!ctx) return null;
    const { kept, last } = selectNewPoints(ctx.last, batch, minStepM);
    if (!kept.length) return ctx.userId;
    const points: BufferedPoint[] = kept.map((p) => ({ ...p, attendanceId: ctx.attendanceId }));
    const buffer = await readJson<BufferedPoint[]>(bufferKey(ctx.userId), []);
    await writeJson(bufferKey(ctx.userId), appendCapped(buffer, points, MAX_BUFFERED_POINTS));
    await writeJson(CONTEXT_KEY, { ...ctx, last } satisfies TrackingContext);
    for (const fn of listeners) {
      try {
        fn(ctx.userId, points);
      } catch (e) {
        console.warn('route listener failed:', e instanceof Error ? e.message : e);
      }
    }
    return ctx.userId;
  });
}

export function readBufferedPoints(userId: string): Promise<BufferedPoint[]> {
  return readJson<BufferedPoint[]>(bufferKey(userId), []);
}

/** Removes uploaded (or permanently rejected) points, matched by attendance + time. */
export function removeBufferedPoints(userId: string, points: BufferedPoint[]): Promise<void> {
  if (!points.length) return Promise.resolve();
  const gone = new Set(points.map((p) => `${p.attendanceId}|${p.t}`));
  return withLock(async () => {
    const buffer = await readJson<BufferedPoint[]>(bufferKey(userId), []);
    await writeJson(
      bufferKey(userId),
      buffer.filter((p) => !gone.has(`${p.attendanceId}|${p.t}`)),
    );
  });
}
