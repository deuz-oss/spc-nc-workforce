/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapAttendance, mapConsumer, mapTeam, mapVisit, offtakeRow, upsertById } from './mappers';

describe('mappers', () => {
  it('maps a visit row, including server-computed and 0014/0016 flags', () => {
    const v = mapVisit({
      id: 'v1', store_id: 's1', nc_id: 'u1', check_in_at: '2026-09-01T02:00:00Z', check_out_at: null,
      lat: -6.2, lng: 106.8, store_distance_m: 12, geo_valid: true, location_mocked: false, auto_closed: true,
    });
    assert.equal(v.checkInAt, Date.UTC(2026, 8, 1, 2));
    assert.equal(v.checkOutAt, null);
    assert.equal(v.autoClosed, true);
  });

  it('defaults columns an older backend does not send', () => {
    const a = mapAttendance(
      { id: 'a1', user_id: 'u1', clock_in_at: '2026-09-01T00:00:00Z', clock_out_at: null, clock_in_lat: 0, clock_in_lng: 0, geo_fence_ok: true },
      [],
    );
    assert.equal(a.locationMocked, false);
    assert.equal(a.autoClosed, false);
    assert.equal(mapTeam({ id: 't', name: 'T', city: 'C', tl_id: null, arco_id: null }).baseRadiusM, 10000);
  });

  it('reads consent / erasure timestamps', () => {
    const c = mapConsumer({
      id: 'c1', name: 'N', wa_contact: '0812', consent: true, created_by_nc_id: 'u1',
      created_at: '2026-09-01T00:00:00Z', consent_at: '2026-09-01T00:00:01Z', consent_version: 'v1', erased_at: null,
    });
    assert.equal(c.consentAt, Date.UTC(2026, 8, 1, 0, 0, 1));
    assert.equal(c.erasedAt, undefined);
  });

  it('never writes is_outlier (server trigger owns it)', () => {
    const row = offtakeRow({ id: 'o', visitId: 'v', storeId: 's', sku: 'X', unitsSold: 3, isOutlier: true, createdAt: 0 });
    assert.equal('is_outlier' in row, false);
    assert.equal(row.revenue, null);
  });

  it('upsertById prepends new rows and replaces existing ones in place', () => {
    const list = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }];
    assert.deepEqual(upsertById(list, { id: 'c', v: 1 }).map((x) => x.id), ['c', 'a', 'b']);
    assert.deepEqual(upsertById(list, { id: 'b', v: 2 }), [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
  });
});
