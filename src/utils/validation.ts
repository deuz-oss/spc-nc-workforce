import type {
  OfftakeRow,
  PaidVisibilityRow,
  PriceMonitoringRow,
  ReportReview,
  ReportType,
  ShareOfShelfRow,
  StockTakingRow,
  Visit,
} from '../types';
import { photoStoragePath } from './photoRef';
import { inRange, TimeRange } from './period';

/**
 * TL/ARCO validation logic (PRD §8), shared by the Validasi console and the
 * TL/ARCO dashboard summary. Pure — unit-tested in validation.test.ts.
 *
 * Exception-based: 12 TLs cover 195 NCs, so only anomalies need a manual
 * touch; everything else counts as auto-approved.
 */

/** One report row (one SKU line for per-SKU modules). */
export interface ReportItem {
  type: ReportType;
  id: string;
  visitId: string;
  ncId: string;
  storeId: string;
  sku?: string;
  createdAt: number;
  isOutlier?: boolean;
  /** Server receive time (0014) — far after createdAt means a late sync. */
  receivedAt?: number;
  /** Evidence photo, once uploaded (an offline-queued local file isn't viewable by a reviewer). */
  photoUrl?: string;
}

/** A report reaching the server this long after it was made is worth a look:
 * a long offline stretch, or a phone whose clock was set back to backdate it. */
export const LATE_SYNC_MS = 12 * 3600000;

const remotePhoto = (ref?: string) => (photoStoragePath(ref) ? ref : undefined);

/** Every report row of the given NCs whose visit started inside `range`, newest first. */
export function buildReportItems(p: {
  visitsById: Map<string, Visit>;
  ncIds: Set<string>;
  range: TimeRange;
  stockTaking: StockTakingRow[];
  offtake: OfftakeRow[];
  shareOfShelf: ShareOfShelfRow[];
  paidVisibility: PaidVisibilityRow[];
  priceMonitoring: PriceMonitoringRow[];
}): ReportItem[] {
  const out: ReportItem[] = [];
  const add = (
    type: ReportType,
    r: { id: string; visitId: string; storeId: string; createdAt: number; receivedAt?: number },
    extra: Partial<ReportItem> = {},
  ) => {
    const v = p.visitsById.get(r.visitId);
    if (!v || !p.ncIds.has(v.ncId) || !inRange(v.checkInAt, p.range)) return;
    out.push({ type, id: r.id, visitId: r.visitId, ncId: v.ncId, storeId: r.storeId, createdAt: r.createdAt, receivedAt: r.receivedAt, ...extra });
  };
  for (const r of p.stockTaking) add('stock_taking', r, { sku: r.sku, photoUrl: remotePhoto(r.photoUrl) });
  for (const r of p.offtake) add('offtake', r, { sku: r.sku, isOutlier: r.isOutlier });
  for (const r of p.shareOfShelf) add('share_of_shelf', r, { photoUrl: remotePhoto(r.photoUrl) });
  for (const r of p.paidVisibility) add('paid_visibility', r, { photoUrl: remotePhoto(r.photoUrl) });
  for (const r of p.priceMonitoring) add('price_monitoring', r, { sku: r.sku, photoUrl: remotePhoto(r.photoUrl) });
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * One reviewable unit: everything an NC reported for one module in one visit
 * (all the SKU lines of a Stock Taking, say) — reviewed together, instead of
 * one Approve/Flag pair per SKU line.
 */
export interface ReportGroup {
  key: string;
  type: ReportType;
  visitId: string;
  ncId: string;
  storeId: string;
  /** Latest row time in the group. */
  createdAt: number;
  items: ReportItem[];
  photoUrl?: string;
  /** flagged if any line is flagged; approved only if every line is. */
  status: 'approved' | 'flagged' | 'pending';
  note?: string;
  /** Why the group needs a manual look (null = auto-approved). */
  autoFlag: string | null;
  /** Shown in the exception queue. */
  isException: boolean;
}

export const reviewKey = (type: ReportType, id: string) => `${type}:${id}`;

export function groupReports(
  items: ReportItem[],
  reviews: Map<string, ReportReview>,
  visitsById: Map<string, Visit>,
): ReportGroup[] {
  const byKey = new Map<string, ReportItem[]>();
  for (const it of items) {
    const k = `${it.type}:${it.visitId}`;
    const list = byKey.get(k);
    if (list) list.push(it);
    else byKey.set(k, [it]);
  }
  const groups: ReportGroup[] = [];
  for (const [key, list] of byKey) {
    const first = list[0];
    const statuses = list.map((it) => reviews.get(reviewKey(it.type, it.id)));
    const flagged = statuses.find((r) => r?.status === 'flagged');
    const status = flagged ? 'flagged' : statuses.every((r) => r?.status === 'approved') ? 'approved' : 'pending';
    const pendingItems = list.filter((_, i) => statuses[i]?.status !== 'approved');
    const autoFlag = status === 'approved' ? null : autoFlagReason(pendingItems, visitsById.get(first.visitId)?.geoValid);
    groups.push({
      key,
      type: first.type,
      visitId: first.visitId,
      ncId: first.ncId,
      storeId: first.storeId,
      createdAt: Math.max(...list.map((it) => it.createdAt)),
      items: list,
      photoUrl: list.find((it) => it.photoUrl)?.photoUrl,
      status,
      note: flagged?.note,
      autoFlag,
      isException: status === 'flagged' || (status === 'pending' && autoFlag != null),
    });
  }
  return groups.sort((a, b) => b.createdAt - a.createdAt);
}

/** Why these (not yet approved) lines need a manual look, or null. */
export function autoFlagReason(items: ReportItem[], visitGeoValid: boolean | undefined): string | null {
  const reasons: string[] = [];
  const outliers = items.filter((it) => it.isOutlier);
  if (outliers.length) {
    reasons.push(`Outlier (>3x rata-rata 7 hari NC ini): ${outliers.map((it) => it.sku ?? '?').join(', ')}`);
  }
  if (visitGeoValid === false) {
    reasons.push('Kunjungan tidak geo-valid (di luar radius toko, toko tanpa pin, atau lokasi palsu)');
  }
  const late = Math.max(0, ...items.map((it) => (it.receivedAt != null ? it.receivedAt - it.createdAt : 0)));
  if (late > LATE_SYNC_MS) {
    reasons.push(`Tersinkron ${Math.round(late / 3600000)} jam setelah dibuat — cek jam HP / alasan offline`);
  }
  return reasons.length ? reasons.join(' · ') : null;
}
