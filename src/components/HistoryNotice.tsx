import React, { useState } from 'react';
import { View } from 'react-native';
import { Btn, Muted } from './ui';
import { showDialog } from './dialog';
import { useStore } from '../store/useStore';
import { fmtDate } from '../utils/format';

/**
 * Shown where a screen can display field activity older than what was loaded
 * at login (HISTORY_DAYS — see useStore's WINDOWED_TABLES). Renders nothing
 * once full history is loaded, or when `needsFrom` (the earliest timestamp the
 * screen is currently showing) is already inside the loaded window.
 */
export function HistoryNotice({ needsFrom }: { needsFrom?: number }) {
  const historyFrom = useStore((s) => s.historyFrom);
  const loadFullHistory = useStore((s) => s.loadFullHistory);
  const [busy, setBusy] = useState(false);

  if (historyFrom == null || (needsFrom != null && needsFrom >= historyFrom)) return null;

  const load = async () => {
    setBusy(true);
    try {
      const err = await loadFullHistory();
      if (err) showDialog('Gagal Memuat Riwayat', 'Periksa koneksi internet dan coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Muted>
        Menampilkan data sejak {fmtDate(historyFrom)}. Riwayat yang lebih lama belum dimuat agar aplikasi tetap
        ringan.
      </Muted>
      <View style={{ alignSelf: 'flex-start' }}>
        <Btn small variant="outline" title="Muat Riwayat Lengkap" onPress={load} disabled={busy} loading={busy} />
      </View>
    </View>
  );
}
