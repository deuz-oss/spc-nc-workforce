/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attritionSignal, computeNcStat, reportStatusForDay, statusOf } from './kpi';
import { detectStops, haversineM, polylineKm } from './geo';
import type { Attendance, StockTakingRow, Visit } from '../types';

const MIN = 60000;
const HOUR = 60 * MIN;
const day = (d: number, h = 9, m = 0) => new Date(2026, 8, d, h, m).getTime(); // September 2026, local time
const SEPT = { from: new Date(2026, 8, 1).getTime(), to: new Date(2026, 9, 1).getTime() };

function visit(id: string, checkIn: number, stayMin: number | null, geoValid = true, ncId = 'nc1'): Visit {
  return {
    id,
    storeId: `st_${id}`,
    ncId,
    checkInAt: checkIn,
    checkOutAt: stayMin == null ? null : checkIn + stayMin * MIN,
    lat: -6.2,
    lng: 106.8,
    storeDistanceM: 10,
    geoValid,
  };
}

function attendance(id: string, clockIn: number, hours: number, geoFenceOk = true, userId = 'nc1'): Attendance {
  return { id, userId, clockInAt: clockIn, clockInLat: -6.2, clockInLng: 106.8, clockOutAt: clockIn + hours * HOUR, route: [], geoFenceOk };
}

const stock = (visitId: string): StockTakingRow => ({ id: `stk_${visitId}`, visitId, storeId: 'st', sku: 'X', qtyOnHand: 1, outOfStock: false, createdAt: 0 });

describe('geo', () => {
  it('haversineM: ~111 km per degree of latitude', () => {
    const d = haversineM({ lat: 0, lng: 106.8 }, { lat: 1, lng: 106.8 });
    assert.ok(Math.abs(d - 111195) < 50, String(d));
  });

  it('polylineKm sums segments', () => {
    const km = polylineKm([
      { lat: 0, lng: 0, t: 0 },
      { lat: 0.01, lng: 0, t: 1 },
      { lat: 0.02, lng: 0, t: 2 },
    ]);
    assert.ok(Math.abs(km - 2.2239) < 0.001, String(km));
  });

  it('detectStops finds a long dwell and ignores a short one', () => {
    const pts = [
      { lat: 0, lng: 0, t: 0 },
      { lat: 0.00001, lng: 0, t: 15 * MIN }, // same spot for 15 min -> stop
      { lat: 0.01, lng: 0, t: 20 * MIN }, // moved ~1.1 km
      { lat: 0.01, lng: 0, t: 22 * MIN }, // 2 min -> traffic light, not a stop
      { lat: 0.02, lng: 0, t: 30 * MIN },
    ];
    const stops = detectStops(pts);
    assert.equal(stops.length, 1);
    assert.equal(stops[0].durationMs, 15 * MIN);
  });
});

describe('computeNcStat', () => {
  it('valid visit = geo-valid AND stayed >= 10 minutes; open visits count as visits but not in the %', () => {
    const visits = [
      visit('ok', day(2), 30),
      visit('short', day(2, 11), 5), // too short
      visit('offsite', day(3), 30, false), // outside radius
      visit('open', day(4), null), // still checked in
      visit('other_nc', day(2), 30, true, 'nc2'),
      visit('august', new Date(2026, 7, 31).getTime(), 30),
    ];
    const s = computeNcStat('nc1', 'Budi', [], visits, SEPT);
    assert.equal(s.visits, 4);
    assert.equal(s.validVisits, 1);
    assert.equal(s.validVisitPct, 33); // 1 of 3 closed visits
    assert.equal(s.cftMs, 65 * MIN);
  });

  it('counts distinct working days, work time and geo-fence %', () => {
    const att = [attendance('a1', day(1), 8), attendance('a2', day(1, 18), 1, false), attendance('a3', day(2), 7)];
    const s = computeNcStat('nc1', 'Budi', att, [], SEPT);
    assert.equal(s.days, 2);
    assert.equal(s.sessions, 3);
    assert.equal(s.workMs, 16 * HOUR);
    assert.equal(s.fencePct, 67);
    assert.equal(s.targetWorkMs, 2 * 8 * HOUR);
  });

  it('returns null percentages when there is nothing to measure', () => {
    const s = computeNcStat('nc1', 'Budi', [], [], SEPT);
    assert.equal(s.validVisitPct, null);
    assert.equal(s.fencePct, null);
    assert.equal(statusOf(s).label, 'Tanpa Absensi');
  });
});

describe('statusOf', () => {
  it('On Track when hours, geo-fence and valid visits all meet target', () => {
    const att = [attendance('a1', day(1), 8)];
    const s = computeNcStat('nc1', 'Budi', att, [visit('v', day(1, 10), 20)], SEPT);
    assert.equal(statusOf(s).label, 'On Track');
  });

  it('escalates with the number of missed targets', () => {
    const oneMiss = computeNcStat('nc1', 'Budi', [attendance('a1', day(1), 8, false)], [], SEPT);
    assert.equal(statusOf(oneMiss).label, 'Perlu Perhatian');
    const twoMiss = computeNcStat('nc1', 'Budi', [attendance('a1', day(1), 1, false)], [], SEPT);
    assert.equal(statusOf(twoMiss).label, 'Di Bawah Target');
  });
});

describe('reportStatusForDay', () => {
  it('only counts reports on that NC’s visits that day, and finds the open visit', () => {
    const visits = [visit('today', day(10), null), visit('yesterday', day(9), 30), visit('theirs', day(10), 30, true, 'nc2')];
    const st = reportStatusForDay(new Date(day(10, 15)), 'nc1', visits, [stock('yesterday'), stock('theirs')], [], []);
    assert.equal(st.stockTaking, false);
    assert.equal(st.activeVisitId, 'today');
    const st2 = reportStatusForDay(new Date(day(10, 15)), 'nc1', visits, [stock('today')], [], []);
    assert.equal(st2.stockTaking, true);
  });
});

describe('attritionSignal', () => {
  const today = new Date(day(20, 17));

  it('flags >= 3 days without attendance and without reports in the last 7 days', () => {
    const att = [attendance('a1', day(20), 8), attendance('a2', day(19), 8), attendance('a3', day(18), 8), attendance('a4', day(17), 8)];
    const s = attritionSignal('nc1', att, [], [], [], [], today); // 4 of 7 days attended, no reports at all
    assert.equal(s.attendanceGap, true);
    assert.equal(s.missingReports, true);
    assert.equal(s.atRisk, true);
  });

  it('does not flag an NC who attended and reported every day', () => {
    const att: Attendance[] = [];
    const visits: Visit[] = [];
    const reports: StockTakingRow[] = [];
    for (let i = 0; i < 7; i++) {
      att.push(attendance(`a${i}`, day(20 - i), 8));
      visits.push(visit(`v${i}`, day(20 - i, 10), 30));
      reports.push(stock(`v${i}`));
    }
    const s = attritionSignal('nc1', att, visits, reports, [], [], today);
    assert.deepEqual(s, { attendanceGap: false, missingReports: false, atRisk: false });
  });
});
