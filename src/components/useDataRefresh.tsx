import React, { useCallback, useState } from 'react';
import { RefreshControl, RefreshControlProps } from 'react-native';
import { showDialog } from './dialog';
import { useStore } from '../store/useStore';
import { C } from '../theme';

/**
 * Pull-to-refresh for screens that summarise live field data (Validasi,
 * dashboards): re-syncs everything from the server via refreshData(). Pass the
 * returned element as a ScrollView/FlatList `refreshControl`. On web there's no
 * pull gesture; data still re-syncs on tab/app refocus (useStore AppState hook).
 */
export function useDataRefresh(): React.ReactElement<RefreshControlProps> {
  const refreshData = useStore((s) => s.refreshData);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const err = await refreshData();
      if (err) showDialog('Gagal Memuat Ulang', 'Periksa koneksi internet dan coba lagi.');
    } finally {
      setRefreshing(false);
    }
  }, [refreshData]);

  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />;
}
