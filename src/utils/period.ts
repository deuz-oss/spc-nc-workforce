export type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'all';

export interface TimeRange {
  from: number;
  to: number;
}

const DAY = 86400000;

/**
 * Program time = WIB (UTC+7; Indonesia has no daylight saving). Every
 * day / week / month boundary in the app is computed in WIB, the same zone the
 * server uses for scorecards, outliers and report checks (Asia/Jakarta) — so a
 * phone in a WITA/WIT city, or set to another zone, still puts a report on the
 * same day the scorecard does. Times shown to the user stay in the phone's
 * own zone (utils/format.ts); only the bucketing is WIB.
 */
export const PROGRAM_UTC_OFFSET_MS = 7 * 3600000;

/** Year / month (0-based) / day / weekday (0 = Sunday) of `ts` on the WIB calendar. */
export function programParts(ts: number): { y: number; m: number; d: number; dow: number } {
  const w = new Date(ts + PROGRAM_UTC_OFFSET_MS);
  return { y: w.getUTCFullYear(), m: w.getUTCMonth(), d: w.getUTCDate(), dow: w.getUTCDay() };
}

/** Start (WIB midnight) of the program day containing `ts`. */
export function programDayStart(ts: number): number {
  const { y, m, d } = programParts(ts);
  return Date.UTC(y, m, d) - PROGRAM_UTC_OFFSET_MS;
}

/** 'YYYY-MM-DD' of the program (WIB) day containing `ts` — for "same day" comparisons. */
export function programDayKey(ts: number): string {
  return new Date(ts + PROGRAM_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM' (WIB) — the targets / scorecards period_key format. */
export function monthKey(d: Date = new Date()): string {
  const { y, m } = programParts(d.getTime());
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Shifts a 'YYYY-MM' key by `delta` months (handles year boundaries). */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** The WIB month 'YYYY-MM' as a time range. */
export function monthRange(key: string): TimeRange {
  const [y, m] = key.split('-').map(Number);
  return { from: Date.UTC(y, m - 1, 1) - PROGRAM_UTC_OFFSET_MS, to: Date.UTC(y, m, 1) - PROGRAM_UTC_OFFSET_MS };
}

/** 'Sep 2026' for a 'YYYY-MM' key. */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

/**
 * Range of a period, in program time: today, this week (Monday first), the
 * month `month` ('YYYY-MM', default the current one — any year), or everything.
 */
export function getRange(key: PeriodKey, month?: string, now: number = Date.now()): TimeRange {
  if (key === 'daily') {
    const s = programDayStart(now);
    return { from: s, to: s + DAY };
  }
  if (key === 'weekly') {
    const s = programDayStart(now);
    const dow = (programParts(now).dow + 6) % 7; // Senin=0
    const from = s - dow * DAY;
    return { from, to: from + 7 * DAY };
  }
  if (key === 'monthly') return monthRange(month ?? monthKey(new Date(now)));
  return { from: 0, to: now + DAY };
}

export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'daily', label: 'Harian' },
  { key: 'weekly', label: 'Mingguan' },
  { key: 'monthly', label: 'Bulanan' },
  { key: 'all', label: 'Semua' },
];

export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

/** Start of the login history window: WIB midnight `days` days before `now`. */
export function historyWindowStart(now: Date, days: number): number {
  return programDayStart(now.getTime()) - days * DAY;
}

export function inRange(ts: number, r: TimeRange): boolean {
  return ts >= r.from && ts < r.to;
}
