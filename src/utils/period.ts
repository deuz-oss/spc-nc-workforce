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

export function inRange(ts: number, r: TimeRange): boolean {
  return ts >= r.from && ts < r.to;
}
