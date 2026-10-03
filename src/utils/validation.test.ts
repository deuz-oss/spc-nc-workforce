/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportItems, groupReports, LATE_SYNC_MS, ReportItem, reviewKey } from './validation';
import type { ReportReview, Visit } from '../types';

const visit = (id: string, geoValid = true, ncId = 'nc1'): Visit => ({
  id, storeId: 's1', ncId, checkInAt: 1000, checkOutAt: 2000, lat: 0, lng: 0, storeDistanceM: 5, geoValid,
});
const item = (id: string, extra: Partial<ReportItem> = {}): ReportItem => ({
  type: 'offtake', id, visitId: 'v1', ncId: 'nc1', storeId: 's1', sku: id.toUpperCase(), createdAt: 1500, ...extra,
});
const review = (id: string, status: ReportReview['status'], note?: string): [string, ReportReview] => [
  reviewKey('offtake', id),
  { id: `rr_${id}`, reportType: 'offtake', reportId: id, status, note },
];

describe('groupReports', () => {
  const visits = new Map([['v1', visit('v1')]]);

  it('groups the SKU lines of one module in one visit into a single reviewable unit', () => {
    const groups = groupReports([item('a'), item('b'), item('c')], new Map(), visits);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 3);
    assert.equal(groups[0].isException, false);
  });

  it('flags the group when any line is an outlier and names the SKUs', () => {
    const [g] = groupReports([item('a'), item('b', { isOutlier: true })], new Map(), visits);
    assert.equal(g.isException, true);
    assert.match(g.autoFlag!, /Outlier.*B/);
  });

  it('is approved only when every line is, and a single flagged line flags the group', () => {
    const items = [item('a', { isOutlier: true }), item('b')];
    assert.equal(groupReports(items, new Map([review('a', 'approved'), review('b', 'approved')]), visits)[0].status, 'approved');
    assert.equal(groupReports(items, new Map([review('a', 'approved'), review('b', 'approved')]), visits)[0].isException, false);
    const flagged = groupReports(items, new Map([review('a', 'approved'), review('b', 'flagged', 'cek')]), visits)[0];
    assert.equal(flagged.status, 'flagged');
    assert.equal(flagged.note, 'cek');
    assert.equal(flagged.isException, true);
  });

  it('flags non-geo-valid visits and late syncs', () => {
    assert.ok(groupReports([item('a')], new Map(), new Map([['v1', visit('v1', false)]]))[0].isException);
    assert.ok(groupReports([item('a', { receivedAt: 1500 + LATE_SYNC_MS + 1 })], new Map(), visits)[0].isException);
  });
});

describe('buildReportItems', () => {
  it('keeps only rows of in-scope NCs whose visit started in range', () => {
    const visitsById = new Map([['v1', visit('v1')], ['v2', visit('v2', true, 'other')]]);
    const rows = [
      { id: 'o1', visitId: 'v1', storeId: 's1', sku: 'A', unitsSold: 1, isOutlier: false, createdAt: 1500 },
      { id: 'o2', visitId: 'v2', storeId: 's1', sku: 'A', unitsSold: 1, isOutlier: false, createdAt: 1500 },
    ];
    const out = buildReportItems({
      visitsById, ncIds: new Set(['nc1']), range: { from: 0, to: 5000 },
      stockTaking: [], offtake: rows, shareOfShelf: [], paidVisibility: [], priceMonitoring: [],
    });
    assert.deepEqual(out.map((i) => i.id), ['o1']);
  });
});
