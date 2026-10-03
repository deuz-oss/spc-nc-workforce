import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Badge, Empty, Input, ListRow, SectionHeader, StatusBadge } from '../components/ui';
import { useNow } from '../components/useNow';
import { CATEGORY_LABEL, STORE_MANAGER_ROLES } from '../config';
import { C } from '../theme';
import { useCurrentUser, useStore, storeScope } from '../store/useStore';
import { programDayKey } from '../utils/period';
import { scheduleStatus } from '../utils/pjp';

export default function StoresScreen() {
  const me = useCurrentUser()!;
  const navigation = useNavigation();
  const stores = useStore((s) => s.stores);
  const teams = useStore((s) => s.teams);
  const users = useStore((s) => s.users);
  const schedules = useStore((s) => s.schedules);
  const visits = useStore((s) => s.visits);
  const now = useNow();
  const [q, setQ] = useState('');

  // NC: today's planned stores first (not yet visited, then visited), then the rest.
  const today = programDayKey(now);
  const planToday = useMemo(() => {
    const m = new Map<string, 'planned' | 'visited'>();
    if (me.role !== 'nc') return m;
    for (const s of schedules) {
      if (s.ncId !== me.id || programDayKey(s.plannedDate) !== today) continue;
      if (m.get(s.storeId) !== 'visited') m.set(s.storeId, scheduleStatus(s, visits, now) === 'visited' ? 'visited' : 'planned');
    }
    return m;
  }, [me, schedules, visits, today, now]);

  const scoped = useMemo(() => storeScope({ stores, teams }, me), [stores, teams, me]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? scoped.filter((s) => s.name.toLowerCase().includes(needle) || s.city.toLowerCase().includes(needle))
      : scoped;
    if (!planToday.size) return list;
    const rank = (id: string) => (planToday.get(id) === 'planned' ? 0 : planToday.get(id) === 'visited' ? 1 : 2);
    return [...list].sort((a, b) => rank(a.id) - rank(b.id));
  }, [scoped, q, planToday]);
  const canImport = STORE_MANAGER_ROLES.includes(me.role);

  return (
    <View role="main" style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 10 }}>
        <SectionHeader
          title={`Toko (${scoped.length})`}
          subtitle={planToday.size ? `${[...planToday.values()].filter((v) => v === 'planned').length} toko jadwal hari ini belum dikunjungi` : undefined}
          action={canImport ? { label: 'Impor CSV', onPress: () => navigation.navigate('Import', { mode: 'stores' }) } : undefined}
        />
        <Input placeholder="Cari nama toko atau kota..." value={q} onChangeText={setQ} accessibilityLabel="Cari toko" />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10 }}
        ListEmptyComponent={
          <Empty
            icon={q.trim() ? 'search-outline' : 'storefront-outline'}
            action={canImport && !q.trim() ? { label: 'Impor CSV', onPress: () => navigation.navigate('Import', { mode: 'stores' }) } : undefined}
            text={
              q.trim()
                ? `Tidak ada toko yang cocok dengan "${q.trim()}".`
                : canImport
                  ? 'Belum ada toko. Impor daftar toko dari CSV.'
                  : 'Belum ada toko yang ditugaskan ke Anda. Hubungi TL Anda.'
            }
          />
        }
        renderItem={({ item: store }) => {
          const nc = users.find((u) => u.id === store.assignedNcId);
          const plan = planToday.get(store.id);
          return (
            <ListRow
              onPress={() => navigation.navigate('StoreDetail', { storeId: store.id })}
              title={store.name}
              subtitle={
                me.role === 'nc'
                  ? [store.address, store.city].filter(Boolean).join(', ')
                  : `${store.city} · ${store.channel || '-'} · ${nc?.name ?? 'Belum di-assign'}`
              }
              emphasis={plan === 'planned' ? { color: C.infoStrong, label: 'Jadwal hari ini' } : undefined}
              trailing={
                plan === 'visited' ? (
                  <StatusBadge label="Dikunjungi" color={C.okStrong} icon="checkmark-circle" />
                ) : (
                  <Badge label={CATEGORY_LABEL[store.category] ?? store.category} color={C.info} />
                )
              }
            />
          );
        }}
      />
    </View>
  );
}
