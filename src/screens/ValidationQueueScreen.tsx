import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
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
  StatusBadge,
} from '../components/ui';
import { LiveTeamMap } from '../components/LiveTeamMap';
import { showDialog } from '../components/dialog';
import { useDataRefresh } from '../components/useDataRefresh';
import { REPORT_TYPE_LABEL } from '../config';
import { useCurrentUser, useStore, scopeUsers } from '../store/useStore';
import { attritionSignal, todaysReportStatus } from '../utils/kpi';
import { getRange, PERIODS, PeriodKey, inRange, monthKey } from '../utils/period';
import { fmtDateTime } from '../utils/format';
import { photoStoragePath } from '../utils/photoRef';
import { openReportPhoto } from '../utils/storage';
import { ReportType } from '../types';

/**
 * TL/ARCO validation console (PRD §8), exception-based per the PRD review
 * note added to §8: 12 TLs cover 195 NCs (~16:1), so requiring a manual touch
 * on every report isn't operationally achievable — only anomalies/flags need
 * action, everything else auto-approves. Phase 4a (PRD §16).
 */

interface ReportItem {
  type: ReportType;
  id: string;
  visitId: string;
  ncId: string;
  storeId: string;
  createdAt: number;
  isOutlier?: boolean;
  /** Evidence photo, when the module has one and it's been uploaded (a
   * still-offline local file:// path isn't viewable from a reviewer's device). */
  photoUrl?: string;
}

/** Only photos that reached Storage are viewable by a reviewer — an offline-queued local file isn't. */
const remotePhoto = (ref?: string) => (photoStoragePath(ref) ? ref : undefined);

export default function ValidationQueueScreen() {
  const navigation = useNavigation<any>();
  const me = useCurrentUser()!;
  const refreshControl = useDataRefresh();
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
  const reviewReport = useStore((s) => s.reviewReport);

  const [periodKey, setPeriodKey] = useState<PeriodKey>('weekly');
  const [flaggingKey, setFlaggingKey] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** 'exceptions' = the PRD §8 exception queue; 'all' = every report in scope, for spot checks / manual flags. */
  const [view, setView] = useState<'exceptions' | 'all'>('exceptions');

  const range = useMemo(() => getRange(periodKey, new Date().getMonth()), [periodKey]);

  const ncUsers = useMemo(
    () => scopeUsers({ users, teams }, me).filter((u) => u.role === 'nc'),
    [users, teams, me],
  );
  const ncIds = useMemo(() => new Set(ncUsers.map((u) => u.id)), [ncUsers]);
  const visitsById = useMemo(() => new Map(visits.map((v) => [v.id, v])), [visits]);

  const items: ReportItem[] = useMemo(() => {
    const inScope = (visitId: string) => {
      const v = visitsById.get(visitId);
      return !!v && ncIds.has(v.ncId) && inRange(v.checkInAt, range);
    };
    const out: ReportItem[] = [];
    for (const r of stockTakingRows) if (inScope(r.visitId)) out.push({ type: 'stock_taking', id: r.id, visitId: r.visitId, ncId: visitsById.get(r.visitId)!.ncId, storeId: r.storeId, createdAt: r.createdAt, photoUrl: remotePhoto(r.photoUrl) });
    for (const r of offtakeRows) if (inScope(r.visitId)) out.push({ type: 'offtake', id: r.id, visitId: r.visitId, ncId: visitsById.get(r.visitId)!.ncId, storeId: r.storeId, createdAt: r.createdAt, isOutlier: r.isOutlier });
    for (const r of shareOfShelfRows) if (inScope(r.visitId)) out.push({ type: 'share_of_shelf', id: r.id, visitId: r.visitId, ncId: visitsById.get(r.visitId)!.ncId, storeId: r.storeId, createdAt: r.createdAt, photoUrl: remotePhoto(r.photoUrl) });
    for (const r of paidVisibilityRows) if (inScope(r.visitId)) out.push({ type: 'paid_visibility', id: r.id, visitId: r.visitId, ncId: visitsById.get(r.visitId)!.ncId, storeId: r.storeId, createdAt: r.createdAt, photoUrl: remotePhoto(r.photoUrl) });
    for (const r of priceMonitoringRows) if (inScope(r.visitId)) out.push({ type: 'price_monitoring', id: r.id, visitId: r.visitId, ncId: visitsById.get(r.visitId)!.ncId, storeId: r.storeId, createdAt: r.createdAt, photoUrl: remotePhoto(r.photoUrl) });
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }, [stockTakingRows, offtakeRows, shareOfShelfRows, paidVisibilityRows, priceMonitoringRows, visitsById, ncIds, range]);

  const reviewByKey = useMemo(() => {
    const m = new Map<string, (typeof reportReviews)[number]>();
    for (const r of reportReviews) m.set(`${r.reportType}:${r.reportId}`, r);
    return m;
  }, [reportReviews]);

  const exceptions = useMemo(
    () =>
      items.filter((item) => {
        const review = reviewByKey.get(`${item.type}:${item.id}`);
        if (review?.status === 'approved') return false;
        if (review?.status === 'flagged') return true;
        return item.type === 'offtake' && item.isOutlier === true;
      }),
    [items, reviewByKey],
  );
  const normalCount = items.length - exceptions.length;
  const shown = view === 'exceptions' ? exceptions : items;

  const act = async (item: ReportItem, status: 'approved' | 'flagged', note?: string) => {
    const key = `${item.type}:${item.id}`;
    setBusyKey(key);
    await reviewReport(item.type, item.id, status, note);
    setBusyKey(null);
    setFlaggingKey(null);
    setFlagNote('');
  };

  const rollup = useMemo(
    () =>
      ncUsers.map((nc) => {
        const todays = todaysReportStatus(nc.id, visits, stockTakingRows, offtakeRows, ntgGwps);
        const risk = attritionSignal(nc.id, attendances, visits, stockTakingRows, offtakeRows, ntgGwps);
        const offtakeInRange = offtakeRows
          .filter((r) => visitsById.get(r.visitId)?.ncId === nc.id && inRange(r.createdAt, range))
          .reduce((t, r) => t + r.unitsSold, 0);
        const periodKeyMonthly = monthKey();
        const target = targets.find((t) => t.ncId === nc.id && t.periodKey === periodKeyMonthly)?.offtakeTarget;
        return { nc, todays, risk, offtakeInRange, target };
      }),
    [ncUsers, visits, stockTakingRows, offtakeRows, ntgGwps, attendances, visitsById, range, targets],
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

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {PERIODS.filter((p) => p.key !== 'all').map((p) => (
          <Chip key={p.key} label={p.label} active={periodKey === p.key} onPress={() => setPeriodKey(p.key)} />
        ))}
      </View>

      <Card>
        <LiveTeamMap ncUsers={ncUsers} visits={visits} stores={stores} />
      </Card>

      <Card>
        <SectionHeader
          title={view === 'exceptions' ? 'Antrian Pengecualian' : 'Semua Laporan'}
          subtitle={
            view === 'exceptions'
              ? 'Hanya laporan anomali/flag yang butuh tindakan manual'
              : 'Semua laporan periode ini — untuk cek acak & flag manual'
          }
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Chip label={`Pengecualian (${exceptions.length})`} active={view === 'exceptions'} onPress={() => setView('exceptions')} />
          <Chip label={`Semua (${items.length})`} active={view === 'all'} onPress={() => setView('all')} />
        </View>
        {shown.length === 0 ? (
          <Empty text={view === 'exceptions' ? 'Tidak ada laporan yang perlu ditinjau.' : 'Belum ada laporan pada periode ini.'} />
        ) : (
          <View style={{ gap: 8, marginTop: 10 }}>
            {shown.map((item) => {
              const key = `${item.type}:${item.id}`;
              const nc = users.find((u) => u.id === item.ncId);
              const store = stores.find((s) => s.id === item.storeId);
              const review = reviewByKey.get(key);
              const status = review?.status === 'flagged'
                ? { label: 'Ditandai', color: '#B45309', icon: 'alert-circle' as const, reason: review.note || 'Ditandai untuk ditinjau' }
                : review?.status === 'approved'
                  ? { label: 'Disetujui', color: '#15803D', icon: 'checkmark-circle' as const, reason: 'Disetujui manual' }
                  : item.isOutlier
                    ? { label: 'Outlier', color: '#B45309', icon: 'alert-circle' as const, reason: 'Outlier: >3x rata-rata 7 hari NC ini' }
                    : { label: 'Normal', color: '#15803D', icon: 'checkmark-circle' as const, reason: 'Otomatis disetujui' };
              return (
                <View key={key} style={{ gap: 6 }}>
                  <ListRow
                    title={`${REPORT_TYPE_LABEL[item.type]} · ${nc?.name ?? '-'}`}
                    subtitle={`${store?.name ?? '-'} · ${fmtDateTime(item.createdAt)}`}
                    meta={status.reason}
                    trailing={<StatusBadge label={status.label} color={status.color} icon={status.icon} />}
                  />
                  {item.photoUrl && (
                    <View style={{ paddingHorizontal: 4, alignSelf: 'flex-start' }}>
                      <Btn small variant="outline" title="Lihat Foto Bukti" onPress={() => void openReportPhoto(item.photoUrl)} />
                    </View>
                  )}
                  {flaggingKey === key ? (
                    <View style={{ gap: 8, paddingHorizontal: 4 }}>
                      <Input
                        placeholder="Catatan (wajib untuk flag)"
                        value={flagNote}
                        onChangeText={setFlagNote}
                        multiline
                      />
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Btn
                          small
                          title="Kirim Flag"
                          disabled={!flagNote.trim() || busyKey === key}
                          loading={busyKey === key}
                          onPress={() => act(item, 'flagged', flagNote)}
                        />
                        <Btn small variant="outline" title="Batal" onPress={() => { setFlaggingKey(null); setFlagNote(''); }} />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
                      <Btn small variant="ok" title="Approve" disabled={busyKey === key} loading={busyKey === key} onPress={() => act(item, 'approved')} />
                      <Btn small variant="outline" title="Flag" onPress={() => { setFlaggingKey(key); setFlagNote(''); }} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
        <Muted style={{ marginTop: 12 }}>
          {normalCount} laporan normal periode ini, otomatis disetujui (tidak butuh tindakan manual).
        </Muted>
      </Card>

      <Card>
        <SectionHeader title="Ringkasan Tim" subtitle={`${atRiskCount} dari ${ncUsers.length} NC perlu perhatian`} />
        <View style={{ gap: 8, marginTop: 10 }}>
          {ncUsers.length === 0 ? (
            <Empty text="Belum ada NC di scope Anda." />
          ) : (
            rollup.map(({ nc, todays, risk, offtakeInRange, target }) => (
              <ListRow
                key={nc.id}
                title={nc.name}
                subtitle={`Laporan hari ini: ${[todays.stockTaking && 'Stock', todays.offtake && 'Offtake', todays.ntgGwp && 'NTG&GWP'].filter(Boolean).join(', ') || 'Belum ada'}`}
                meta={target ? `Offtake: ${offtakeInRange}/${target}` : `Offtake: ${offtakeInRange} (target belum diset)`}
                trailing={
                  risk.atRisk ? (
                    <StatusBadge label="Perlu Perhatian" color="#B45309" icon="alert-circle" />
                  ) : (
                    <StatusBadge label="On Track" color="#15803D" icon="checkmark-circle" />
                  )
                }
              />
            ))
          )}
        </View>
        <Muted style={{ marginTop: 10 }}>
          Sinyal "Perlu Perhatian": tidak absen ≥3 dari 7 hari terakhir, atau tidak lapor ≥3 dari 7 hari terakhir.
          Tren "penurunan performa 2 minggu berturut-turut" (PRD §9) belum diimplementasikan — definisi/formula
          belum ditentukan client (lihat PRD §15).
        </Muted>
      </Card>
    </ScrollView>
  );
}
