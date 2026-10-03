/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clockInGeoFenceOk, parseLatLng } from './geo';

describe('parseLatLng', () => {
  it('accepts dot or comma decimals and surrounding spaces', () => {
    assert.deepEqual(parseLatLng('-6.208763', '106.845599'), { lat: -6.208763, lng: 106.845599 });
    assert.deepEqual(parseLatLng(' -6,2 ', '106,8'), { lat: -6.2, lng: 106.8 });
  });

  it('treats both empty as "no pin"', () => {
    assert.equal(parseLatLng('', '  '), null);
  });

  it('rejects half-filled, non-numeric and out-of-range pins', () => {
    const bad: [string, string][] = [
      ['-6.2', ''],
      ['', '106.8'],
      ['abc', '106.8'],
      ['-6.2.1', '106.8'],
      ['-91', '106.8'],
      ['-6.2', '181'],
    ];
    for (const [a, b] of bad) assert.equal(parseLatLng(a, b), 'invalid', `${a},${b}`);
  });
});

describe('clockInGeoFenceOk', () => {
  const base = { baseLat: -6.2, baseLng: 106.8, baseRadiusM: 1000 };

  it('is inside within the radius and outside beyond it', () => {
    assert.equal(clockInGeoFenceOk(base, { lat: -6.205, lng: 106.8 }, false), true); // ~550 m
    assert.equal(clockInGeoFenceOk(base, { lat: -6.22, lng: 106.8 }, false), false); // ~2.2 km
  });

  it('counts a team without a home-base pin as inside', () => {
    assert.equal(clockInGeoFenceOk({ baseLat: null, baseLng: null, baseRadiusM: 1000 }, { lat: 0, lng: 0 }, false), true);
    assert.equal(clockInGeoFenceOk(undefined, { lat: 0, lng: 0 }, false), true);
  });

  it('never accepts a mocked position', () => {
    assert.equal(clockInGeoFenceOk(base, { lat: -6.2, lng: 106.8 }, true), false);
    assert.equal(clockInGeoFenceOk(undefined, { lat: -6.2, lng: 106.8 }, true), false);
  });
});
