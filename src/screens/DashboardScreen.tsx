import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Btn, Card, H, ListRow, Muted, SectionHeader, StatCard, StatusBadge, StickyFooter, STICKY_FOOTER_SPACE } from '../components/ui';
import { useCheckIn, useClockActions } from '../components/fieldActions';
import { useNow } from '../components/useNow';
import { useDataRefresh } from '../components/useDataRefresh';
import ManagementDashboard from './ManagementDashboard';
import {
  CERT_MANAGER_ROLES,
  MANAGEMENT_DASHBOARD_ROLES,
  PJP_MANAGER_ROLES,
  PRODUCT_MANAGER_ROLES,
  ROLE_LABEL,
  SURVEY_BUILDER_ROLES,
  TARGET_MANAGER_ROLES,
} from '../config';
import { C, F, T } from '../theme';
import { scopeUsers, useCurrentUser, useStore } from '../store/useStore';
import { attritionSignal, computeNcStat, statusOf, todaysReportStatus, visitRequiredReports } from '../utils/kpi';
import { getRange, inRange, monthKey, monthRange, programDayKey } from '../utils/period';
import { buildReportItems, groupReports, reviewKey } from '../utils/validation';
import { planCompliance, scheduleStatus } from '../utils/pjp';
import { fmtDurShort, fmtKm, fmtTime } from '../utils/format';

/** One required-report line: icon + text, so "done" never depends on color alone. */
function ReportTick({ label, done }: { label: string; done: boolean }) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      accessible
      accessibilityLabel={`${label}: ${done ? 'sudah diisi' : 'belum diisi'}`}
    >
      <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={done ? C.okStrong : C.muted} />
      <Text style={[T.body, { fontFamily: done ? F.semi : F.reg }]}>
        {label}
        {done ? '' : ' — belum'}
      </Text>
    </View>
  );
}

/**
 * The NC's day as one next step: clock in → check in at the next planned store
 * → finish that visit's reports → clock out. The card says where they are; the
 * one primary action sits at the bottom of the screen (thumb zone).
 */
function useNcNextAction() {
  const me = useCurrentUser()!;
  const navigation = useNavigation();
  const schedules = useStore((s) => s.schedules);
  const visits = useStore((s) => s.visits);
  const stores = useStore((s) => s.stores);
  const stockTakingRows = useStore((s) => s.stockTakingRows);
  const offtakeRows = useStore((s) => s.offtakeRows);
  const ntgGwps = useStore((s) => s.ntgGwps);
  const clock = useClockActions();
  const { checkIn, checkingStoreId } = useCheckIn();
  const now = useNow();

  const today = programDayKey(now);
  const plans = schedules.filter((s) => s.ncId === me.id && programDayKey(s.plannedDate) === today);
  const pending = plans.filter((s) => scheduleStatus(s, visits) !== 'visited');
  const nextStore = pending.map((p) => stores.find((x) => x.id === p.storeId)).find(Boolean);
  const visitStore = clock.openVisit ? stores.find((x) => x.id === clock.openVisit!.storeId) : undefined;
  const required = clock.openVisit ? visitRequiredReports(clock.openVisit.id, stockTakingRows, offtakeRows, ntgGwps) : [];

  type Action = { title: string; onPress: () => void; variant?: 'primary' | 'danger'; loading?: boolean };
  let primary: Action;
  let secondary: Action[] = [];
  let heading: string;
  let body: React.ReactNode;

  if (!clock.active) {
    heading = 'Mulai hari kerja';
    body = <Muted>Clock in untuk mulai merekam rute dan bisa check-in ke toko.</Muted>;
    primary = {
      title: clock.busy === 'in' ? 'Mengambil lokasi…' : 'CLOCK IN',
      onPress: () => void clock.clockIn(),
      loading: clock.busy === 'in',
    };
  } else if (clock.openVisit) {
    const filled = required.filter((r) => r.done).length;
    heading = `Sedang di ${visitStore?.name ?? 'toko'}`;
    body = (
      <View style={{ gap: 6 }}>
        <Muted>{`Laporan wajib kunjungan ini: ${filled} dari ${required.length} terisi`}</Muted>
        {required.map((r) => (
          <ReportTick key={r.key} label={r.label} done={r.done} />
        ))}
      </View>
    );
    primary = { title: 'Lanjutkan Kunjungan', onPress: () => navigation.navigate('StoreVisit', { visitId: clock.openVisit!.id }) };
  } else if (nextStore) {
    const checking = checkingStoreId === nextStore.id;
    heading = 'Toko berikutnya';
    body = (
      <View style={{ gap: 2 }}>
        <Text style={T.h2}>{nextStore.name}</Text>
        <Muted>{[nextStore.address, nextStore.city].filter(Boolean).join(', ')}</Muted>
        <Muted style={{ marginTop: 4 }}>{`${plans.length - pending.length} dari ${plans.length} toko jadwal hari ini sudah dikunjungi`}</Muted>
      </View>
    );
    primary = {
      title: checking ? 'Mengambil lokasi…' : 'CHECK IN',
      onPress: () => void checkIn(nextStore),
      loading: checking,
    };
    secondary = [
      { title: 'Pilih Toko Lain', onPress: () => navigation.navigate('Toko') },
      { title: 'Clock Out', onPress: clock.clockOut, loading: clock.busy === 'out' },
    ];
  } else {
    const allDone = plans.length > 0;
    heading = allDone ? 'Jadwal hari ini selesai' : 'Pilih toko untuk check-in';
    body = (
      <Muted>
        {allDone
          ? `Semua ${plans.length} toko jadwal hari ini sudah dikunjungi. Clock out bila hari kerja selesai.`
          : 'Tidak ada jadwal toko hari ini. Pilih toko dari daftar Toko.'}
      </Muted>
    );
    const pick: Action = { title: 'Pilih Toko', onPress: () => navigation.navigate('Toko') };
    const out: Action = {
      title: clock.busy === 'out' ? 'Menyimpan…' : 'CLOCK OUT',
      onPress: clock.clockOut,
      variant: 'danger',
      loading: clock.busy === 'out',
    };
    primary = allDone ? out : pick;
    secondary = allDone ? [{ ...pick, title: 'Pilih Toko Lain' }] : [{ ...out, title: 'Clock Out', variant: undefined }];
  }

  return { heading, body, primary, secondary, plans, checkIn, checkingStoreId, canCheckIn: !!clock.active && !clock.openVisit };
}

function NextActionCard({ heading, body, secondary }: Pick<ReturnType<typeof useNcNextAction>, 'heading' | 'body' | 'secondary'>) {
  return (
    <Card style={{ gap: 10, borderLeftWidth: 4, borderLeftColor: C.gold }}>
      <Text style={T.caption}>Langkah berikutnya</Text>
      <Text style={T.h1}>{heading}</Text>
      {body}
      {secondary.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {secondary.map((a) => (
            <View key={a.title} style={{ flexGrow: 1 }}>
              <Btn variant="outline" title={a.title} onPress={a.onPress} loading={a.loading} disabled={a.loading} />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** TL/ARCO: clock in/out lives on the Dashboard (they have no Absensi tab). */
function ClockCard() {
  const clock = useClockActions();
  if (clock.active) {
    return (
      <Card style={{ gap: 8 }}>
        <H>Sesi kerja aktif</H>
        <Muted>{`Clock in sejak ${fmtTime(clock.active.clockInAt)}.`}</Muted>
        <Btn
          variant="outline"
          title={clock.busy === 'out' ? 'Menyimpan…' : 'Clock Out'}
          onPress={clock.clockOut}
          loading={clock.busy === 'out'}
          disabled={clock.busy != null}
        />
      </Card>
    );
  }
  return (
    <Card style={{ gap: 8 }}>
      <H>Mulai hari kerja</H>
      <Muted>Clock in untuk mulai merekam rute.</Muted>
      <Btn
        title={clock.busy === 'in' ? 'Mengambil lokasi…' : 'CLOCK IN'}
        onPress={() => void clock.clockIn()}
        disabled={clock.busy != null}
        loading={clock.busy === 'in'}
      />
    </Card>
  );
}

function NcStatsCard() {
  const me = useCurrentUser()!;
  const attendances = useStore((s) => s.attendances);
  const visits = useStore((s) => s.visits);
  const scorecards = useStore((s) => s.scorecards);
  const navigation = useNavigation();
  const range = getRange('monthly');
  const stat = computeNcStat(me.id, me.name, attendances, visits, range);
  const status = statusOf(stat);
  // The official PRD §9 score is the server's (nightly); the card above it is
  // only field discipline from this phone's data — shown apart, labelled apart.
  const official = scorecards.find((sc) => sc.subjectId === me.id && sc.periodKey === monthKey());

  return (
    <Card>
      <SectionHeader title="Ringkasan Bulan Ini" subtitle={status.label} />
      <Muted style={{ marginTop: 2 }}>
        {official
          ? `Skorkartu resmi bulan ini: ${Math.round(official.score)} (dihitung server tiap malam)`
          : 'Skorkartu resmi bulan ini belum dihitung (dihitung server tiap malam).'}
      </Muted>
      <View style={{ alignSelf: 'flex-start', marginTop: 6 }}>
        <Btn small variant="outline" title="Lihat Skorkartu" onPress={() => navigation.navigate('Scorecard')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <StatCard title="Working Hours" value={fmtDurShort(stat.workMs)} color={status.color} />
        <StatCard title="CFT" value={fmtDurShort(stat.cftMs)} sub="Customer Facing Time" />
        <StatCard title="Kunjungan Toko" value={String(stat.visits)} sub={`${stat.distinctStores} toko berbeda`} />
        <StatCard title="Jarak Tempuh" value={fmtKm(stat.km)} />
      </View>
    </Card>
  );
}

/**
 * TL/ARCO landing summary of their scope (PRD §8): who's working today, whose
 * daily reports are in, what's waiting in the exception queue, who's at risk,
 * and offtake against the monthly target — the same rules as the Validasi tab
 * (utils/validation.ts, utils/kpi.ts), so the numbers match it.
 */
function TeamSummaryCard() {
  const me = useCurrentUser()!;
  const navigation = useNavigation();
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const attendances = useStore((s) => s.attendances);
  const visits = useStore((s) => s.visits);
  const stockTakingRows = useStore((s) => s.stockTakingRows);
  const offtakeRows = useStore((s) => s.offtakeRows);
  const shareOfShelfRows = useStore((s) => s.shareOfShelfRows);
  const paidVisibilityRows = useStore((s) => s.paidVisibilityRows);
  const priceMonitoringRows = useStore((s) => s.priceMonitoringRows);
  const ntgGwps = useStore((s) => s.ntgGwps);
  const reportReviews = useStore((s) => s.reportReviews);
  const targets = useStore((s) => s.targets);
  const schedules = useStore((s) => s.schedules);
  const now = useNow();

  const stats = useMemo(() => {
    const ncs = scopeUsers({ users, teams }, me).filter((u) => u.role === 'nc');
    const ncIds = new Set(ncs.map((u) => u.id));
    const today = programDayKey(now);
    const workingToday = new Set(
      attendances.filter((a) => ncIds.has(a.userId) && (!a.clockOutAt || programDayKey(a.clockInAt) === today)).map((a) => a.userId),
    ).size;
    const reportsComplete = ncs.filter((nc) => {
      const st = todaysReportStatus(nc.id, visits, stockTakingRows, offtakeRows, ntgGwps);
      return st.stockTaking && st.offtake && st.ntgGwp;
    }).length;
    const atRisk = ncs.filter((nc) => attritionSignal(nc.id, attendances, visits, stockTakingRows, offtakeRows, ntgGwps).atRisk).length;
    const visitsById = new Map(visits.map((v) => [v.id, v]));
    const groups = groupReports(
      buildReportItems({
        visitsById,
        ncIds,
        range: getRange('weekly'),
        stockTaking: stockTakingRows,
        offtake: offtakeRows,
        shareOfShelf: shareOfShelfRows,
        paidVisibility: paidVisibilityRows,
        priceMonitoring: priceMonitoringRows,
      }),
      new Map(reportReviews.map((r) => [reviewKey(r.reportType, r.reportId), r])),
      visitsById,
    );
    const month = monthKey();
    const mtd = monthRange(month);
    const offtakeMonth = offtakeRows
      .filter((o) => ncIds.has(visitsById.get(o.visitId)?.ncId ?? '') && inRange(o.createdAt, mtd))
      .reduce((t, o) => t + o.unitsSold, 0);
    const target = targets
      .filter((t) => t.periodKey === month && t.ncId && ncIds.has(t.ncId))
      .reduce((t, x) => t + (x.offtakeTarget ?? 0), 0);
    return {
      ncCount: ncs.length,
      workingToday,
      reportsComplete,
      atRisk,
      exceptions: groups.filter((g) => g.isException).length,
      pjp: planCompliance(schedules, visits, ncIds, getRange('weekly')),
      offtakeMonth,
      target,
    };
  }, [now, me, users, teams, attendances, visits, stockTakingRows, offtakeRows, shareOfShelfRows, paidVisibilityRows, priceMonitoringRows, ntgGwps, reportReviews, targets, schedules]);

  return (
    <Card>
      <SectionHeader
        title={me.role === 'arco' ? 'Tim di Bawah Koordinasi Anda' : 'Tim Saya'}
        subtitle={`${stats.ncCount} NC`}
        action={{ label: 'Buka Validasi', onPress: () => navigation.navigate('Validasi') }}
      />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <StatCard title="Bekerja Hari Ini" value={`${stats.workingToday}/${stats.ncCount}`} sub="clock-in hari ini" />
        <StatCard title="Laporan Harian Lengkap" value={`${stats.reportsComplete}/${stats.ncCount}`} sub="Stock, Offtake, NTG" />
        <StatCard
          title="Perlu Ditinjau"
          value={String(stats.exceptions)}
          sub="pengecualian minggu ini"
          color={stats.exceptions ? C.warn : undefined}
        />
        <StatCard title="NC Berisiko" value={String(stats.atRisk)} sub="absen / tak lapor ≥3 dari 7 hari" color={stats.atRisk ? C.warn : undefined} />
        <StatCard
          title="Kepatuhan PJP"
          value={stats.pjp.due ? `${Math.round((100 * stats.pjp.visited) / stats.pjp.due)}%` : '-'}
          sub={stats.pjp.due ? `${stats.pjp.visited}/${stats.pjp.due} jadwal minggu ini` : 'belum ada jadwal minggu ini'}
        />
        <StatCard
          title="Offtake Bulan Ini"
          value={String(stats.offtakeMonth)}
          sub={stats.target ? `target ${stats.target} (${Math.round((100 * stats.offtakeMonth) / stats.target)}%)` : 'target belum diset'}
        />
      </View>
    </Card>
  );
}

/** The NC's PJP for today: which stores, which are visited, check-in from the row. */
function TodayPlanCard({
  plans,
  checkIn,
  checkingStoreId,
  canCheckIn,
}: Pick<ReturnType<typeof useNcNextAction>, 'plans' | 'checkIn' | 'checkingStoreId' | 'canCheckIn'>) {
  const navigation = useNavigation();
  const visits = useStore((s) => s.visits);
  const stores = useStore((s) => s.stores);
  const visited = plans.filter((s) => scheduleStatus(s, visits) === 'visited').length;

  return (
    <Card>
      <SectionHeader
        title="Jadwal hari ini"
        subtitle={plans.length ? `${visited} dari ${plans.length} toko dikunjungi` : undefined}
        action={{ label: 'Jadwal minggu ini', onPress: () => navigation.navigate('Pjp') }}
      />
      {plans.length === 0 ? (
        <Muted style={{ marginTop: 6 }}>Tidak ada toko dijadwalkan hari ini.</Muted>
      ) : (
        <View style={{ gap: 8, marginTop: 10 }}>
          {plans.map((s) => {
            const store = stores.find((x) => x.id === s.storeId);
            const done = scheduleStatus(s, visits) === 'visited';
            const checking = checkingStoreId === s.storeId;
            return (
              <ListRow
                key={s.id}
                title={store?.name ?? s.storeId}
                subtitle={store?.address || store?.city}
                trailing={
                  done ? (
                    <StatusBadge label="Dikunjungi" color={C.okStrong} icon="checkmark-circle" />
                  ) : canCheckIn && store ? (
                    <Btn small title={checking ? 'Lokasi…' : 'Check-in'} loading={checking} disabled={checkingStoreId != null} onPress={() => void checkIn(store)} />
                  ) : (
                    <StatusBadge label="Belum" color={C.infoStrong} icon="time-outline" />
                  )
                }
                onPress={store ? () => navigation.navigate('StoreDetail', { storeId: store.id }) : undefined}
              />
            );
          })}
        </View>
      )}
    </Card>
  );
}

/** NC home: next step first, today's plan, then the month — primary action in the thumb zone. */
function NcDashboard() {
  const me = useCurrentUser()!;
  const refreshControl = useDataRefresh();
  const next = useNcNextAction();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        refreshControl={refreshControl}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: STICKY_FOOTER_SPACE, maxWidth: 900, width: '100%', alignSelf: 'center' }}
      >
        <SectionHeader title={`Halo, ${me.name}`} subtitle={ROLE_LABEL[me.role]} />
        <NextActionCard heading={next.heading} body={next.body} secondary={next.secondary} />
        <TodayPlanCard plans={next.plans} checkIn={next.checkIn} checkingStoreId={next.checkingStoreId} canCheckIn={next.canCheckIn} />
        <NcStatsCard />
      </ScrollView>
      <StickyFooter>
        <Btn
          title={next.primary.title}
          onPress={next.primary.onPress}
          variant={next.primary.variant ?? 'primary'}
          loading={next.primary.loading}
          disabled={next.primary.loading}
        />
      </StickyFooter>
    </View>
  );
}

export default function DashboardScreen() {
  const me = useCurrentUser()!;
  const refreshControl = useDataRefresh();
  const users = useStore((s) => s.users);
  const stores = useStore((s) => s.stores);
  const navigation = useNavigation();

  // pm/reckitt_client/data_analyst get the full PRD §10/§11 management
  // dashboard (Phase 4a, PRD §16) as their entire screen — it's its own
  // ScrollView, so it replaces this screen's body rather than nesting inside
  // it. super_admin keeps the simple placeholder below (not a PRD §10 KPI
  // consumer role).
  if (MANAGEMENT_DASHBOARD_ROLES.includes(me.role)) {
    return <ManagementDashboard />;
  }
  if (me.role === 'nc') return <NcDashboard />;

  return (
    <ScrollView
      tabIndex={0}
      role="main"
      refreshControl={refreshControl}
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}
    >
      <SectionHeader title={`Halo, ${me.name}`} subtitle={ROLE_LABEL[me.role]} />

      {(me.role === 'tl' || me.role === 'arco') && <ClockCard />}

      {me.role === 'super_admin' && (
        <Card>
          <SectionHeader
            title="Ringkasan Program"
            subtitle={`${users.filter((u) => u.active).length} akun aktif · ${new Set(stores.map((s) => s.city).filter(Boolean)).size} kota`}
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <StatCard title="Total Pengguna Aktif" value={String(users.filter((u) => u.active).length)} />
            <StatCard title="Toko Terdaftar" value={String(stores.length)} />
            <StatCard title="Toko Belum Ter-assign" value={String(stores.filter((s) => !s.assignedNcId).length)} color={C.warn} />
          </View>
        </Card>
      )}

      {(me.role === 'tl' || me.role === 'arco') && <TeamSummaryCard />}

      {PJP_MANAGER_ROLES.includes(me.role) && (
        <Card>
          <SectionHeader
            title="Jadwal Kunjungan (PJP)"
            subtitle="Rencana toko per hari untuk setiap NC"
            action={{ label: 'Atur', onPress: () => navigation.navigate('Pjp') }}
          />
        </Card>
      )}

      {CERT_MANAGER_ROLES.includes(me.role) && (
        <Card>
          <SectionHeader
            title="Sertifikasi"
            subtitle="Catat hasil sesi sertifikasi NC & TL-Coach (PRD §9)"
            action={{ label: 'Buka', onPress: () => navigation.navigate('Certifications') }}
          />
        </Card>
      )}

      {PRODUCT_MANAGER_ROLES.includes(me.role) && (
        <Card>
          <SectionHeader
            title="Master Produk"
            subtitle="SKU untuk pilihan laporan NC — tambah, ubah, nonaktifkan"
            action={{ label: 'Kelola', onPress: () => navigation.navigate('Products') }}
          />
        </Card>
      )}

      {TARGET_MANAGER_ROLES.includes(me.role) && (
        <Card>
          <SectionHeader
            title="Target Bulanan"
            subtitle="Target offtake & alokasi GWP per NC (PRD §9)"
            action={{ label: 'Atur Target', onPress: () => navigation.navigate('Targets') }}
          />
        </Card>
      )}

      {SURVEY_BUILDER_ROLES.includes(me.role) && (
        <Card>
          <SectionHeader
            title="Survey"
            subtitle="Question set untuk NC (PRD §5.7)"
            action={{ label: 'Kelola Survey', onPress: () => navigation.navigate('SurveyBuilder') }}
          />
        </Card>
      )}

      <Card>
        <SectionHeader
          title="Toko"
          action={{ label: 'Lihat semua', onPress: () => navigation.navigate('Toko') }}
        />
        <Muted style={{ marginTop: 4 }}>
          {stores.length === 0
            ? 'Belum ada data toko. Super Admin, Admin Data Entry, TL, dan ARCO dapat mengimpor dari tab Toko → Impor CSV.'
            : `${stores.length} toko tercatat.`}
        </Muted>
      </Card>
    </ScrollView>
  );
}
