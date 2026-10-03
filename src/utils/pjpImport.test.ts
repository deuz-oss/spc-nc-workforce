/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parsePjpCsv, wibDate } from './pjpImport';
import { parseCsv } from './csv';

/** WIB wall-clock time as a timestamp, independent of the machine's zone. */
const wib = (d: number, h = 0) => Date.UTC(2026, 9, d, h - 7); // October 2026
const NOW = wib(7, 10); // Wednesday 7 Oct 2026, 10:00 WIB
const NEXT_WEEK = wib(12); // Monday 12 Oct

const ctx = {
  ncs: [
    { id: 'nc1', username: 'nc.siti' },
    { id: 'nc2', username: 'nc.budi' },
  ],
  stores: [
    { id: 'st_1', name: 'Apotek Sehat', city: 'Bandung' },
    { id: 'st_2', name: 'Apotek Sehat', city: 'Jakarta Selatan' },
    { id: 'st_3', name: 'Baby Shop', city: 'Bandung' },
  ],
  week: NEXT_WEEK,
  now: NOW,
};
const run = (csv: string) => parsePjpCsv(parseCsv(csv), ctx);

describe('parseDate', () => {
  it('reads ISO and Indonesian day-first dates as WIB midnight', () => {
    assert.equal(parseDate('2026-10-12'), wib(12));
    assert.equal(parseDate('12/10/2026'), wib(12));
    assert.equal(parseDate('5-1-2027'), Date.UTC(2027, 0, 5, -7));
  });
  it('rejects impossible dates and other formats', () => {
    assert.equal(parseDate('2026-02-30'), null);
    assert.equal(wibDate(2026, 13, 1), null);
    assert.equal(parseDate('Oct 12'), null);
  });
});

describe('parsePjpCsv', () => {
  it('reads dates and weekday names, matching stores by ID or name + city', () => {
    const r = run(`Username,Toko,Kota,Tanggal,Hari
nc.siti,st_1,,2026-10-12,
NC.SITI,apotek sehat,Jakarta Selatan,,selasa
nc.budi,Baby Shop,,,Sabtu`);
    assert.deepEqual(r.errors, []);
    assert.equal(r.read, 3);
    assert.deepEqual(r.plans, [
      { ncId: 'nc1', storeId: 'st_1', plannedDate: wib(12) },
      { ncId: 'nc1', storeId: 'st_2', plannedDate: wib(13) },
      { ncId: 'nc2', storeId: 'st_3', plannedDate: wib(17) },
    ]);
  });

  it('explains each rejected row and keeps the valid ones', () => {
    const r = run(`username,toko,kota,tanggal,hari
nc.siti,Apotek Sehat,,2026-10-12,
nc.lain,Baby Shop,,2026-10-12,
nc.siti,Toko Hilang,,2026-10-12,
nc.siti,Baby Shop,,2026-10-11,
nc.siti,Baby Shop,,2026-10-06,
nc.siti,Baby Shop,,2027-10-12,
nc.siti,Baby Shop,,,Minggu
nc.siti,Baby Shop,,,
nc.siti,Baby Shop,,2026-10-12,
,,,,

nc.siti,Baby Shop,,12/10/2026,`);
    assert.equal(r.plans.length, 1);
    assert.equal(r.read, 10);
    assert.deepEqual(r.errors, [
      'Baris 2: ada 2 toko bernama "Apotek Sehat" — isi kolom kota atau pakai ID toko',
      'Baris 3: NC "nc.lain" tidak ditemukan atau di luar tim Anda',
      'Baris 4: toko "Toko Hilang" tidak ditemukan',
      'Baris 5: 2026-10-11 jatuh pada hari Minggu',
      'Baris 6: 2026-10-06 sudah lewat',
      'Baris 7: 2027-10-12 lebih dari 120 hari ke depan',
      'Baris 8: hari "Minggu" tidak dikenal (Senin–Sabtu)',
      'Baris 9: isi tanggal atau hari',
      'Baris 12: sama dengan baris 10', // the empty line is dropped, the all-empty row skipped
    ]);
  });

  it('accepts today but not yesterday', () => {
    assert.equal(run('username,toko,tanggal\nnc.siti,st_3,2026-10-07').plans.length, 1);
    assert.equal(run('username,toko,tanggal\nnc.siti,st_3,2026-10-06').plans.length, 0);
  });

  it('needs the username, toko and a date or day column', () => {
    assert.deepEqual(run('nama,toko\nx,y').errors, ['Header harus memuat kolom username, toko, dan tanggal atau hari.']);
  });
});
