import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { uid } from './uuid';

const BUCKET = 'report-media';

/**
 * Uploads a locally-picked photo/document (report evidence — stock taking,
 * share of shelf, paid visibility, price monitoring, per PRD §5) to Supabase
 * Storage and returns its public URL. Web uses a real fetch() Blob; native
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
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType });
    if (error) throw error;
  } else {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const { error } = await supabase.storage.from(BUCKET).upload(path, decode(base64), {
      contentType: contentType ?? 'application/octet-stream',
    });
    if (error) throw error;
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
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

/** Best-effort cleanup when a photo/doc is removed from a report; failures are non-fatal. */
export function deleteReportMedia(publicUrl: string): void {
  const marker = `/object/public/${BUCKET}/`;
  const i = publicUrl.indexOf(marker);
  if (i === -1) return;
  const path = publicUrl.slice(i + marker.length);
  supabase.storage
    .from(BUCKET)
    .remove([path])
    .then(({ error }) => {
      if (error) console.warn('deleteReportMedia failed:', error.message);
    });
}

/** Best-effort file extension from a local URI, falling back to a default. */
export function extFromUri(uri: string, fallback = 'jpg'): string {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(uri);
  return match ? match[1].toLowerCase() : fallback;
}
