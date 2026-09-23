import AsyncStorage from '@react-native-async-storage/async-storage';
import { Attendance, OfftakeRow, PaidVisibilityRow, PriceMonitoringRow, ShareOfShelfRow, StockTakingRow, Visit } from '../types';

/**
 * Persisted queue of writes that couldn't reach Supabase because the device
 * was offline at the time. Originally scoped to clock-in/out and store
 * check-in/out (Phase 1) — the actions with a clear, idempotent server
 * insert/update and an existing optimistic-local-state pattern. Phase 2 adds
 * Stock Taking and Offtake (text-primary daily-critical reports). Phase 5
 * extends this to every photo-based report module (Stock Taking's optional
 * photo, Share of Shelf/Paid Visibility's required photo, Price Monitoring's
 * optional photo): a picked photo is copied to a stable local path
 * (`persistPhotoLocally`, src/utils/storage.ts) and carried as `localPhotoUri`
 * — the *upload* itself is deferred to replay time, never baked into the
 * row's `photoUrl` up front, so a required-photo row can never be inserted
 * without one (see `replayOp` in useStore.ts). The richer NTG & GWP consumer
 * flow stays online-required — it's not a per-visit report submission in the
 * same sense and is low-frequency enough not to justify queuing (PRD review
 * note). **Native only** — web keeps the pre-Phase-5 online-required-for-photo
 * behavior (browser-picked file/blob URIs don't reliably survive a page
 * reload the way a native `file://` copy does; see README's existing "Web
 * hanya selama tab terbuka" caveat). Each op carries the full row(s) it needs
 * (not just an id) because after a cold app restart, hydrateAll() only pulls
 * what the server already has — a still-queued row won't be there yet.
 */
export type QueuedOp =
  | { id: string; type: 'clockIn'; attendance: Attendance }
  | { id: string; type: 'clockOut'; attendanceId: string; clockOutAt: number; lat: number; lng: number }
  | { id: string; type: 'startVisit'; visit: Visit }
  | { id: string; type: 'finishVisit'; visitId: string; checkOutAt: number }
  | { id: string; type: 'submitStockTaking'; rows: StockTakingRow[]; localPhotoUri?: string }
  | { id: string; type: 'submitOfftake'; rows: OfftakeRow[] }
  | { id: string; type: 'submitPriceMonitoring'; rows: PriceMonitoringRow[]; localPhotoUri?: string }
  | { id: string; type: 'submitShareOfShelf'; row: Omit<ShareOfShelfRow, 'photoUrl'>; localPhotoUri: string }
  | { id: string; type: 'submitPaidVisibility'; row: Omit<PaidVisibilityRow, 'photoUrl'>; localPhotoUri: string };

/** Pre-audit single shared key — any ops found here are migrated into the
 * first user's queue that loads after upgrading. */
const LEGACY_QUEUE_KEY = 'spc_nc_offline_queue_v1';

/** One queue per user: ops carry that user's ids and can only pass RLS under
 * that user's session, so a queue left behind at logout must never be
 * replayed by whoever logs in next on the same device. */
const queueKey = (userId: string) => `spc_nc_offline_queue_v2:${userId}`;

export async function loadQueue(userId: string): Promise<QueuedOp[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKey(userId));
    const queue = raw ? (JSON.parse(raw) as QueuedOp[]) : [];
    const legacyRaw = await AsyncStorage.getItem(LEGACY_QUEUE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as QueuedOp[];
      const merged = [...legacy.filter((l) => !queue.some((q) => q.id === l.id)), ...queue];
      await AsyncStorage.setItem(queueKey(userId), JSON.stringify(merged));
      await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
      return merged;
    }
    return queue;
  } catch {
    return [];
  }
}

export async function saveQueue(userId: string, queue: QueuedOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(queueKey(userId), JSON.stringify(queue));
  } catch {
    /* best-effort — worst case the queue is lost on next cold start */
  }
}
