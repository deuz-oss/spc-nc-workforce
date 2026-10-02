import { haversineM } from './geo';

/** Pure route-point helpers for routeBuffer.ts — no React Native imports, so
 * they're unit-testable in plain Node (routeFilter.test.ts). */

export interface RoutePointInput {
  lat: number;
  lng: number;
  /** When the fix was taken (Location.timestamp), not when it was processed. */
  t: number;
}

/**
 * Pure: the points from one location batch worth keeping — in time order,
 * newer than the last kept point, and at least `minStepM` away from the
 * previously kept one (standing still doesn't add points).
 */
export function selectNewPoints(
  last: RoutePointInput | null,
  batch: RoutePointInput[],
  minStepM: number,
): { kept: RoutePointInput[]; last: RoutePointInput | null } {
  const kept: RoutePointInput[] = [];
  let prev = last;
  for (const p of [...batch].sort((a, b) => a.t - b.t)) {
    if (prev && p.t <= prev.t) continue;
    if (prev && haversineM(prev, p) < minStepM) continue;
    kept.push(p);
    prev = p;
  }
  return { kept, last: prev };
}

/** Pure: appends, capping the buffer at `max` by dropping the oldest points. */
export function appendCapped<T>(buffer: T[], added: T[], max: number): T[] {
  const next = [...buffer, ...added];
  return next.length > max ? next.slice(next.length - max) : next;
}
