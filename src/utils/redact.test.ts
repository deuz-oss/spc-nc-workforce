/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripQuery } from './redact';

describe('stripQuery', () => {
  it('drops the query string and fragment', () => {
    assert.equal(stripQuery('https://x.supabase.co/rest/v1/consumers?wa_normalized=eq.62812'), 'https://x.supabase.co/rest/v1/consumers');
    assert.equal(stripQuery('https://a.b/c#token=1'), 'https://a.b/c');
  });
  it('leaves a URL without one unchanged', () => {
    assert.equal(stripQuery('https://a.b/c'), 'https://a.b/c');
  });
});
