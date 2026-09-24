/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drainQueue, ReplayResult, settle } from './replay';
import type { QueuedOp } from '../utils/offlineQueue';

const op = (id: string): QueuedOp => ({ id, type: 'finishVisit', visitId: `v_${id}`, checkOutAt: 0 });

/** In-memory queue wired the way processPendingOps wires the store. */
function harness(ids: string[], results: Record<string, ReplayResult>) {
  let queue = ids.map(op);
  const replayed: string[] = [];
  return {
    queue: () => queue.map((o) => o.id),
    replayed,
    push: (id: string) => (queue = [...queue, op(id)]),
    io: {
      head: () => queue[0],
      replay: async (o: QueuedOp) => {
        replayed.push(o.id);
        return results[o.id] ?? 'done';
      },
      remove: async (o: QueuedOp) => {
        queue = queue.filter((x) => x.id !== o.id);
      },
      stillValid: () => true,
    },
  };
}

describe('settle', () => {
  it('treats success and duplicate-key (already landed) as done', () => {
    assert.equal(settle(null), 'done');
    assert.equal(settle({ code: '23505' }), 'done');
  });

  it('treats deterministic Postgres rejections as failed', () => {
    for (const code of ['42501', '23503', '23514', '22P02', 'P0001']) assert.equal(settle({ code }), 'failed', code);
  });

  it('treats network / unknown / PostgREST errors as retry', () => {
    for (const error of [{}, { code: '' }, { code: 'PGRST301' }, { code: '08006' }]) assert.equal(settle(error), 'retry');
  });
});

describe('drainQueue', () => {
  it('replays in order and empties the queue', async () => {
    const h = harness(['a', 'b', 'c'], {});
    const res = await drainQueue(h.io);
    assert.deepEqual(h.replayed, ['a', 'b', 'c']);
    assert.deepEqual(h.queue(), []);
    assert.deepEqual(res, { synced: 3, failed: [] });
  });

  it('stops at a retry and keeps that op and everything after it (clock-out never before clock-in)', async () => {
    const h = harness(['clockIn', 'report', 'clockOut'], { clockIn: 'retry' });
    const res = await drainQueue(h.io);
    assert.deepEqual(h.replayed, ['clockIn']);
    assert.deepEqual(h.queue(), ['clockIn', 'report', 'clockOut']);
    assert.equal(res.synced, 0);
  });

  it('drops a permanently rejected op, reports it, and continues with the rest', async () => {
    const h = harness(['a', 'bad', 'c'], { bad: 'failed' });
    const res = await drainQueue(h.io);
    assert.deepEqual(h.queue(), []);
    assert.deepEqual(res.failed.map((o) => o.id), ['bad']);
    assert.equal(res.synced, 2);
  });

  it('drops a `dropped` op without counting it as synced or failed', async () => {
    const h = harness(['a', 'gone'], { gone: 'dropped' });
    const res = await drainQueue(h.io);
    assert.deepEqual(h.queue(), []);
    assert.deepEqual(res, { synced: 1, failed: [] });
  });

  it('picks up ops enqueued while replay is in progress, in order', async () => {
    const h = harness(['a'], {});
    const replay = h.io.replay;
    h.io.replay = async (o) => {
      if (o.id === 'a') h.push('b'); // user saves another report offline mid-sync
      return replay(o);
    };
    await drainQueue(h.io);
    assert.deepEqual(h.replayed, ['a', 'b']);
    assert.deepEqual(h.queue(), []);
  });

  it('stops when the session changes (e.g. logout) without touching remaining ops', async () => {
    const h = harness(['a', 'b'], {});
    let valid = true;
    h.io.stillValid = () => valid;
    const replay = h.io.replay;
    h.io.replay = async (o) => {
      valid = false;
      return replay(o);
    };
    await drainQueue(h.io);
    assert.deepEqual(h.replayed, ['a']);
    assert.deepEqual(h.queue(), ['b']);
  });
});
