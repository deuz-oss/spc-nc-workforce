import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Btn,
  Card,
  Chip,
  Empty,
  Input,
  ListRow,
  Muted,
  SectionHeader,
  OfflineNote,
  StatusBadge,
} from '../components/ui';
import { LiveTeamMap } from '../components/LiveTeamMap';
import { useOnline } from '../components/useOnline';
import { useDataRefresh } from '../components/useDataRefresh';
import { REPORT_TYPE_LABEL } from '../config';
import { useCurrentUser, useStore, scopeUsers } from '../store/useStore';
import { attritionSignal, todaysReportStatus } from '../utils/kpi';
import { getRange, inRange, monthKey, monthRange, PERIODS, PeriodKey } from '../utils/period';
import { fmtDateTime } from '../utils/format';
import { ReportPhotoThumb } from '../components/ReportPhotoThumb';
import { buildReportItems, groupReports, ReportGroup, reviewKey } from '../utils/validation';
import { ShowMore } from '../components/ShowMore';
import { C, T } from '../theme';

/**
 * TL/ARCO validation console (PRD §8), exception-based per the PRD review
 * note added to §8: 12 TLs cover 195 NCs (~16:1), so requiring a manual touch
 * on every report isn't operationally achievable — only anomalies/flags need
 * action, everything else auto-approves. One card per report (all SKU lines of
 * a module in one visit), reviewed as a whole — see utils/validation.ts.
 */

export default function ValidationQueueScreen() {
  const navigation = useNavigation();
  const me = useCurrentUser()!;
  const refreshControl = useDataRefresh();
  const online = useOnline();
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const stores = useStore((s) => s.stores);
  const visits = useStore((s) => s.visits);
  const attendances = useStore((s) => s.attendances);
  const stockTakingRows = useStore((s) => s.stockTakingRows);
  const offtakeRows = useStore((s) => s.offtakeRows);
  const shareOfShelfRows = useStore((s) => s.shareOfShelfRows);
  const paidVisibilityRows = useStore((s) => s.paidVisibilityRows);
  const priceMonitoringRows = useStore((s) => s.priceMonitoringRows);
  const ntgGwps = useStore((s) => s.ntgGwps);
  const reportReviews = useStore((s) => s.reportReviews);
  const targets = useStore((s) => s.targets);
  const reviewReports = useStore((s) => s.reviewReports);

  const [periodKey, setPeriodKey] = useState<PeriodKey>('weekly');
  const [flaggingKey, setFlaggingKey] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** 'exceptions' = the PRD §8 exception queue; 'all' = every report in scope, for spot checks / manual flags. */
  const [view, setView] = useState<'exceptions' | 'all'>('exceptions');
  /** One part of the console at a time — a TL on a phone shouldn't scroll past a map to reach the queue. */
  const [section, setSection] = useState<'queue' | 'map' | 'team'>('queue');

  const range = useMemo(() => getRange(periodKey), [periodKey]);
  const thisMonth = monthKey();

  const ncUsers = useMemo(
    () => scopeUsers({ users, teams }, me).filter((u) => u.role === 'nc'),
    [users, teams, me],
  );
  const ncIds = useMemo(() => new Set(ncUsers.map((u) => u.id)), [ncUsers]);
  const visitsById = useMemo(() => new Map(visits.map((v) => [v.id, v])), [visits]);

  const items = useMemo(
    () =>
      buildReportItems({
        visitsById,
        ncIds,
        range,
        stockTaking: stockTakingRows,
        offtake: offtakeRows,
        shareOfShelf: shareOfShelfRows,
        paidVisibility: paidVisibilityRows,
        priceMonitoring: priceMonitoringRows,
      }),
    [stockTakingRows, offtakeRows, shareOfShelfRows, paidVisibilityRows, priceMonitoringRows, visitsById, ncIds, range],
  );
  const reviewByKey = useMemo(() => new Map(reportReviews.map((r) => [reviewKey(r.reportType, r.reportId), r])), [reportReviews]);
  const groups = useMemo(() => groupReports(items, reviewByKey, visitsById), [items, reviewByKey, visitsById]);
  const exceptions = useMemo(() => groups.filter((g) => g.isException), [groups]);
  const normalCount = groups.length - exceptions.length;
  const shown = view === 'exceptions' ? exceptions : groups;
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const storesById = useMemo(() => new Map(stores.map((st) => [st.id, st])), [stores]);

  /** Approve / flag every line of the report at once. */
  const act = async (g: ReportGroup, status: 'approved' | 'flagged', note?: string) => {
    setBusyKey(g.key);
    await reviewReports(g.items.map((it) => ({ reportType: it.type, reportId: it.id })), status, note);
    setBusyKey(null);
    setFlaggingKey(null);
    setFlagNote('');
  };

  const rollup = useMemo(
    () =>
      ncUsers.map((nc) => {
        const todays = todaysReportStatus(nc.id, visits, stockTakingRows, offtakeRows, ntgGwps);
        const risk = attritionSignal(nc.id, attendances, visits, stockTakingRows, offtakeRows, ntgGwps);
        const units = (r: { from: number; to: number }) =>
          offtakeRows
            .filter((o) => visitsById.get(o.visitId)?.ncId === nc.id && inRange(o.createdAt, r))
            .reduce((t, o) => t + o.unitsSold, 0);
        const offtakeInRange = units(range);
        // Targets are monthly: compare them with this month so far, never with
        // the selected day/week (that made every NC look far behind target).
        const offtakeMonth = units(monthRange(thisMonth));
        const target = targets.find((t) => t.ncId === nc.id && t.periodKey === thisMonth)?.offtakeTarget;
        return { nc, todays, risk, offtakeInRange, offtakeMonth, target };
      }),
    [ncUsers, visits, stockTakingRows, offtakeRows, ntgGwps, attendances, visitsById, range, targets, thisMonth],
  );
  const atRiskCount = rollup.filter((r) => r.risk.atRisk).length;

  return (
    <ScrollView
      tabIndex={0}
      role="main"
      refreshControl={refreshControl}
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}
    >
      <SectionHeader
        title="Validasi Laporan"
        subtitle={me.role === 'arco' ? 'Semua tim di bawah koordinasi Anda' : 'Tim Anda'}
        action={{ label: 'Coaching Log', onPress: () => navigation.navigate('CoachingLog') }}
      />

      <View role="tablist" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip label={`Antrian (${exceptions.length})`} active={section === 'queue'} onPress={() => setSection('queue')} />
        <Chip label="Peta Tim" active={section === 'map'} onPress={() => setSection('map')} />
        <Chip
          label={atRiskCount ? `Tim (${atRiskCount} perlu perhatian)` : 'Tim'}
          active={section === 'team'}
          onPress={() => setSection('team')}
        />
      </View>

      {section !== 'map' && (
        <View style={{ gap: 6 }}>
          <Text style={T.caption}>Periode</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {PERIODS.filter((p) => p.key !== 'all').map((p) => (
              <Chip key={p.key} label={p.label} active={periodKey === p.key} onPress={() => setPeriodKey(p.key)} />
            ))}
          </View>
        </View>
      )}

      {section === 'map' && (
        <Card>
          <LiveTeamMap ncUsers={ncUsers} visits={visits} stores={stores} />
        </Card>
      )}

      {section === 'queue' && (
        <Card>
          <SectionHeader level="card"
            title={view === 'exceptions' ? 'Antrian Pengecualian' : 'Semua Laporan'}
            subtitle={
              view === 'exceptions'
                ? 'Hanya laporan yang janggal atau ditandai — perlu Anda cek'
                : 'Semua laporan periode ini — untuk cek acak dan tandai manual'
            }
          />
          {!online && (
            <View style={{ marginTop: 8 }}>
              <OfflineNote text="Offline — setujui dan tandai laporan bisa dilakukan lagi setelah ada koneksi." />
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Chip label={`Pengecualian (${exceptions.length})`} active={view === 'exceptions'} onPress={() => setView('exceptions')} />
            <Chip label={`Semua (${groups.length})`} active={view === 'all'} onPress={() => setView('all')} />
          </View>
          {shown.length === 0 ? (
            <Empty
              icon={view === 'exceptions' ? 'checkmark-done-outline' : 'document-text-outline'}
              text={view === 'exceptions' ? 'Tidak ada laporan yang perlu ditinjau.' : 'Belum ada laporan pada periode ini.'}
            />
          ) : (
            <View style={{ gap: 8, marginTop: 10 }}>
              <ShowMore
                key={`${view}:${periodKey}`}
                items={shown}
                render={(g) => {
                  const nc = usersById.get(g.ncId);
                  const store = storesById.get(g.storeId);
                  const lines = g.items.length > 1 ? ` · ${g.items.length} SKU` : '';
                  const status =
                    g.status === 'flagged'
                      ? { label: 'Ditandai', color: C.warn, icon: 'alert-circle' as const, reason: g.note || 'Ditandai untuk ditinjau' }
                      : g.status === 'approved'
                        ? { label: 'Disetujui', color: C.ok, icon: 'checkmark-circle' as const, reason: 'Disetujui manual' }
                        : g.autoFlag
                          ? { label: 'Perlu Dicek', color: C.warn, icon: 'alert-circle' as const, reason: g.autoFlag }
                          : { label: 'Normal', color: C.ok, icon: 'checkmark-circle' as const, reason: 'Otomatis disetujui' };
                  return (
                    <View key={g.key} style={{ gap: 6 }}>
                      <ListRow
                        title={`${REPORT_TYPE_LABEL[g.type]}${lines} · ${nc?.name ?? '-'}`}
                        subtitle={`${store?.name ?? '-'} · ${fmtDateTime(g.createdAt)}`}
                        meta={status.reason}
                        trailing={<StatusBadge label={status.label} color={status.color} icon={status.icon} />}
                      />
                      {g.photoUrl && (
                        <View style={{ paddingHorizontal: 4 }}>
                          <ReportPhotoThumb photoRef={g.photoUrl} label={`${REPORT_TYPE_LABEL[g.type]} ${store?.name ?? ''}`} />
                        </View>
                      )}
                      {flaggingKey === g.key ? (
                        <View style={{ gap: 8, paddingHorizontal: 4 }}>
                          <Input placeholder="Alasan ditandai (wajib)" value={flagNote} onChangeText={setFlagNote} multiline accessibilityLabel="Alasan ditandai" />
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <Btn
                              small
                              title="Kirim Tanda"
                              disabled={!flagNote.trim() || busyKey === g.key || !online}
                              loading={busyKey === g.key}
                              onPress={() => act(g, 'flagged', flagNote)}
                            />
                            <Btn small variant="outline" title="Batal" onPress={() => { setFlaggingKey(null); setFlagNote(''); }} />
                          </View>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
                          <View style={{ flex: 1 }}>
                            <Btn variant="ok" title="Setujui" disabled={busyKey === g.key || !online} loading={busyKey === g.key} onPress={() => act(g, 'approved')} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Btn variant="outline" title="Tandai" disabled={!online} onPress={() => { setFlaggingKey(g.key); setFlagNote(''); }} />
                          </View>
                        </View>
                      )}
                    </View>
                  );
                }}
              />
            </View>
          )}
          <Muted style={{ marginTop: 12 }}>
            {normalCount} laporan normal periode ini sudah otomatis disetujui.
          </Muted>
        </Card>
      )}

      {section === 'team' && (
        <Card>
          <SectionHeader level="card" title="Ringkasan Tim" subtitle={`${atRiskCount} dari ${ncUsers.length} NC perlu perhatian`} />
          <View style={{ gap: 8, marginTop: 10 }}>
            {ncUsers.length === 0 ? (
              <Empty text="Belum ada NC di scope Anda." />
            ) : (
              <ShowMore
                items={rollup}
                render={({ nc, todays, risk, offtakeInRange, offtakeMonth, target }) => (
                  <ListRow
                    key={nc.id}
                    title={nc.name}
                    subtitle={`Laporan hari ini: ${[todays.stockTaking && 'Stock', todays.offtake && 'Offtake', todays.ntgGwp && 'NTG&GWP'].filter(Boolean).join(', ') || 'Belum ada'}`}
                    meta={
                      `Offtake periode ini: ${offtakeInRange} · ` +
                      (target
                        ? `bulan ini ${offtakeMonth}/${target} (${Math.round((100 * offtakeMonth) / target)}%)`
                        : `bulan ini ${offtakeMonth} (target belum diset)`)
                    }
                    trailing={
                      risk.atRisk ? (
                        <StatusBadge label="Perlu Perhatian" color={C.warn} icon="alert-circle" />
                      ) : (
                        <StatusBadge label="Aman" color={C.ok} icon="checkmark-circle" />
                      )
                    }
                  />
                )}
              />
            )}
          </View>
          <Muted style={{ marginTop: 10 }}>
            “Perlu Perhatian”: tidak absen atau tidak lapor pada 3 hari atau lebih dari 7 hari terakhir.
          </Muted>
        </Card>
      )}
    </ScrollView>
  );
}
