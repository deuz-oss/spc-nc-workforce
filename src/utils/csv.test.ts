/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple table', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted fields with commas, escaped quotes and newlines', () => {
    const text = 'nama,alamat\n"Apotek ""Sehat""","Jl. Sudirman No.1, Jakarta\nLt. 2"';
    assert.deepEqual(parseCsv(text), [
      ['nama', 'alamat'],
      ['Apotek "Sehat"', 'Jl. Sudirman No.1, Jakarta\nLt. 2'],
    ]);
  });

  it('accepts Windows line endings and a UTF-8 BOM (Excel exports)', () => {
    assert.deepEqual(parseCsv('﻿username,offtake_target\r\nnc.budi,100\r\n'), [
      ['username', 'offtake_target'],
      ['nc.budi', '100'],
    ]);
  });

  it('skips blank lines but keeps empty fields', () => {
    assert.deepEqual(parseCsv('a,b\n\n1,\n\n'), [
      ['a', 'b'],
      ['1', ''],
    ]);
  });
});

describe('toCsv', () => {
  it('quotes only fields that need it and writes CRLF rows', () => {
    assert.equal(toCsv([['a', 'b,c', 'say "hi"', null, 5]]), 'a,"b,c","say ""hi""",,5');
    assert.equal(toCsv([['x'], ['y']]), 'x\r\ny');
  });

  it('round-trips through parseCsv', () => {
    const rows = [
      ['username', 'nama', 'catatan'],
      ['nc.siti', 'Siti, S.Gz', 'baris 1\nbaris 2'],
      ['nc.budi', 'Budi "B"', ''],
    ];
    assert.deepEqual(parseCsv(toCsv(rows)), rows);
  });
});
