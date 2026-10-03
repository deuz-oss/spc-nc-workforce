/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRange,
  historyWindowStart,
  inRange,
  monthKey,
  monthLabel,
  monthRange,
  programDayKey,
  programDayStart,
  shiftMonth,
} from './period';

const DAY = 86400000;
/** A WIB wall-clock time as a timestamp — independent of the machine's zone. */
const wib = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo, d, h - 7, mi);

describe('program time (WIB)', () => {
  it('buckets days on the WIB calendar whatever the device zone', () => {
    // 23:30 WIB on 30 Sep is still 30 Sep, even though it's 1 Oct 00:30 in WITA.
    assert.equal(programDayKey(wib(2026, 8, 30, 23, 30)), '2026-09-30');
    // 00:30 WIB on 1 Oct is already 1 Oct (it's still 30 Sep in UTC).
    assert.equal(programDayKey(wib(2026, 9, 1, 0, 30)), '2026-10-01');
  });

  it('programDayStart is WIB midnight', () => {
    assert.equal(programDayStart(wib(2026, 8, 24, 14, 5)), wib(2026, 8, 24));
  });
});

describe('monthKey', () => {
  it('formats the WIB year-month with zero padding', () => {
    assert.equal(monthKey(new Date(wib(2026, 0, 15, 12))), '2026-01');
    assert.equal(monthKey(new Date(wib(2026, 11, 31, 23, 59))), '2026-12');
  });

  it('is WIB at the very start of a month (not UTC via toISOString)', () => {
    assert.equal(monthKey(new Date(wib(2026, 9, 1, 0, 30))), '2026-10');
  });
});

describe('shiftMonth', () => {
  it('moves within a year', () => {
    assert.equal(shiftMonth('2026-09', 1), '2026-10');
    assert.equal(shiftMonth('2026-09', -1), '2026-08');
  });

  it('crosses year boundaries', () => {
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2026-03', -15), '2024-12');
  });
});

describe('monthRange / monthLabel', () => {
  it('spans the WIB month, including months of another year', () => {
    assert.deepEqual(monthRange('2025-12'), { from: wib(2025, 11, 1), to: wib(2026, 0, 1) });
    assert.equal(monthLabel('2025-12'), 'Des 2025');
  });
});

describe('inRange', () => {
  it('is inclusive of from and exclusive of to', () => {
    const r = { from: 100, to: 200 };
    assert.equal(inRange(100, r), true);
    assert.equal(inRange(199, r), true);
    assert.equal(inRange(200, r), false);
    assert.equal(inRange(99, r), false);
  });
});

describe('getRange', () => {
  const now = wib(2026, 9, 1, 0, 30); // Thursday 1 Oct 2026, 00:30 WIB

  it('daily covers the WIB day', () => {
    assert.deepEqual(getRange('daily', undefined, now), { from: wib(2026, 9, 1), to: wib(2026, 9, 2) });
  });

  it('weekly starts on Monday (WIB) and spans 7 days containing now', () => {
    const r = getRange('weekly', undefined, now);
    assert.equal(r.from, wib(2026, 8, 28)); // Monday 28 Sep
    assert.equal(r.to - r.from, 7 * DAY);
    assert.ok(inRange(now, r));
  });

  it('monthly defaults to the current WIB month and accepts any month', () => {
    assert.deepEqual(getRange('monthly', undefined, now), monthRange('2026-10'));
    assert.deepEqual(getRange('monthly', '2025-12', now), monthRange('2025-12'));
  });

  it('all starts at epoch and includes now', () => {
    const r = getRange('all', undefined, now);
    assert.equal(r.from, 0);
    assert.ok(inRange(now, r));
  });
});

describe('historyWindowStart', () => {
  it('returns WIB midnight `days` days before now', () => {
    assert.equal(historyWindowStart(new Date(wib(2026, 8, 24, 14, 5)), 62), wib(2026, 6, 24));
  });

  it('62 days always covers the whole previous month, even on the last day of a month', () => {
    for (const [now, prev] of [
      [wib(2026, 2, 31, 23), '2026-02'],
      [wib(2026, 0, 1, 0, 5), '2025-12'],
      [wib(2026, 6, 31, 12), '2026-06'],
    ] as const) {
      assert.ok(historyWindowStart(new Date(now), 62) <= monthRange(prev).from, prev);
    }
  });
});
