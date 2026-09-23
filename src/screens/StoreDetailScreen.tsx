import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Badge, Btn, Card, Chip, Empty, GeoValidBadge, H, ListRow, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { CATEGORY_LABEL, STORE_MANAGER_ROLES, VISIT_VALID_RADIUS_M } from '../config';
import { showDialog } from '../components/dialog';
import { C } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDateTime, fmtDurShort } from '../utils/format';
import { haversineM } from '../utils/geo';
import { LocationPermissionDeniedError, requestCurrentCoords } from '../utils/location';

export default function StoreDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const me = useCurrentUser()!;
  const store = useStore((s) => s.stores.find((m) => m.id === route.params.storeId));
  const users = useStore((s) => s.users);
  const visits = useStore((s) => s.visits);
  const attendances = useStore((s) => s.attendances);
  const upsertStore = useStore((s) => s.upsertStore);
  const startVisit = useStore((s) => s.startVisit);

  const [assigning, setAssigning] = useState(false);
  const [checking, setChecking] = useState(false);

  const storeVisits = useMemo(
    () => visits.filter((v) => v.storeId === route.params.storeId).sort((a, b) => b.checkInAt - a.checkInAt),
    [visits, route.params.storeId],
  );

  if (!store)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>Toko tidak ditemukan.</Muted>
      </View>
    );

  const openVisit = storeVisits.find((v) => !v.checkOutAt && v.ncId === me.id);
  const nc = users.find((u) => u.id === store.assignedNcId);
  const isManager = STORE_MANAGER_ROLES.includes(me.role);
  const ncs = users.filter((u) => u.role === 'nc' && u.active);

  const beginVisit = async () => {
    if (openVisit) {
      navigation.navigate('StoreVisit', { visitId: openVisit.id });
      return;
    }
    const activeAttendance = attendances.find((a) => a.userId === me.id && !a.clockOutAt);
    if (!activeAttendance) {
      showDialog('Belum Clock-in', 'Clock-in terlebih dahulu di tab Dashboard sebelum check-in ke toko.');
      return;
    }
    setChecking(true);
    let lat: number, lng: number;
    try {
      ({ lat, lng } = await requestCurrentCoords());
    } catch (e) {
      setChecking(false);
      if (e instanceof LocationPermissionDeniedError) {
        showDialog('Izin lokasi diperlukan', 'Aktifkan izin lokasi untuk check-in di toko.');
      } else {
        showDialog('Gagal', 'Tidak dapat mengambil lokasi. Coba lagi.');
      }
      return;
    }
    let dist: number | null = null;
    if (store.lat != null && store.lng != null) {
      dist = Math.round(haversineM({ lat: store.lat, lng: store.lng }, { lat, lng }));
      if (dist > VISIT_VALID_RADIUS_M) {
        setChecking(false);
        showDialog(
          'Di Luar Radius',
          `Posisi Anda ${dist}m dari pin toko (maks. ${VISIT_VALID_RADIUS_M}m). Dekati lokasi toko untuk bisa check-in.`,
        );
        return;
      }
    }
    try {
      const id = await startVisit(store.id, me.id, { lat, lng }, dist, true);
      navigation.navigate('StoreVisit', { visitId: id });
    } catch {
      showDialog('Gagal Check-in', 'Tidak dapat menyimpan kunjungan ke server. Periksa koneksi internet dan coba lagi.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{
          padding: 16,
          gap: 12,
          paddingBottom: me.role === 'nc' ? 100 : 24,
          maxWidth: 900,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <H style={{ fontSize: 17, flexShrink: 1 }}>{store.name}</H>
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
        </Card>

        {isManager && (
          <Card>
            <H>Assign ke Nutrition Consultant</H>
            <Muted style={{ marginTop: 2 }}>NC saat ini: {nc?.name ?? 'Belum di-assign'}</Muted>
            {assigning ? (
              <View style={{ gap: 6, marginTop: 8 }}>
                {ncs.map((u) => (
                  <Chip
                    key={u.id}
                    label={u.name}
                    active={store.assignedNcId === u.id}
                    onPress={() => {
                      upsertStore({ ...store, assignedNcId: u.id, teamId: u.teamId });
                      setAssigning(false);
                    }}
                  />
                ))}
                <Chip label="Batalkan assign" active={false} onPress={() => { upsertStore({ ...store, assignedNcId: null }); setAssigning(false); }} />
              </View>
            ) : (
              <View style={{ marginTop: 8 }}>
                <Btn small title="Pilih NC" variant="outline" onPress={() => setAssigning(true)} />
              </View>
            )}
          </Card>
        )}

        <Card>
          <SectionHeader title={`Riwayat Kunjungan (${storeVisits.length})`} />
          {storeVisits.length === 0 ? (
            <Empty text="Belum ada kunjungan." />
          ) : (
            <View style={{ gap: 8, marginTop: 10 }}>
              {storeVisits.map((v) => (
                <ListRow
                  key={v.id}
                  onPress={() => navigation.navigate('StoreVisit', { visitId: v.id })}
                  title={users.find((u) => u.id === v.ncId)?.name ?? v.ncId}
                  subtitle={v.checkOutAt ? `Selesai · durasi ${fmtDurShort(v.checkOutAt - v.checkInAt)}` : 'Berlangsung (belum check-out)'}
                  trailing={<GeoValidBadge ok={v.geoValid} okLabel="Geo valid" badLabel={`${v.storeDistanceM ?? '?'}m`} />}
                  meta={fmtDateTime(v.checkInAt)}
                />
              ))}
            </View>
          )}
        </Card>
      </ScrollView>

      {me.role === 'nc' && (
        <StickyFooter>
          <Btn
            title={openVisit ? 'Lanjutkan Kunjungan (check-in aktif)' : `CHECK IN di ${store.name}`}
            onPress={beginVisit}
            disabled={checking}
            loading={checking}
          />
        </StickyFooter>
      )}
    </View>
  );
}
