/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRange, historyWindowStart, inRange, monthKey, shiftMonth } from './period';

const DAY = 86400000;

describe('monthKey', () => {
  it('formats local year-month with zero padding', () => {
    assert.equal(monthKey(new Date(2026, 0, 15)), '2026-01');
    assert.equal(monthKey(new Date(2026, 11, 31, 23, 59)), '2026-12');
  });

  it('uses local time at the very start of a month (not UTC via toISOString)', () => {
    // 00:30 local on 1 Oct — toISOString() would give 30 Sep in any UTC+ zone (e.g. WIB).
    assert.equal(monthKey(new Date(2026, 9, 1, 0, 30)), '2026-10');
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
  it('daily covers exactly today from local midnight', () => {
    const r = getRange('daily', 0);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    assert.equal(r.from, midnight.getTime());
    assert.equal(r.to - r.from, DAY);
    assert.ok(inRange(Date.now(), r));
  });

  it('weekly starts on Monday and spans 7 days containing now', () => {
    const r = getRange('weekly', 0);
    assert.equal(new Date(r.from).getDay(), 1);
    assert.equal(r.to - r.from, 7 * DAY);
    assert.ok(inRange(Date.now(), r));
  });

  it('monthly spans the given month of the current year', () => {
    const y = new Date().getFullYear();
    const r = getRange('monthly', 1); // February
    assert.equal(r.from, new Date(y, 1, 1).getTime());
    assert.equal(r.to, new Date(y, 2, 1).getTime());
  });

  it('all starts at epoch and includes now', () => {
    const r = getRange('all', 0);
    assert.equal(r.from, 0);
    assert.ok(inRange(Date.now(), r));
  });
});

describe('historyWindowStart', () => {
  it('returns local midnight `days` days before now', () => {
    const start = new Date(historyWindowStart(new Date(2026, 8, 24, 14, 5), 62));
    assert.deepEqual(
      [start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()],
      [2026, 6, 24, 0, 0],
    );
  });

  it('62 days always covers the whole previous month, even on the last day of a month', () => {
    for (const now of [new Date(2026, 2, 31, 23), new Date(2026, 0, 1, 0, 5), new Date(2026, 6, 31, 12)]) {
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      assert.ok(historyWindowStart(now, 62) <= prevMonthStart, now.toDateString());
    }
  });
});
