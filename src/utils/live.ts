/**
 * Live-map status helpers (pure — unit-tested in plain Node).
 *
 * A background GPS point arrives roughly every 15-30 s while an NC is moving
 * (TRACK_INTERVAL_MS / TRACK_MIN_STEP_M), but none arrive while they stand
 * still, and Android may throttle the task. So "stale" is deliberately
 * generous: only after STALE_AFTER_MIN without any update do we warn that the
 * position may be outdated (phone off, GPS disabled, app killed).
 */
export const STALE_AFTER_MIN = 15;

export type LiveState = 'in_store' | 'on_the_road' | 'stale';

export function liveState(positionAt: number, inStore: boolean, now: number): LiveState {
  if (now - positionAt > STALE_AFTER_MIN * 60000) return 'stale';
  return inStore ? 'in_store' : 'on_the_road';
}

/** "baru saja" / "5 menit lalu" / "2 jam 10 menit lalu". */
export function agoLabel(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / 60000));
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} menit lalu`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} jam ${m} menit lalu` : `${h} jam lalu`;
}
