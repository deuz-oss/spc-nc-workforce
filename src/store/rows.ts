/**
 * Pure list helpers for the store's optimistic writes — no React Native /
 * Supabase imports, so they're unit-testable (rows.test.ts).
 */

/**
 * The list after rolling back a failed optimistic write that touched `ids`:
 * those rows go back to their versions in `before` (or disappear if they were
 * new), rows the write had removed reappear, and every other row is left as
 * it is now — restoring a whole-list snapshot would also wipe rows changed by
 * other writes or realtime events while the request was in flight.
 */
export function rollbackRows<T extends { id: string }>(current: T[], ids: string[], before: T[]): T[] {
  const touched = new Set(ids);
  const prev = new Map(before.filter((r) => touched.has(r.id)).map((r) => [r.id, r]));
  const kept = current.flatMap((r) => (touched.has(r.id) ? (prev.has(r.id) ? [prev.get(r.id)!] : []) : [r]));
  const currentIds = new Set(current.map((r) => r.id));
  const missing = [...prev.values()].filter((r) => !currentIds.has(r.id));
  return [...missing, ...kept];
}
