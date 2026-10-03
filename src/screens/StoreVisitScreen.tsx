import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, Btn, Card, GeoValidBadge, H, ListRow, Muted, StatusBadge, StickyFooter, STICKY_FOOTER_SPACE } from '../components/ui';
import { showDialog, showToast } from '../components/dialog';
import { clearVisitDrafts } from '../components/useDraft';
import { useNow } from '../components/useNow';
import { VISIT_VALID_RADIUS_M } from '../config';
import { C, T } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDateTime, fmtDurClock } from '../utils/format';

/** The 7 report modules per PRD §5, grouped by task category per the client
 * brief's own grouping. All 7 are real screens as of Phase 3 (PRD §16) — see
 * MODULE_ROUTE. The Nutrition Quiz (§6) isn't listed separately here: it's
 * reached from a consumer's NTG & GWP funnel (ConsumerDetailScreen), not from
 * this generic report list. */
const REPORT_MODULES: { key: string; label: string; hint: string; required: boolean }[] = [
  { key: 'stock_taking', label: 'Stock Taking', hint: 'Jumlah stok per produk', required: true },
  { key: 'offtake', label: 'Offtake', hint: 'Unit terjual per produk', required: true },
  { key: 'ntg_gwp', label: 'NTG & GWP', hint: 'Konsumen yang ditemui', required: true },
  { key: 'share_of_shelf', label: 'Share of Shelf', hint: '2 minggu sekali · hitung facing + foto rak', required: false },
  { key: 'paid_visibility', label: 'Paid Visibility', hint: '2 minggu sekali · cek materi promosi + foto', required: false },
  { key: 'price_monitoring', label: 'Price Monitoring', hint: '2 minggu sekali · harga kita vs kompetitor', required: false },
  { key: 'survey', label: 'Survey', hint: 'Bila ada survey yang sedang berjalan', required: false },
];

type ModuleRoute = 'StockTaking' | 'Offtake' | 'Consumers' | 'ShareOfShelf' | 'PaidVisibility' | 'PriceMonitoring' | 'SurveyList';

const MODULE_ROUTE: Record<string, ModuleRoute> = {
  stock_taking: 'StockTaking',
  offtake: 'Offtake',
  ntg_gwp: 'Consumers',
  share_of_shelf: 'ShareOfShelf',
  paid_visibility: 'PaidVisibility',
  price_monitoring: 'PriceMonitoring',
  survey: 'SurveyList',
};

/** Running visit time — re-renders itself every second, not the whole screen. */
function VisitTimer({ since }: { since: number }) {
  const now = useNow(1000);
  return (
    <Text style={[T.timer, { marginTop: 4 }]} accessibilityLabel={`Durasi kunjungan ${fmtDurClock(now - since)}`}>
      {fmtDurClock(now - since)}
    </Text>
  );
}

export default function StoreVisitScreen() {
  const route = useAppRoute<'StoreVisit'>();
  const navigation = useNavigation();
  const me = useCurrentUser()!;
  const visitId: string | undefined = route.params?.visitId;
  const visit = useStore((s) => s.visits.find((v) => v.id === visitId));
  const stores = useStore((s) => s.stores);
  const finishVisit = useStore((s) => s.finishVisit);
  const stockTakingRows = useStore((s) => s.stockTakingRows);
  const offtakeRows = useStore((s) => s.offtakeRows);
  const ntgGwps = useStore((s) => s.ntgGwps);
  const shareOfShelfRows = useStore((s) => s.shareOfShelfRows);
  const paidVisibilityRows = useStore((s) => s.paidVisibilityRows);
  const priceMonitoringRows = useStore((s) => s.priceMonitoringRows);
  const surveyResponses = useStore((s) => s.surveyResponses);

  /** Modules with at least one report for this visit. */
  const filled = useMemo(() => {
    const has = (rows: { visitId: string | null }[]) => rows.some((r) => r.visitId === visitId);
    return new Set(
      [
        has(stockTakingRows) && 'stock_taking',
        has(offtakeRows) && 'offtake',
        has(ntgGwps) && 'ntg_gwp',
        has(shareOfShelfRows) && 'share_of_shelf',
        has(paidVisibilityRows) && 'paid_visibility',
        has(priceMonitoringRows) && 'price_monitoring',
        has(surveyResponses) && 'survey',
      ].filter(Boolean),
    );
  }, [visitId, stockTakingRows, offtakeRows, ntgGwps, shareOfShelfRows, paidVisibilityRows, priceMonitoringRows, surveyResponses]);

  const store = stores.find((m) => m.id === visit?.storeId);
  const now = useNow();
  const [busy, setBusy] = useState(false);

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

  const missing = REPORT_MODULES.filter((m) => m.required && !filled.has(m.key)).map((m) => m.label);

  const checkOut = () => {
    showDialog(
      missing.length ? 'Laporan Wajib Belum Lengkap' : 'Selesaikan Kunjungan?',
      missing.length
        ? `Belum diisi: ${missing.join(', ')}. Setelah check-out, laporan untuk kunjungan ini tidak bisa ditambah lagi.`
        : 'Semua laporan wajib sudah diisi. Check-out menutup kunjungan di toko ini.',
      [
        { label: missing.length ? 'Isi Dulu' : 'Batal' },
        {
          label: missing.length ? 'Tetap Check-out' : 'Check-out',
          destructive: missing.length > 0,
          onPress: async () => {
            setBusy(true);
            try {
              await finishVisit(visit.id);
              void clearVisitDrafts(visit.id);
              showToast('Check-out berhasil');
              // Back to the day's overview: next store or clock-out.
              navigation.navigate('Main', { screen: 'Dashboard' });
            } catch (e) {
              // Connectivity problems are queued offline, never thrown — this is a server rejection.
              showDialog('Gagal Check-out', e instanceof Error ? e.message : 'Coba lagi.');
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
          paddingBottom: editable ? STICKY_FOOTER_SPACE : 24,
          maxWidth: 900,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <H style={{ flexShrink: 1 }}>{store?.name ?? '-'}</H>
            <Badge
              label={visit.autoClosed ? 'Ditutup otomatis' : done ? 'Selesai' : 'Berlangsung'}
              color={visit.autoClosed ? C.warn : done ? C.ok : C.warn}
            />
          </View>
          <Muted style={{ marginTop: 4 }}>Check-in: {fmtDateTime(visit.checkInAt)}</Muted>
          <Muted>Check-out: {fmtDateTime(visit.checkOutAt)}</Muted>
          {!done && !isStale && <VisitTimer since={visit.checkInAt} />}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <GeoValidBadge
              ok={visit.geoValid}
              okLabel={`Geo valid (${visit.storeDistanceM ?? '-'} m)`}
              badLabel={`Di luar radius (${visit.storeDistanceM ?? '?'} m, batas ${VISIT_VALID_RADIUS_M}m)`}
            />
          </View>
        </Card>

        {/* Report forms are submit-only and RLS lets only the visit's own NC
            insert — other roles review reports from the Validasi tab instead.
            Only while the visit is open: the server refuses reports made after
            check-out (report_server_checks, 0014). */}
        {editable &&
          [true, false].map((required) => {
            const mods = REPORT_MODULES.filter((m) => m.required === required);
            const count = mods.filter((m) => filled.has(m.key)).length;
            return (
              <Card key={String(required)}>
                <H>{required ? `Laporan wajib (${count} dari ${mods.length})` : 'Laporan lainnya'}</H>
                <Muted style={{ marginTop: 2 }}>
                  {required ? 'Isi ketiganya sebelum check-out.' : 'Isi bila jadwalnya tiba atau diminta TL.'}
                </Muted>
                <View style={{ gap: 8, marginTop: 10 }}>
                  {mods.map((m) => {
                    const isFilled = filled.has(m.key);
                    return (
                      <ListRow
                        key={m.key}
                        onPress={() =>
                          // Every module route takes the same { visitId, storeId } params.
                          navigation.navigate(MODULE_ROUTE[m.key] as 'StockTaking', { visitId: visit.id, storeId: visit.storeId })
                        }
                        title={m.label}
                        subtitle={m.hint}
                        emphasis={required && !isFilled ? { color: C.warnStrong, label: 'Belum diisi' } : undefined}
                        trailing={
                          isFilled ? (
                            <StatusBadge label="Terisi" color={C.okStrong} icon="checkmark-circle" />
                          ) : (
                            <Ionicons name="chevron-forward" size={20} color={C.muted} />
                          )
                        }
                      />
                    );
                  })}
                </View>
              </Card>
            );
          })}

        {done && (
          <Card>
            <Muted>
              Kunjungan selesai — laporan tidak bisa ditambahkan lagi. Durasi di lokasi:{' '}
              {Math.round(((visit.checkOutAt ?? 0) - visit.checkInAt) / 60000)} menit.
            </Muted>
          </Card>
        )}
      </ScrollView>

      {editable && (
        <StickyFooter>
          <Btn title={busy ? 'Menyimpan…' : 'CHECK OUT'} variant="ok" onPress={checkOut} disabled={busy} loading={busy} />
        </StickyFooter>
      )}
    </View>
  );
}
