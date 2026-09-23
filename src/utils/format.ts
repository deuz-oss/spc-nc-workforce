export const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getDate())} ${MONTHS_ID[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}

/** Durasi -> "1j 23m" */
export function fmtDurShort(ms: number): string {
  if (ms < 0 || !isFinite(ms)) return '-';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}j ${m % 60}m` : `${m}m`;
}

/** Durasi berjalan -> "01:23:45" */
export function fmtDurClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: digits });
}

export function fmtIDR(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

export function fmtKm(km: number): string {
  return `${km.toLocaleString('id-ID', { maximumFractionDigits: 2 })} km`;
}
