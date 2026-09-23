import { RoutePoint } from '../types';
import { STOP_CLUSTER_RADIUS_M, STOP_MIN_DURATION_MS } from '../config';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Jarak antar dua koordinat dalam meter */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Panjang total polyline rute dalam km */
export function polylineKm(pts: RoutePoint[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += haversineM(pts[i - 1], pts[i]);
  return m / 1000;
}

export interface RouteStop {
  lat: number;
  lng: number;
  startT: number;
  endT: number;
  durationMs: number;
}

/**
 * Kelompokkan titik rute yang berdekatan (radius kecil) menjadi "titik berhenti"
 * ketika NC diam di satu lokasi cukup lama — dipakai untuk menganalisa jeda
 * yang tidak terkait kunjungan toko (mis. berhenti lama di luar jadwal).
 */
export function detectStops(
  pts: RoutePoint[],
  opts: { radiusM?: number; minDurationMs?: number } = {},
): RouteStop[] {
  const radiusM = opts.radiusM ?? STOP_CLUSTER_RADIUS_M;
  const minDurationMs = opts.minDurationMs ?? STOP_MIN_DURATION_MS;
  if (pts.length < 2) return [];

  const stops: RouteStop[] = [];
  let clusterStart = 0;

  const flush = (endIdx: number) => {
    const clusterPts = pts.slice(clusterStart, endIdx + 1);
    const startT = clusterPts[0].t;
    const endT = clusterPts[clusterPts.length - 1].t;
    if (endT - startT >= minDurationMs) {
      stops.push({
        lat: clusterPts.reduce((s, p) => s + p.lat, 0) / clusterPts.length,
        lng: clusterPts.reduce((s, p) => s + p.lng, 0) / clusterPts.length,
        startT,
        endT,
        durationMs: endT - startT,
      });
    }
  };

  for (let i = 1; i < pts.length; i++) {
    if (haversineM(pts[clusterStart], pts[i]) > radiusM) {
      flush(i - 1);
      clusterStart = i;
    }
  }
  flush(pts.length - 1);

  return stops;
}
