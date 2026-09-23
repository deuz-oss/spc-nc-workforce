import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Badge, Empty, Input, ListRow, SectionHeader } from '../components/ui';
import { CATEGORY_LABEL, STORE_MANAGER_ROLES } from '../config';
import { C } from '../theme';
import { useCurrentUser, useStore, storeScope } from '../store/useStore';

export default function StoresScreen() {
  const me = useCurrentUser()!;
  const navigation = useNavigation<any>();
  const stores = useStore((s) => s.stores);
  const teams = useStore((s) => s.teams);
  const users = useStore((s) => s.users);
  const [q, setQ] = useState('');

  const scoped = useMemo(() => storeScope({ stores, teams }, me), [stores, teams, me]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return scoped;
    return scoped.filter(
      (s) => s.name.toLowerCase().includes(needle) || s.city.toLowerCase().includes(needle),
    );
  }, [scoped, q]);

  return (
    <View role="main" style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 10 }}>
        <SectionHeader
          title={`Toko (${scoped.length})`}
          action={
            STORE_MANAGER_ROLES.includes(me.role)
              ? { label: 'Impor CSV', onPress: () => navigation.navigate('Import') }
              : undefined
          }
        />
        <Input placeholder="Cari nama toko atau kota..." value={q} onChangeText={setQ} />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10 }}
        ListEmptyComponent={<Empty text="Belum ada toko. Impor daftar toko dari CSV." />}
        renderItem={({ item: store }) => {
          const nc = users.find((u) => u.id === store.assignedNcId);
          return (
            <ListRow
              onPress={() => navigation.navigate('StoreDetail', { storeId: store.id })}
              title={store.name}
              subtitle={`${store.city} · ${store.channel || '-'} · ${nc?.name ?? 'Belum di-assign'}`}
              trailing={<Badge label={CATEGORY_LABEL[store.category] ?? store.category} color={C.info} />}
            />
          );
        }}
      />
    </View>
  );
}
