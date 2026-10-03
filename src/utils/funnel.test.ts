/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { funnelStepError, highestStage } from './funnel';

describe('funnelStepError', () => {
  it('allows the first step and forward moves, including skipping to NTG', () => {
    assert.equal(funnelStepError([], 'approached'), null);
    assert.equal(funnelStepError(['approached'], 'ntg_confirmed'), null);
    assert.equal(funnelStepError(['approached', 'ntg_confirmed'], 'wa_followup_scheduled'), null);
  });

  it('refuses going back or repeating a stage', () => {
    assert.ok(funnelStepError(['approached', 'quiz_completed'], 'approached'));
    assert.ok(funnelStepError(['approached'], 'approached'));
  });

  it('refuses GWP / follow-up before NTG is confirmed', () => {
    assert.ok(funnelStepError(['approached'], 'gwp_given'));
    assert.ok(funnelStepError([], 'wa_followup_scheduled'));
    assert.equal(funnelStepError(['ntg_confirmed'], 'gwp_given'), null);
  });
});

describe('highestStage', () => {
  it('picks the furthest stage, ignoring empties', () => {
    assert.equal(highestStage(['quiz_completed', undefined, 'ntg_confirmed', 'approached']), 'ntg_confirmed');
    assert.equal(highestStage([null, undefined]), undefined);
  });
});
