import type { QueuedOp } from '../utils/offlineQueue';

/**
 * Offline-queue replay rules, kept free of React Native / Supabase imports so
 * they can be unit-tested in plain Node (see src/store/replay.test.ts).
 *
 * Outcome of replaying one queued op:
 * - `done`: landed server-side (or already had — a duplicate-key insert means a
 *   previous attempt succeeded but its response was lost), drop it.
 * - `retry`: transient (network/5xx/upload) failure, keep it and stop replaying
 *   later ops so their order is preserved (clock-out never lands before clock-in).
 * - `failed`: the server rejected it deterministically (constraint, RLS, missing
 *   parent row) — retrying would fail forever and block every op behind it, so
 *   it's dropped and reported to the user.
 * - `dropped`: unrecoverable and already explained to the user by the handler.
 */
export type ReplayResult = 'done' | 'retry' | 'failed' | 'dropped';

/** Postgres error classes that fail identically on every retry: 22 data
 * exception, 23 integrity constraint, 42 syntax/privilege (incl. 42501 RLS),
 * P0 raised by a function (e.g. finish_visit's "not found"). */
export function settle(error: { code?: string } | null): ReplayResult {
  if (!error || error.code === '23505') return 'done';
  return error.code && /^(22|23|42|P0)/.test(error.code) ? 'failed' : 'retry';
}

export const OP_LABEL: Record<QueuedOp['type'], string> = {
  clockIn: 'Clock-in',
  clockOut: 'Clock-out',
  startVisit: 'Check-in toko',
  finishVisit: 'Check-out toko',
  submitStockTaking: 'Stock Taking',
  submitOfftake: 'Offtake',
  submitPriceMonitoring: 'Price Monitoring',
  submitShareOfShelf: 'Share of Shelf',
  submitPaidVisibility: 'Paid Visibility',
};

/**
 * Replays the queue head-first, one op at a time. `head()` is re-read every
 * iteration so ops enqueued mid-replay are neither lost nor replayed out of
 * order. Stops at the first `retry` (keeping that op and everything after
 * it), and when `stillValid()` turns false (e.g. the user logged out).
 */
export async function drainQueue(io: {
  head: () => QueuedOp | undefined;
  replay: (op: QueuedOp) => Promise<ReplayResult>;
  remove: (op: QueuedOp) => Promise<void>;
  stillValid: () => boolean;
}): Promise<{ synced: number; failed: QueuedOp[] }> {
  let synced = 0;
  const failed: QueuedOp[] = [];
  for (;;) {
    const op = io.head();
    if (!op || !io.stillValid()) break;
    const result = await io.replay(op);
    if (result === 'retry') break;
    if (result === 'failed') failed.push(op);
    if (result === 'done') synced++;
    await io.remove(op);
  }
  return { synced, failed };
}
