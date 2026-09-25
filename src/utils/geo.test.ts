/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLng } from './geo';

describe('parseLatLng', () => {
  it('accepts dot or comma decimals and surrounding spaces', () => {
    assert.deepEqual(parseLatLng('-6.208763', '106.845599'), { lat: -6.208763, lng: 106.845599 });
    assert.deepEqual(parseLatLng(' -6,2 ', '106,8'), { lat: -6.2, lng: 106.8 });
  });

  it('treats both empty as "no pin"', () => {
    assert.equal(parseLatLng('', '  '), null);
  });

  it('rejects half-filled, non-numeric and out-of-range pins', () => {
    const bad: Array<[string, string]> = [
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
