/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem } from './password';

describe('passwordProblem', () => {
  it('accepts 8+ characters with letters and digits', () => {
    assert.equal(passwordProblem('kopi2026', 'nc.budi'), null);
  });

  it('rejects short, letters-only, digits-only passwords', () => {
    assert.ok(passwordProblem('ab12'));
    assert.ok(passwordProblem('abcdefgh'));
    assert.ok(passwordProblem('12345678'));
  });

  it('rejects a password that contains the username', () => {
    assert.ok(passwordProblem('nc.budi2026', 'NC.Budi'));
  });
});
