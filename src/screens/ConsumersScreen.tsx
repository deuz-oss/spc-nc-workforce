import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Badge, Btn, Empty, Input, ListRow, SectionHeader } from '../components/ui';
import { NTG_GWP_STAGE_LABEL } from '../config';
import { C } from '../theme';
import { consumerScope, useCurrentUser, useStore } from '../store/useStore';

/** Consumers list for the NTG & GWP funnel (PRD §5.4). Optionally scoped to a
 * single visit's store — when opened from StoreVisitScreen with a visitId,
 * shows a shortcut to start a new consumer tied to that visit. */
export default function ConsumersScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const me = useCurrentUser()!;
  const visitId: string | undefined = route.params?.visitId;
  const storeId: string | undefined = route.params?.storeId;

  const consumers = useStore((s) => s.consumers);
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const ntgGwps = useStore((s) => s.ntgGwps);
  const [q, setQ] = useState('');

  const scoped = useMemo(() => consumerScope({ consumers, users, teams }, me), [consumers, users, teams, me]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return scoped;
    return scoped.filter((c) => c.name.toLowerCase().includes(needle) || c.waContact.toLowerCase().includes(needle));
  }, [scoped, q]);

  const latestStage = (consumerId: string) => {
    const rows = ntgGwps.filter((g) => g.consumerId === consumerId);
    return rows.length ? rows[0].stage : undefined; // most recent first, per store's upsert-prepend convention
  };

  return (
    <View role="main" style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 10 }}>
        <SectionHeader title={`Konsumen NTG & GWP (${scoped.length})`} />
        <Input placeholder="Cari nama atau kontak WhatsApp..." value={q} onChangeText={setQ} />
        {me.role === 'nc' && visitId && storeId && (
          <Btn
            title="+ Konsumen Baru untuk Kunjungan Ini"
            onPress={() => navigation.navigate('ConsumerDetail', { visitId, storeId })}
          />
        )}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10 }}
        ListEmptyComponent={<Empty text="Belum ada data konsumen." />}
        renderItem={({ item: c }) => {
          const stage = latestStage(c.id);
          return (
            <ListRow
              onPress={() => navigation.navigate('ConsumerDetail', { consumerId: c.id, visitId, storeId })}
              title={c.name}
              subtitle={c.waContact || 'Kontak WA belum diisi'}
              trailing={stage ? <Badge label={NTG_GWP_STAGE_LABEL[stage]} color={C.info} /> : undefined}
            />
          );
        }}
      />
    </View>
  );
}
