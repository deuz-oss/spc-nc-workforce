export type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'all';

export interface TimeRange {
  from: number;
  to: number;
}

const DAY = 86400000;

export function getRange(key: PeriodKey, monthIdx: number): TimeRange {
  const now = new Date();
  const y = now.getFullYear();
  if (key === 'daily') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { from: s, to: s + DAY };
  }
  if (key === 'weekly') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dow = (d.getDay() + 6) % 7; // Senin=0
    const s = d.getTime() - dow * DAY;
    return { from: s, to: s + 7 * DAY };
  }
  if (key === 'monthly') {
    const s = new Date(y, monthIdx, 1).getTime();
    const e = new Date(y, monthIdx + 1, 1).getTime();
    return { from: s, to: e };
  }
  return { from: 0, to: Date.now() + DAY };
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

/** 'YYYY-MM' in LOCAL time — the targets/scorecards period_key format. Never
 * derive this from toISOString(): that's UTC, so from 00:00-07:00 WIB on the
 * 1st it still names the previous month. */
export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Shifts a 'YYYY-MM' key by `delta` months (handles year boundaries). */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

/** Start of the login history window: local midnight `days` days before `now`. */
export function historyWindowStart(now: Date, days: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

export function inRange(ts: number, r: TimeRange): boolean {
  return ts >= r.from && ts < r.to;
}
