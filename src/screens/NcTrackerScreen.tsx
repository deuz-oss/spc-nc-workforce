import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Btn, Card, Empty, ListRow, Muted, SectionHeader, StatCard } from '../components/ui';
import { HistoryNotice } from '../components/HistoryNotice';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDateTime, fmtDurShort } from '../utils/format';
import { openReportPhoto } from '../utils/storage';

/**
 * Per-NC drill-down (PRD §10 "NC Tracker: per-NC detail — visit log, facing
 * counts, SOS %, photos"). Phase 4a (PRD §16).
 *
 * Deliberately shows none of the fields that could expose consumer PII (no
 * consumer name/WhatsApp contact anywhere on this screen) — PRD §10's NC
 * Tracker spec is visit/facing/photo data, not consumer records, so this
 * screen is PII-safe by construction for both PM and Reckitt regardless of
 * role. `hidePii` is still derived here (not passed in) for consistency with
 * ManagementDashboard, in case a future consumer-level addition needs it.
 */
export default function NcTrackerScreen() {
  const me = useCurrentUser()!;
  const hidePii = me.role === 'reckitt_client';
  const route = useRoute<any>();
  const ncId: string = route.params?.ncId;

  const users = useStore((s) => s.users);
  const visits = useStore((s) => s.visits);
  const stores = useStore((s) => s.stores);
  const shareOfShelfRows = useStore((s) => s.shareOfShelfRows);

  const nc = users.find((u) => u.id === ncId);
  const ncVisits = useMemo(
    () => visits.filter((v) => v.ncId === ncId).sort((a, b) => b.checkInAt - a.checkInAt),
    [visits, ncId],
  );
  const ncSos = useMemo(
    () => shareOfShelfRows.filter((r) => ncVisits.some((v) => v.id === r.visitId)).sort((a, b) => b.createdAt - a.createdAt),
    [shareOfShelfRows, ncVisits],
  );
  const totalFacing = ncSos.reduce((t, r) => t + r.totalFacingCount, 0);
  const ownFacing = ncSos.reduce((t, r) => t + r.ownFacingCount, 0);
  const sosPct = totalFacing > 0 ? Math.round((100 * ownFacing) / totalFacing) : null;

  if (!nc) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>NC tidak ditemukan.</Muted>
      </View>
    );
  }

  return (
    <ScrollView
      tabIndex={0}
      role="main"
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}
    >
      <SectionHeader title={nc.name} subtitle={nc.city ?? '-'} />

      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <StatCard title="Kunjungan Tercatat" value={String(ncVisits.length)} />
        <StatCard title="Total Facing" value={String(totalFacing)} />
        <StatCard title="SOS %" value={sosPct != null ? `${sosPct}%` : '-'} />
      </View>

      <Card>
        <SectionHeader title="Share of Shelf" subtitle="Facing counts + foto bukti" />
        {ncSos.length === 0 ? (
          <Empty text="Belum ada laporan Share of Shelf." />
        ) : (
          <View style={{ gap: 8, marginTop: 10 }}>
            {ncSos.map((r) => {
              const store = stores.find((s) => s.id === r.storeId);
              return (
                <ListRow
                  key={r.id}
                  title={store?.name ?? '-'}
                  subtitle={`${r.ownFacingCount}/${r.totalFacingCount} facing · ${fmtDateTime(r.createdAt)}`}
                  trailing={<Btn small variant="outline" title="Lihat Foto" onPress={() => void openReportPhoto(r.photoUrl)} />}
                />
              );
            })}
          </View>
        )}
      </Card>

      <Card>
        <SectionHeader title="Log Kunjungan" />
        <HistoryNotice />
        {ncVisits.length === 0 ? (
          <Empty text="Belum ada kunjungan." />
        ) : (
          <View style={{ gap: 8, marginTop: 10 }}>
            {ncVisits.slice(0, 30).map((v) => {
              const store = stores.find((s) => s.id === v.storeId);
              const duration = v.checkOutAt ? fmtDurShort(v.checkOutAt - v.checkInAt) : 'Berlangsung';
              return (
                <ListRow
                  key={v.id}
                  title={store?.name ?? '-'}
                  subtitle={`${fmtDateTime(v.checkInAt)} · ${duration}`}
                  meta={v.geoValid ? 'Geo valid' : 'Di luar radius'}
                />
              );
            })}
          </View>
        )}
      </Card>

      {hidePii && (
        <Muted>Layar ini tidak menampilkan data pribadi konsumen — hanya data kunjungan dan facing count.</Muted>
      )}
    </ScrollView>
  );
}
