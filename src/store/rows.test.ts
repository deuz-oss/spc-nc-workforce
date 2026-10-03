/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rollbackRows } from './rows';

const r = (id: string, v: number) => ({ id, v });

describe('rollbackRows', () => {
  it('restores edited rows and drops ones the write added', () => {
    const before = [r('a', 1), r('b', 1)];
    const current = [r('new', 9), r('a', 2), r('b', 1)];
    assert.deepEqual(rollbackRows(current, ['a', 'new'], before), [r('a', 1), r('b', 1)]);
  });

  it('keeps changes other writes / realtime made meanwhile', () => {
    const before = [r('a', 1), r('b', 1)];
    const current = [r('a', 2), r('b', 5), r('c', 7)]; // b edited and c inserted by someone else
    assert.deepEqual(rollbackRows(current, ['a'], before), [r('a', 1), r('b', 5), r('c', 7)]);
  });

  it('brings back rows the write had removed', () => {
    const before = [r('a', 1), r('gone', 3)];
    const current = [r('a', 1)];
    assert.deepEqual(rollbackRows(current, ['gone'], before), [r('gone', 3), r('a', 1)]);
  });
});
