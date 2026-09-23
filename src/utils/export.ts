import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * Ekspor CSV lintas platform:
 * - Web : unduh file via Blob
 * - Native : tulis ke cache lalu buka share sheet (bisa disimpan/dibagikan)
 */
const BOM = String.fromCharCode(0xfeff);

export async function exportCsv(filename: string, csv: string): Promise<void> {
  const safe = filename.replace(/[^\w\d-]+/g, '_');
  if (Platform.OS === 'web') {
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return;
  }
  const fileUri = `${FileSystem.cacheDirectory ?? ''}${safe}.csv`;
  await FileSystem.writeAsStringAsync(fileUri, BOM + csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle: `Ekspor ${safe}`,
    UTI: 'public.comma-separated-values-text',
  });
}
