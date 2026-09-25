/**
 * Report-evidence photo references (report tables' `photo_url` column).
 *
 * Since 0011_private_report_media.sql the `report-media` bucket is PRIVATE:
 * the stored value is the object path inside the bucket ("<visitId>/<file>"),
 * and viewing goes through a short-lived signed URL (see openReportPhoto in
 * storage.ts), which Storage only issues if report_media_select RLS allows it.
 *
 * Older values are full public URLs (".../object/public/report-media/<path>"),
 * written before 0011 and still written by app builds that predate it, so
 * both forms must keep resolving. Pure — no React Native imports — so it's
 * unit-tested in plain Node.
 */
export const REPORT_MEDIA_BUCKET = 'report-media';

const LEGACY_MARKER = `/object/public/${REPORT_MEDIA_BUCKET}/`;

/**
 * Bucket object path for a stored photo reference, or null when there's
 * nothing viewable remotely: empty, or a device-local file (an offline-queued
 * photo that hasn't been uploaded yet).
 */
export function photoStoragePath(ref: string | null | undefined): string | null {
  const v = ref?.trim();
  if (!v) return null;
  if (/^(file|content|blob|data|ph|assets-library):/i.test(v)) return null;
  const i = v.indexOf(LEGACY_MARKER);
  if (i !== -1) return decodeURIComponent(v.slice(i + LEGACY_MARKER.length).split('?')[0]);
  if (/^https?:\/\//i.test(v)) return null; // some other URL — not ours to sign
  return v.replace(/^\/+/, '');
}
