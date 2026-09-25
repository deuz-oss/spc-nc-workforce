import { Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { showDialog } from '../components/dialog';
import { photoStoragePath, REPORT_MEDIA_BUCKET as BUCKET } from './photoRef';
import { uid } from './uuid';

/** Signed-URL lifetime when a reviewer opens an evidence photo. */
const SIGNED_URL_TTL_S = 60 * 60;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};

/**
 * Uploads a locally-picked photo/document (report evidence — stock taking,
 * share of shelf, paid visibility, price monitoring, per PRD §5) to Supabase
 * Storage and returns its object path inside the (private, since 0011) bucket —
 * that path is what report rows store as photo_url; see photoRef.ts and
 * openReportPhoto for viewing. Web uses a real fetch() Blob; native
 * reads base64 via expo-file-system since React Native's fetch().blob() is
 * unreliable for binary uploads from file:// URIs.
 */
export async function uploadReportMedia(
  visitId: string,
  uri: string,
  ext: string,
  contentType?: string,
): Promise<string> {
  const path = `${visitId}/${uid()}.${ext}`;
  // Without a real image type, Storage serves evidence photos as
  // application/octet-stream and browsers download them instead of showing them.
  const type = contentType ?? MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: contentType ?? (blob.type || type) });
    if (error) throw error;
  } else {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const { error } = await supabase.storage.from(BUCKET).upload(path, decode(base64), { contentType: type });
    if (error) throw error;
  }
  return path;
}

/**
 * Opens a report's evidence photo via a short-lived signed URL. Storage only
 * signs it when report_media_select RLS lets the viewer see that visit (own
 * visit, TL/ARCO scope, monitor roles), so an unrelated user gets an error, not
 * the photo. Accepts both stored formats (bucket path or legacy public URL).
 */
export async function openReportPhoto(ref: string | null | undefined): Promise<void> {
  const path = photoStoragePath(ref);
  if (!path) {
    showDialog('Foto Belum Tersedia', 'Foto ini belum terupload (masih tersimpan offline di HP NC).');
    return;
  }
  // Web: open the tab synchronously inside the click, then point it at the
  // signed URL — a window.open() after the await would be popup-blocked.
  const tab = Platform.OS === 'web' && typeof window !== 'undefined' ? window.open('', '_blank') : null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_S);
  if (error || !data?.signedUrl) {
    tab?.close();
    showDialog('Tidak Dapat Membuka Foto', 'Foto tidak ditemukan atau Anda tidak punya akses ke laporan ini.');
    return;
  }
  if (tab) tab.location.href = data.signedUrl;
  else await Linking.openURL(data.signedUrl);
}

const PENDING_DIR = `${FileSystem.documentDirectory ?? ''}pending-report-media/`;

async function ensurePendingDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PENDING_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PENDING_DIR, { intermediates: true });
  }
}

/**
 * Copies a picked photo into a stable, app-owned directory (documentDirectory,
 * not cacheDirectory) so it survives until the offline queue can upload it —
 * expo-image-picker's returned URI often lives in a cache path the OS is free
 * to evict before the device reconnects. Native only — never call this on web
 * (see offlineQueue.ts's QueuedOp comment on the web scope boundary).
 */
export async function persistPhotoLocally(uri: string): Promise<string> {
  await ensurePendingDir();
  const dest = `${PENDING_DIR}${uid()}.${extFromUri(uri)}`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

/** Best-effort delete of a locally-persisted pending photo; never throws. */
export async function discardLocalPhoto(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* best-effort */
  }
}

/** True if the local file backing a still-queued photo still exists on disk —
 * checked before a deferred upload attempt (app reinstall / OS cache clear /
 * manual storage clear can all remove it before the device ever reconnects). */
export async function localPhotoExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

/** Best-effort file extension from a local URI, falling back to a default. */
export function extFromUri(uri: string, fallback = 'jpg'): string {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(uri);
  return match ? match[1].toLowerCase() : fallback;
}
