import type { Schedule, Visit } from '../types';
import { getRange, programDayKey, programDayStart } from './period';

/**
 * PJP (Permanent Journey Plan) helpers — planned store visits per NC per WIB
 * day. Pure, unit-tested in pjp.test.ts. The server links a plan to the NC's
 * check-in (actual_visit_id, migration 0020); the local visit match below
 * covers the moments before that link arrives (offline check-in, realtime lag).
 */

const DAY = 86400000;

/** Field days of a PJP week. */
export const PJP_DAYS_PER_WEEK = 6; // Monday–Saturday

/** WIB Monday 00:00 of the week containing `ts`. */
export function weekStart(ts: number): number {
  return getRange('weekly', undefined, ts).from;
}

/** The week's field days (Mon–Sat), WIB midnight each. */
export function weekDays(start: number): number[] {
  return Array.from({ length: PJP_DAYS_PER_WEEK }, (_, i) => start + i * DAY);
}

export type ScheduleStatus = 'visited' | 'missed' | 'planned';

/** Visited (server link, or an own check-in at that store that WIB day), missed (day over), or still planned. */
export function scheduleStatus(s: Schedule, visits: Visit[], now: number = Date.now()): ScheduleStatus {
  if (s.actualVisitId) return 'visited';
  const day = programDayKey(s.plannedDate);
  if (visits.some((v) => v.ncId === s.ncId && v.storeId === s.storeId && programDayKey(v.checkInAt) === day)) return 'visited';
  return programDayStart(s.plannedDate) + DAY <= now ? 'missed' : 'planned';
}

/** Plans of one NC due in [from, to) and up to now, and how many were visited. */
export function planCompliance(
  schedules: Schedule[],
  visits: Visit[],
  ncIds: Set<string>,
  range: { from: number; to: number },
  now: number = Date.now(),
): { due: number; visited: number } {
  let due = 0;
  let visited = 0;
  for (const s of schedules) {
    if (!ncIds.has(s.ncId) || s.plannedDate < range.from || s.plannedDate >= range.to || s.plannedDate > now) continue;
    due++;
    if (scheduleStatus(s, visits, now) === 'visited') visited++;
  }
  return { due, visited };
}

/**
 * "Copy last week": the plans of `ncId` in the week starting `fromStart`,
 * moved to the same weekday of the week starting `toStart` — minus the ones
 * already planned there.
 */
export function copyWeekPlan(
  schedules: Schedule[],
  ncId: string,
  fromStart: number,
  toStart: number,
): { storeId: string; plannedDate: number }[] {
  const inWeek = (s: Schedule, start: number) => s.ncId === ncId && s.plannedDate >= start && s.plannedDate < start + 7 * DAY;
  const existing = new Set(
    schedules.filter((s) => inWeek(s, toStart)).map((s) => `${s.storeId}|${programDayKey(s.plannedDate)}`),
  );
  const out: { storeId: string; plannedDate: number }[] = [];
  for (const s of schedules) {
    if (!inWeek(s, fromStart)) continue;
    const plannedDate = programDayStart(s.plannedDate) - fromStart + toStart;
    const key = `${s.storeId}|${programDayKey(plannedDate)}`;
    if (existing.has(key)) continue;
    existing.add(key);
    out.push({ storeId: s.storeId, plannedDate });
  }
  return out;
}
