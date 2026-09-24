/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionDate, passRate, toSessionDateText } from './certification';
import type { Certification } from '../types';

const NOW = new Date(2026, 8, 24, 14, 0);

describe('parseSessionDate', () => {
  it('parses YYYY-MM-DD to local midnight', () => {
    assert.equal(parseSessionDate('2026-09-01', NOW), new Date(2026, 8, 1).getTime());
    assert.equal(parseSessionDate(' 2026-09-24 ', NOW), new Date(2026, 8, 24).getTime()); // today is allowed
  });

  it('rejects malformed, impossible and future dates', () => {
    for (const bad of ['', '24-09-2026', '2026-9-1', '2026-02-30', '2026-13-01', '2026-09-25', 'abc']) {
      assert.equal(parseSessionDate(bad, NOW), null, bad);
    }
  });

  it('round-trips with toSessionDateText', () => {
    const ts = new Date(2026, 0, 5).getTime();
    assert.equal(toSessionDateText(ts), '2026-01-05');
    assert.equal(parseSessionDate(toSessionDateText(ts), NOW), ts);
  });
});

describe('passRate', () => {
  const cert = (d: number, passed: boolean, certType = 'nc_onboarding'): Certification => ({
    id: `c${d}${passed}${certType}`,
    userId: 'u',
    certType,
    date: new Date(2026, 8, d).getTime(),
    passed,
  });
  const SEPT = { from: new Date(2026, 8, 1).getTime(), to: new Date(2026, 9, 1).getTime() };
  const certs = [cert(2, true), cert(3, false), cert(4, true, 'tl_coach'), cert(5, false, 'tl_coach'), cert(6, false, 'tl_coach')];

  it('matches the scorecard definition: passed / total in the period, whole percent', () => {
    assert.deepEqual(passRate(certs, SEPT), { passed: 2, total: 5, pct: 40 });
    assert.deepEqual(passRate(certs, SEPT, 'tl_coach'), { passed: 1, total: 3, pct: 33 });
  });

  it('is null when there are no results (scorecard skips the KPI rather than scoring 0)', () => {
    const OCT = { from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 10, 1).getTime() };
    assert.deepEqual(passRate(certs, OCT), { passed: 0, total: 0, pct: null });
  });
});
