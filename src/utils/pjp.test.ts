/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyWeekPlan, planCompliance, scheduleStatus, weekDays, weekStart } from './pjp';
import type { Schedule, Visit } from '../types';

/** WIB wall-clock time as a timestamp, independent of the machine's zone. */
const wib = (d: number, h = 0) => Date.UTC(2026, 9, d, h - 7); // October 2026
const plan = (id: string, day: number, storeId = 's1', extra: Partial<Schedule> = {}): Schedule => ({
  id, ncId: 'nc1', storeId, plannedDate: wib(day), ...extra,
});
const visit = (day: number, h: number, storeId = 's1'): Visit => ({
  id: `v${day}${h}`, storeId, ncId: 'nc1', checkInAt: wib(day, h), checkOutAt: null, lat: 0, lng: 0, storeDistanceM: 1, geoValid: true,
});

describe('weekStart / weekDays', () => {
  it('starts on WIB Monday and lists Monday–Saturday', () => {
    const start = weekStart(wib(8, 15)); // Thursday 8 Oct 2026
    assert.equal(start, wib(5)); // Monday 5 Oct
    const days = weekDays(start);
    assert.equal(days.length, 6);
    assert.equal(days[5], wib(10)); // Saturday
  });
});

describe('scheduleStatus', () => {
  it('is visited by the server link or a same-day check-in at that store', () => {
    assert.equal(scheduleStatus(plan('a', 6, 's1', { actualVisitId: 'v' }), [], wib(9)), 'visited');
    assert.equal(scheduleStatus(plan('a', 6), [visit(6, 10)], wib(9)), 'visited');
    assert.equal(scheduleStatus(plan('a', 6), [visit(6, 10, 'other')], wib(9)), 'missed');
  });

  it('is planned until its WIB day is over, then missed', () => {
    assert.equal(scheduleStatus(plan('a', 6), [], wib(6, 23)), 'planned');
    assert.equal(scheduleStatus(plan('a', 6), [], wib(7, 0)), 'missed');
  });
});

describe('planCompliance', () => {
  it('counts only plans already due, and the visited ones among them', () => {
    const s = [plan('a', 5), plan('b', 6), plan('c', 9)];
    const r = planCompliance(s, [visit(5, 9)], new Set(['nc1']), { from: wib(5), to: wib(12) }, wib(7));
    assert.deepEqual(r, { due: 2, visited: 1 });
  });
});

describe('copyWeekPlan', () => {
  it('moves last week to the same weekdays, skipping what is already planned', () => {
    const s = [plan('a', 5, 's1'), plan('b', 7, 's2'), plan('c', 12, 's1')]; // c already planned next Monday
    const out = copyWeekPlan(s, 'nc1', wib(5), wib(12));
    assert.deepEqual(out, [{ storeId: 's2', plannedDate: wib(14) }]);
  });
});
