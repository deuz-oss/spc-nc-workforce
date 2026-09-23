import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Badge, Btn, Card, GeoValidBadge, H, ListRow, Muted, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { VISIT_VALID_RADIUS_M } from '../config';
import { C, T } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDateTime, fmtDurClock } from '../utils/format';

/** The 7 report modules per PRD §5, grouped by task category per the client
 * brief's own grouping. All 7 are real screens as of Phase 3 (PRD §16) — see
 * MODULE_ROUTE. The Nutrition Quiz (§6) isn't listed separately here: it's
 * reached from a consumer's NTG & GWP funnel (ConsumerDetailScreen), not from
 * this generic report list. */
const REPORT_MODULES: Array<{ key: string; label: string; group: string; cadence: string }> = [
  { key: 'stock_taking', label: 'Stock Taking', group: 'Sales & Stock', cadence: 'Harian' },
  { key: 'offtake', label: 'Offtake', group: 'Sales & Stock', cadence: 'Harian' },
  { key: 'ntg_gwp', label: 'NTG & GWP', group: 'Sales & Stock', cadence: 'Harian' },
  { key: 'share_of_shelf', label: 'Share of Shelf', group: 'Sales & Stock', cadence: 'Bi-weekly' },
  { key: 'paid_visibility', label: 'Paid Visibility', group: 'Asset Tracking', cadence: 'Bi-weekly' },
  { key: 'price_monitoring', label: 'Price Monitoring', group: 'Weekly/periodic Task', cadence: 'Bi-weekly' },
  { key: 'survey', label: 'Survey', group: 'Weekly/periodic Task', cadence: 'Ad hoc' },
];

const MODULE_ROUTE: Record<string, string> = {
  stock_taking: 'StockTaking',
  offtake: 'Offtake',
  ntg_gwp: 'Consumers',
  share_of_shelf: 'ShareOfShelf',
  paid_visibility: 'PaidVisibility',
  price_monitoring: 'PriceMonitoring',
  survey: 'SurveyList',
};

export default function StoreVisitScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const me = useCurrentUser()!;
  const visitId: string | undefined = route.params?.visitId;
  const visit = useStore((s) => s.visits.find((v) => v.id === visitId));
  const stores = useStore((s) => s.stores);
  const finishVisit = useStore((s) => s.finishVisit);

  const store = stores.find((m) => m.id === visit?.storeId);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visit || visit.checkOutAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [visit && visit.id, visit && visit.checkOutAt]);

  if (!visit)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>Kunjungan tidak ditemukan.</Muted>
      </View>
    );

  const done = !!visit.checkOutAt;
  const isOwner = me.role === 'nc' && visit.ncId === me.id;
  const editable = !done && isOwner;
  const isStale = !done && now - visit.checkInAt > 12 * 3600000;

  const checkOut = () => {
    showDialog(
      'Selesaikan Kunjungan?',
      'Pastikan laporan (Stock Taking, Offtake, dll) untuk kunjungan ini sudah diisi. Check-out menutup sesi kunjungan toko.',
      [
        { label: 'Batal' },
        {
          label: 'Check-out',
          onPress: async () => {
            setBusy(true);
            try {
              await finishVisit(visit.id);
              navigation.goBack();
            } catch {
              showDialog('Gagal Check-out', 'Tidak dapat menyimpan check-out ke server. Periksa koneksi internet dan coba lagi.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{
          padding: 16,
          gap: 12,
          paddingBottom: editable ? 110 : 24,
          maxWidth: 900,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <H style={{ flexShrink: 1 }}>{store?.name ?? '-'}</H>
            <Badge label={done ? 'Selesai' : 'Berlangsung'} color={done ? C.ok : C.warn} />
          </View>
          <Muted style={{ marginTop: 4 }}>Check-in: {fmtDateTime(visit.checkInAt)}</Muted>
          <Muted>Check-out: {fmtDateTime(visit.checkOutAt)}</Muted>
          {!done && !isStale && <Text style={[T.timer, { marginTop: 4 }]}>{fmtDurClock(now - visit.checkInAt)}</Text>}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <GeoValidBadge
              ok={visit.geoValid}
              okLabel={`Geo valid (${visit.storeDistanceM ?? '-'} m)`}
              badLabel={`Di luar radius (${visit.storeDistanceM ?? '?'} m, batas ${VISIT_VALID_RADIUS_M}m)`}
            />
          </View>
        </Card>

        {/* Report forms are submit-only and RLS lets only the visit's own NC
            insert — other roles review reports from the Validasi tab instead. */}
        {isOwner && (
          <Card>
            <H>Laporan Kunjungan</H>
            <Muted style={{ marginTop: 2 }}>
              Isi laporan sesuai kategori tugas selama kunjungan ini berlangsung.
            </Muted>
            <View style={{ gap: 8, marginTop: 10 }}>
              {REPORT_MODULES.map((m) => (
                <ListRow
                  key={m.key}
                  onPress={() => navigation.navigate(MODULE_ROUTE[m.key], { visitId: visit.id, storeId: visit.storeId })}
                  title={m.label}
                  subtitle={`${m.group} · ${m.cadence}`}
                />
              ))}
            </View>
          </Card>
        )}

        {done && (
          <Card>
            <Muted>
              Kunjungan selesai. Durasi di lokasi: {Math.round(((visit.checkOutAt ?? 0) - visit.checkInAt) / 60000)} menit.
            </Muted>
          </Card>
        )}
      </ScrollView>

      {editable && (
        <StickyFooter>
          <Btn title="CHECK OUT" variant="ok" onPress={checkOut} disabled={busy} loading={busy} />
        </StickyFooter>
      )}
    </View>
  );
}
