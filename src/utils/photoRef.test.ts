/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { photoStoragePath } from './photoRef';

describe('photoStoragePath', () => {
  it('passes a stored bucket path through (post-0011 format)', () => {
    assert.equal(photoStoragePath('v_abc/k2j3h4.jpg'), 'v_abc/k2j3h4.jpg');
    assert.equal(photoStoragePath('/v_abc/x.jpg'), 'v_abc/x.jpg');
  });

  it('extracts the path from a legacy public URL (pre-0011 rows, old app builds)', () => {
    assert.equal(
      photoStoragePath('https://ref.supabase.co/storage/v1/object/public/report-media/v_abc/k2j3h4.jpg'),
      'v_abc/k2j3h4.jpg',
    );
    assert.equal(
      photoStoragePath('https://ref.supabase.co/storage/v1/object/public/report-media/v_a%20b/x.jpg?t=1'),
      'v_a b/x.jpg',
    );
  });

  it('returns null for nothing viewable remotely: empty, device-local files, foreign URLs', () => {
    for (const ref of [undefined, null, '', '  ', 'file:///data/user/0/pending/x.jpg', 'content://media/1', 'blob:http://x/1', 'https://example.com/a.jpg']) {
      assert.equal(photoStoragePath(ref), null, String(ref));
    }
  });
});
