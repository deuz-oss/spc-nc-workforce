/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidWa, normalizeWa } from './wa';

describe('normalizeWa', () => {
  it('maps the common ways of writing one number to the same key', () => {
    for (const v of ['081234567890', '0812-3456-7890', '+62 812 3456 7890', '6281234567890', '81234567890']) {
      assert.equal(normalizeWa(v), '6281234567890', v);
    }
  });

  it('keeps empty input empty', () => {
    assert.equal(normalizeWa(' - '), '');
  });
});

describe('isValidWa', () => {
  it('accepts Indonesian mobile numbers', () => {
    assert.equal(isValidWa('0812345678'), true);
    assert.equal(isValidWa('+6281234567890'), true);
  });

  it('rejects landlines, too-short and empty numbers', () => {
    assert.equal(isValidWa('0215551234'), false); // Jakarta landline
    assert.equal(isValidWa('08123'), false);
    assert.equal(isValidWa(''), false);
  });
});
