import { PROGRAM_UTC_OFFSET_MS, programDayKey, programDayStart, programParts } from './period';

/**
 * PJP plans from CSV (Import → Jadwal PJP). Pure — parsing and row validation
 * only; the screen saves the result with importSchedules. Unit-tested in
 * pjpImport.test.ts.
 *
 * Columns (header names are case-insensitive; Indonesian or English):
 *   username — the NC's username
 *   toko     — store ID or exact store name; `kota` (optional) picks between
 *              stores that share a name
 *   tanggal  — YYYY-MM-DD or DD/MM/YYYY, or instead
 *   hari     — Senin … Sabtu, in the week chosen on screen
 */

const DAY = 86400000;
/** Plans further ahead than this are almost certainly a typo in the year. */
export const PJP_IMPORT_MAX_DAYS_AHEAD = 120;

export const PJP_TEMPLATE = `username,toko,kota,tanggal,hari
nc.siti,Apotek Kimia Farma Sudirman,Jakarta Selatan,2026-10-12,
nc.siti,Baby Shop Mother Care,Bandung,,Selasa`;

const DAY_NAMES: Record<string, number> = { senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, "jum'at": 5, sabtu: 6 };

export interface PjpImportContext {
  /** NCs the importer may plan for (already scoped to their team(s)). */
  ncs: Array<{ id: string; username: string }>;
  stores: Array<{ id: string; name: string; city: string }>;
  /** WIB Monday of the week `hari` rows fall in. */
  week: number;
  now?: number;
}

export interface PjpPlan {
  ncId: string;
  storeId: string;
  plannedDate: number;
}

export interface PjpImportResult {
  plans: PjpPlan[];
  errors: string[];
  /** Data rows read (excluding the header and blank lines). */
  read: number;
}

/** WIB midnight of a calendar date, or null if it isn't a real date. */
export function wibDate(y: number, m: number, d: number): number | null {
  const ts = Date.UTC(y, m - 1, d) - PROGRAM_UTC_OFFSET_MS;
  const p = programParts(ts);
  return p.y === y && p.m === m - 1 && p.d === d ? ts : null;
}

/** `2026-10-12` or `12/10/2026` (Indonesian day-first) → WIB midnight. */
export function parseDate(raw: string): number | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return wibDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return wibDate(+m[3], +m[2], +m[1]);
  return null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function column(header: string[], names: string[]): number {
  return header.findIndex((h) => names.includes(norm(h)));
}

export function parsePjpCsv(table: string[][], ctx: PjpImportContext): PjpImportResult {
  const now = ctx.now ?? Date.now();
  const today = programDayStart(now);
  const header = table[0] ?? [];
  const col = {
    username: column(header, ['username', 'nc', 'user']),
    store: column(header, ['toko', 'store', 'id toko', 'store_id', 'nama toko', 'nama_toko']),
    city: column(header, ['kota', 'city']),
    date: column(header, ['tanggal', 'date']),
    day: column(header, ['hari', 'day']),
  };
  const errors: string[] = [];
  if (col.username < 0 || col.store < 0 || (col.date < 0 && col.day < 0)) {
    return { plans: [], errors: ['Header harus memuat kolom username, toko, dan tanggal atau hari.'], read: 0 };
  }

  const ncByUsername = new Map(ctx.ncs.map((u) => [norm(u.username), u.id]));
  const storeById = new Map(ctx.stores.map((s) => [s.id, s]));
  const storesByName = new Map<string, typeof ctx.stores>();
  for (const s of ctx.stores) storesByName.set(norm(s.name), [...(storesByName.get(norm(s.name)) ?? []), s]);

  const plans: PjpPlan[] = [];
  const seen = new Map<string, number>();
  let read = 0;

  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const cell = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');
    if (r.every((v) => !v.trim())) return; // blank line
    read++;

    const username = cell(col.username);
    const ncId = ncByUsername.get(norm(username));
    if (!username) return void errors.push(`Baris ${line}: username kosong`);
    if (!ncId) return void errors.push(`Baris ${line}: NC "${username}" tidak ditemukan atau di luar tim Anda`);

    const storeRaw = cell(col.store);
    if (!storeRaw) return void errors.push(`Baris ${line}: toko kosong`);
    let store = storeById.get(storeRaw);
    if (!store) {
      let matches = storesByName.get(norm(storeRaw)) ?? [];
      const city = cell(col.city);
      if (matches.length > 1 && city) matches = matches.filter((s) => norm(s.city) === norm(city));
      if (matches.length === 0) return void errors.push(`Baris ${line}: toko "${storeRaw}" tidak ditemukan`);
      if (matches.length > 1) {
        return void errors.push(`Baris ${line}: ada ${matches.length} toko bernama "${storeRaw}" — isi kolom kota atau pakai ID toko`);
      }
      store = matches[0];
    }

    const dateRaw = cell(col.date);
    const dayRaw = cell(col.day);
    let plannedDate: number | null;
    if (dateRaw) {
      plannedDate = parseDate(dateRaw);
      if (plannedDate == null) return void errors.push(`Baris ${line}: tanggal "${dateRaw}" tidak valid (pakai YYYY-MM-DD atau DD/MM/YYYY)`);
    } else if (dayRaw) {
      const dow = DAY_NAMES[norm(dayRaw)];
      if (!dow) return void errors.push(`Baris ${line}: hari "${dayRaw}" tidak dikenal (Senin–Sabtu)`);
      plannedDate = ctx.week + (dow - 1) * DAY;
    } else {
      return void errors.push(`Baris ${line}: isi tanggal atau hari`);
    }

    const dow = programParts(plannedDate).dow;
    if (dow === 0) return void errors.push(`Baris ${line}: ${programDayKey(plannedDate)} jatuh pada hari Minggu`);
    if (plannedDate < today) return void errors.push(`Baris ${line}: ${programDayKey(plannedDate)} sudah lewat`);
    if (plannedDate > today + PJP_IMPORT_MAX_DAYS_AHEAD * DAY) {
      return void errors.push(`Baris ${line}: ${programDayKey(plannedDate)} lebih dari ${PJP_IMPORT_MAX_DAYS_AHEAD} hari ke depan`);
    }

    const key = `${ncId}|${store.id}|${programDayKey(plannedDate)}`;
    const first = seen.get(key);
    if (first) return void errors.push(`Baris ${line}: sama dengan baris ${first}`);
    seen.set(key, line);
    plans.push({ ncId, storeId: store.id, plannedDate });
  });

  return { plans, errors, read };
}
