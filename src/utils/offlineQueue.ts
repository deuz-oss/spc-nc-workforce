import AsyncStorage from '@react-native-async-storage/async-storage';
import { Attendance, Visit } from '../types';

/**
 * Persisted queue of writes that couldn't reach Supabase because the device
 * was offline at the time. Scope is intentionally limited to clock-in/out and
 * store check-in/out — the actions with a clear, idempotent server insert/update
 * and an existing optimistic-local-state pattern (PRD §13 flags the remaining
 * 7 report-module submissions as a separate, not-yet-sized offline extension —
 * see project README). Each op carries the full row it needs (not just an id)
 * because after a cold app restart, hydrateAll() only pulls what the server
 * already has — a still-queued row won't be there yet.
 */
export type QueuedOp =
  | { id: string; type: 'clockIn'; attendance: Attendance }
  | { id: string; type: 'clockOut'; attendanceId: string; clockOutAt: number; lat: number; lng: number }
  | { id: string; type: 'startVisit'; visit: Visit }
  | { id: string; type: 'finishVisit'; visitId: string; checkOutAt: number };

const QUEUE_KEY = 'spc_nc_offline_queue_v1';

export async function loadQueue(): Promise<QueuedOp[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

export async function saveQueue(queue: QueuedOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* best-effort — worst case the queue is lost on next cold start */
  }
}
