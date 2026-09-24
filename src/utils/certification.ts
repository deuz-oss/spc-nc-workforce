import type { Certification } from '../types';
import { inRange, TimeRange } from './period';

/**
 * Parses a session date typed as YYYY-MM-DD into local midnight. Returns null
 * for malformed or impossible dates (e.g. 2026-02-30) and for future dates —
 * a certification result can only be recorded for a session that happened.
 */
export function parseSessionDate(text: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return date.getTime() < endOfToday ? date.getTime() : null;
}

/** Local YYYY-MM-DD, the inverse of parseSessionDate. */
export function toSessionDateText(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Pass rate within a period, optionally for one certification type — the same
 * definition compute_scorecards() (0006) uses for the Lead Trainer's
 * certification_pass_rate (all types) and tl_coach_certification (type
 * 'tl_coach'): passed / total, rounded to a whole percent; null when no results.
 */
export function passRate(
  certs: Certification[],
  range: TimeRange,
  certType?: string,
): { passed: number; total: number; pct: number | null } {
  const inScope = certs.filter((c) => inRange(c.date, range) && (!certType || c.certType === certType));
  const passed = inScope.filter((c) => c.passed).length;
  return { passed, total: inScope.length, pct: inScope.length ? Math.round((100 * passed) / inScope.length) : null };
}
