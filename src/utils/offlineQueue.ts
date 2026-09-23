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
