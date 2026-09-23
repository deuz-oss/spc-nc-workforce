import { Attendance, NtgGwp, OfftakeRow, StockTakingRow, Visit } from '../types';
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

/**
 * Phase 2 addition: today's completion glance for the 3 daily core-loop
 * modules (Stock Taking, Offtake, NTG & GWP — PRD §16 phase 2). Deliberately
 * NOT part of the scorecard engine (unscored, no weights) — that's still
 * Phase 4; this only powers a same-day dashboard nudge for the NC.
 */
export interface TodaysReportStatus {
  stockTaking: boolean;
  offtake: boolean;
  ntgGwp: boolean;
  /** An open (not checked-out) visit today, if any — lets the dashboard link straight into it. */
  activeVisitId: string | null;
}

export function todaysReportStatus(
  ncId: string,
  visits: Visit[],
  stockTaking: StockTakingRow[],
  offtake: OfftakeRow[],
  ntgGwps: NtgGwp[],
): TodaysReportStatus {
  return reportStatusForDay(new Date(), ncId, visits, stockTaking, offtake, ntgGwps);
}

/** Generalizes todaysReportStatus to an arbitrary day — Phase 4a (PRD §16) needs
 * this over the last few days for the TL/ARCO attrition-risk signal below. */
export function reportStatusForDay(
  day: Date,
  ncId: string,
  visits: Visit[],
  stockTaking: StockTakingRow[],
  offtake: OfftakeRow[],
  ntgGwps: NtgGwp[],
): TodaysReportStatus {
  const key = day.toDateString();
  const dayVisitIds = new Set(
    visits.filter((v) => v.ncId === ncId && new Date(v.checkInAt).toDateString() === key).map((v) => v.id),
  );
  const activeVisit = visits.find((v) => v.ncId === ncId && !v.checkOutAt);
  return {
    stockTaking: stockTaking.some((r) => dayVisitIds.has(r.visitId)),
    offtake: offtake.some((r) => dayVisitIds.has(r.visitId)),
    ntgGwp: ntgGwps.some((g) => dayVisitIds.has(g.visitId)),
    activeVisitId: activeVisit?.id ?? null,
  };
}

/**
 * Attrition-risk signal for the TL/ARCO rollup (PRD §8/§9). Deliberately
 * implements only the two concrete, PRD-stated signals that don't require a
 * threshold judgment call PRD never made:
 *  (a) attendance gaps — no clock-in at all on >=3 of the last 7 calendar days
 *  (b) missing daily reports — none of Stock Taking/Offtake/NTG&GWP submitted
 *      on >=3 of the last 7 calendar days
 * The PRD's third stated signal ("two consecutive weeks of declining
 * performance") needs a trend formula across weighted KPIs that was never
 * specified (see PRD §9's review note and §15) — NOT implemented here rather
 * than guessing one. Revisit once that definition exists.
 */
export interface AttritionSignal {
  attendanceGap: boolean;
  missingReports: boolean;
  atRisk: boolean;
}

export function attritionSignal(
  ncId: string,
  attendances: Attendance[],
  visits: Visit[],
  stockTaking: StockTakingRow[],
  offtake: OfftakeRow[],
  ntgGwps: NtgGwp[],
  today: Date = new Date(),
): AttritionSignal {
  let noAttendanceDays = 0;
  let noReportDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    const hasAttendance = attendances.some((a) => a.userId === ncId && new Date(a.clockInAt).toDateString() === key);
    if (!hasAttendance) noAttendanceDays++;
    const status = reportStatusForDay(d, ncId, visits, stockTaking, offtake, ntgGwps);
    if (!status.stockTaking && !status.offtake && !status.ntgGwp) noReportDays++;
  }
  const attendanceGap = noAttendanceDays >= 3;
  const missingReports = noReportDays >= 3;
  return { attendanceGap, missingReports, atRisk: attendanceGap || missingReports };
}

/** Count of Offtake rows flagged by the server-side trigger (PRD §5.3) within a period — for a TL/ARCO glance later (Phase 4 console). */
export function outlierCount(offtake: OfftakeRow[], range: { from: number; to: number }): number {
  return offtake.filter((o) => o.isOutlier && inRange(o.createdAt, range)).length;
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
