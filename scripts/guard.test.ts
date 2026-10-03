/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectRefOf, stagingRefusal } from './guard';

const STAGING = 'https://stagingref.supabase.co';
const PROD = 'https://prodref.supabase.co';

describe('stagingRefusal', () => {
  it('reads the project ref from the URL', () => {
    assert.equal(projectRefOf(STAGING), 'stagingref');
  });

  it('allows a listed staging project, tolerating spaces and several refs', () => {
    assert.equal(stagingRefusal(STAGING, 'stagingref'), null);
    assert.equal(stagingRefusal(STAGING, ' other , stagingref '), null);
  });

  it('refuses when no allowlist is set', () => {
    assert.match(stagingRefusal(STAGING, undefined) ?? '', /STAGING_PROJECT_REFS is not set/);
    assert.match(stagingRefusal(STAGING, ' , ') ?? '', /STAGING_PROJECT_REFS is not set/);
  });

  it('refuses a project that is not listed (e.g. production)', () => {
    assert.match(stagingRefusal(PROD, 'stagingref') ?? '', /prodref is not in STAGING_PROJECT_REFS/);
  });

  it('does not match on a prefix', () => {
    assert.notEqual(stagingRefusal('https://stagingref2.supabase.co', 'stagingref'), null);
  });
});
