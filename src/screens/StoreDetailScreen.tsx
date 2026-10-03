import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import { Badge, Btn, Card, Empty, GeoValidBadge, H, Input, ListRow, Muted, SectionHeader, STICKY_FOOTER_SPACE, StickyFooter } from '../components/ui';
import { CATEGORY_LABEL, STORE_MANAGER_ROLES } from '../config';
import { useCheckIn } from '../components/fieldActions';
import { HistoryNotice } from '../components/HistoryNotice';
import { StoreEditForm } from '../components/StoreEditForm';
import { ShowMore } from '../components/ShowMore';
import { C, T } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDateTime, fmtDurShort } from '../utils/format';
import { useOnline } from '../components/useOnline';
import { OnlineOnlyNote } from '../components/OnlineOnlyNote';

export default function StoreDetailScreen() {
  const route = useAppRoute<'StoreDetail'>();
  const navigation = useNavigation();
  const me = useCurrentUser()!;
  const store = useStore((s) => s.stores.find((m) => m.id === route.params.storeId));
  const users = useStore((s) => s.users);
  const visits = useStore((s) => s.visits);
  const upsertStore = useStore((s) => s.upsertStore);
  const { checkIn, checkingStoreId } = useCheckIn();
  const online = useOnline();

  const [assigning, setAssigning] = useState(false);
  const [ncQuery, setNcQuery] = useState('');
  const [editing, setEditing] = useState(false);

  const storeVisits = useMemo(
    () => visits.filter((v) => v.storeId === route.params.storeId).sort((a, b) => b.checkInAt - a.checkInAt),
    [visits, route.params.storeId],
  );

  const teams = useStore((s) => s.teams);
  // Searchable, and the store's own team / city first — a program-wide list is ~195 NCs.
  const ncMatches = useMemo(() => {
    const needle = ncQuery.trim().toLowerCase();
    const rank = (u: (typeof users)[number]) => (u.teamId && u.teamId === store?.teamId ? 0 : u.city && u.city === store?.city ? 1 : 2);
    return users
      .filter((u) => u.role === 'nc' && u.active)
      .filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, 20);
  }, [users, ncQuery, store?.teamId, store?.city]);

  if (!store)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>Toko tidak ditemukan.</Muted>
      </View>
    );

  const openVisit = storeVisits.find((v) => !v.checkOutAt && v.ncId === me.id);
  const nc = users.find((u) => u.id === store.assignedNcId);
  const isManager = STORE_MANAGER_ROLES.includes(me.role);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{
          padding: 16,
          gap: 12,
          paddingBottom: me.role === 'nc' ? STICKY_FOOTER_SPACE : 24,
          maxWidth: 900,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <H style={{ fontSize: T.header.fontSize, flexShrink: 1 }}>{store.name}</H>
            <Badge label={CATEGORY_LABEL[store.category] ?? store.category} color={C.info} />
          </View>
          <Muted style={{ marginTop: 4 }}>
            {store.address}
            {'\n'}
            {store.city} · Channel {store.channel || '-'}
            {store.account ? ` · ${store.account}` : ''}
          </Muted>
          <Muted style={{ marginTop: 6 }}>NC: {nc?.name ?? 'Belum di-assign'}</Muted>
          <Muted>Dibuat: {fmtDateTime(store.createdAt)}</Muted>
          {store.lat == null || store.lng == null ? (
            <View style={{ marginTop: 8 }}>
              <Badge label="Titik GPS belum diset — kunjungan tidak geo-valid" color={C.warn} />
            </View>
          ) : (
            <Muted>
              GPS: {store.lat.toFixed(6)}, {store.lng.toFixed(6)}
            </Muted>
          )}
          {isManager && !editing && (
            <View style={{ marginTop: 8, alignSelf: 'flex-start' }}>
              <Btn small variant="outline" title="Ubah Data Toko" onPress={() => setEditing(true)} disabled={!online} />
            </View>
          )}
        </Card>

        {isManager && <OnlineOnlyNote text="Offline — perubahan data toko dan penugasan NC baru bisa disimpan saat ada koneksi." />}
        {isManager && editing && <StoreEditForm store={store} onDone={() => setEditing(false)} />}

        {isManager && (
          <Card>
            <H>Assign ke Nutrition Consultant</H>
            <Muted style={{ marginTop: 2 }}>NC saat ini: {nc?.name ?? 'Belum di-assign'}</Muted>
            {assigning ? (
              <View style={{ gap: 6, marginTop: 8 }}>
                <Input placeholder="Cari nama atau username NC..." value={ncQuery} onChangeText={setNcQuery} autoFocus />
                {ncMatches.length === 0 ? (
                  <Muted>Tidak ada NC yang cocok.</Muted>
                ) : (
                  ncMatches.map((u) => (
                    <ListRow
                      key={u.id}
                      title={u.name}
                      subtitle={[teams.find((t) => t.id === u.teamId)?.name, u.city].filter(Boolean).join(' · ') || u.username}
                      trailing={store.assignedNcId === u.id ? <Badge label="Saat ini" color={C.info} /> : undefined}
                      onPress={() => {
                        upsertStore({ ...store, assignedNcId: u.id, teamId: u.teamId });
                        setAssigning(false);
                        setNcQuery('');
                      }}
                    />
                  ))
                )}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  {store.assignedNcId && (
                    <Btn
                      small
                      variant="danger"
                      title="Lepas NC dari toko ini"
                      onPress={() => {
                        upsertStore({ ...store, assignedNcId: null });
                        setAssigning(false);
                      }}
                    />
                  )}
                  <Btn small variant="outline" title="Tutup" onPress={() => { setAssigning(false); setNcQuery(''); }} />
                </View>
              </View>
            ) : (
              <View style={{ marginTop: 8 }}>
                <Btn small title="Pilih NC" variant="outline" onPress={() => setAssigning(true)} disabled={!online} />
              </View>
            )}
          </Card>
        )}

        <Card>
          <SectionHeader level="card" title={`Riwayat Kunjungan (${storeVisits.length})`} />
          <HistoryNotice />
          {storeVisits.length === 0 ? (
            <Empty icon="storefront-outline" text="Belum ada kunjungan ke toko ini." />
          ) : (
            <View style={{ gap: 8, marginTop: 10 }}>
              <ShowMore
                items={storeVisits}
                pageSize={15}
                render={(v) => (
                  <ListRow
                    key={v.id}
                    onPress={() => navigation.navigate('StoreVisit', { visitId: v.id })}
                    title={users.find((u) => u.id === v.ncId)?.name ?? v.ncId}
                    subtitle={v.checkOutAt ? `Selesai · durasi ${fmtDurShort(v.checkOutAt - v.checkInAt)}` : 'Berlangsung (belum check-out)'}
                    trailing={<GeoValidBadge ok={v.geoValid} okLabel="Lokasi sesuai" badLabel={`${v.storeDistanceM ?? '?'} m dari toko`} />}
                    meta={fmtDateTime(v.checkInAt)}
                  />
                )}
              />
            </View>
          )}
        </Card>
      </ScrollView>

      {me.role === 'nc' && (
        <StickyFooter>
          <Btn
            title={openVisit ? 'Lanjutkan Kunjungan' : checkingStoreId === store.id ? 'Mengambil lokasi…' : 'CHECK IN'}
            onPress={() => void checkIn(store)}
            disabled={checkingStoreId != null}
            loading={checkingStoreId === store.id}
          />
        </StickyFooter>
      )}
    </View>
  );
}
