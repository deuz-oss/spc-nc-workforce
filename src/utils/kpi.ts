import { Attendance, Visit } from '../types';
import { C } from '../theme';
import { polylineKm } from './geo';
import { inRange } from './period';

/**
 * Phase 1 scope only: attendance/visit-derived discipline metrics (PRD §7).
 * The full 7-role weighted scorecard engine (PRD §9) — including the
 * `scorecard_weight_config`-driven formulas recommended during PRD review —
 * is Phase 4 work (PRD §16) and deliberately NOT implemented here yet.
 *
 * Targets per PRD §7: geo-fence compliance >=99%, valid visit (geofence +
 * duration >=10min + photo evidence) >=95%. Working Hours = clock-in to
 * clock-out. CFT (Customer Facing Time) = sum of store visit durations.
 * MWH (Market Working Hours) definition is still open (PRD §7/§15) — until
 * decided, MWH = Working Hours, so it's not modeled as a separate figure here.
 */
export const TARGETS = {
  workHoursDay: 8,
  fencePct: 99,
  validVisitPct: 95,
  minStayMinutes: 10,
} as const;

export interface NcStat {
  userId: string;
  name: string;
  days: number;
  sessions: number;
  workMs: number;
  /** CFT — sum of closed-visit durations for the period */
  cftMs: number;
  km: number;
  visits: number;
  distinctStores: number;
  /** % kunjungan yang memenuhi definisi valid visit (geofence + durasi >=10 menit) — evidence-photo
   * check is per report-module, not modeled at the visit level yet (Phase 2+). */
  validVisits: number;
  validVisitPct: number | null;
  fencePct: number | null;
  targetWorkMs: number;
}

export function computeNcStat(
  userId: string,
  name: string,
  att: Attendance[],
  vst: Visit[],
  range: { from: number; to: number },
): NcStat {
  const a = att.filter((x) => x.userId === userId && inRange(x.clockInAt, range));
  const vs = vst.filter((v) => v.ncId === userId && inRange(v.checkInAt, range));
  const closed = vs.filter((v) => v.checkOutAt);

  const days = new Set(a.map((x) => new Date(x.clockInAt).toDateString())).size;
  const workMs = a.reduce((t, x) => t + ((x.clockOutAt ?? Date.now()) - x.clockInAt), 0);
  const cftMs = closed.reduce((t, v) => t + ((v.checkOutAt ?? 0) - v.checkInAt), 0);

  const minStayMs = TARGETS.minStayMinutes * 60000;
  const validVisits = closed.filter(
    (v) => v.geoValid && (v.checkOutAt ?? 0) - v.checkInAt >= minStayMs,
  ).length;

  return {
    userId,
    name,
    days,
    sessions: a.length,
    workMs,
    cftMs,
    km: a.reduce((t, x) => t + polylineKm(x.route), 0),
    visits: vs.length,
    distinctStores: new Set(vs.map((v) => v.storeId)).size,
    validVisits,
    validVisitPct: closed.length ? Math.round((100 * validVisits) / closed.length) : null,
    fencePct: a.length ? Math.round((100 * a.filter((x) => x.geoFenceOk).length) / a.length) : null,
    targetWorkMs: Math.max(1, days) * TARGETS.workHoursDay * 3600000,
  };
}

export function statusOf(s: NcStat): { label: string; color: string } {
  if (s.days === 0) return { label: 'Tanpa Absensi', color: C.muted };
  let fails = 0;
  if (s.workMs < s.targetWorkMs * 0.75) fails++;
  if (s.fencePct != null && s.fencePct < TARGETS.fencePct) fails++;
  if (s.validVisitPct != null && s.validVisitPct < TARGETS.validVisitPct) fails++;
  if (fails === 0) return { label: 'On Track', color: C.ok };
  if (fails === 1) return { label: 'Perlu Perhatian', color: C.warn };
  return { label: 'Di Bawah Target', color: C.accent };
}
