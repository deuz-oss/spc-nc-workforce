import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Btn, Card, H, Muted, SectionHeader, StatCard } from '../components/ui';
import { showDialog, showToast } from '../components/dialog';
import { useDataRefresh } from '../components/useDataRefresh';
import ManagementDashboard from './ManagementDashboard';
import {
  CERT_MANAGER_ROLES,
  MANAGEMENT_DASHBOARD_ROLES,
  PRODUCT_MANAGER_ROLES,
  ROLE_LABEL,
  SURVEY_BUILDER_ROLES,
  TARGET_MANAGER_ROLES,
} from '../config';
import { C, F } from '../theme';
import { scopeUsers, useCurrentUser, useStore } from '../store/useStore';
import { attritionSignal, computeNcStat, statusOf, todaysReportStatus } from '../utils/kpi';
import { getRange, inRange, monthKey, monthRange, programDayKey } from '../utils/period';
import { buildReportItems, groupReports, reviewKey } from '../utils/validation';
import { fmtDurShort, fmtKm } from '../utils/format';
import {
  Coords,
  LocationPermissionDeniedError,
  MOCK_LOCATION_MESSAGE,
  MOCK_LOCATION_TITLE,
  requestCurrentCoords,
} from '../utils/location';

/** Clock in/out entry point for field roles (NC/TL/ARCO) — geofence check happens
 * against the NC's assigned team city center for now; a per-team geofence pin
 * (analogous to store pins) can be added once team home-base data exists. */
function ClockCard() {
  const me = useCurrentUser()!;
  const attendances = useStore((s) => s.attendances);
  const clockIn = useStore((s) => s.clockIn);
  const [busy, setBusy] = useState(false);
  const active = attendances.find((a) => a.userId === me.id && !a.clockOutAt);

  if (active) {
    return (
      <Card>
        <H>Sesi Absensi Aktif</H>
        <Muted style={{ marginTop: 4 }}>
          Clock-in sejak {new Date(active.clockInAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.
          Buka tab Absensi untuk clock-out.
        </Muted>
      </Card>
    );
  }

  const doClockIn = async () => {
    setBusy(true);
    try {
      let pos: Coords;
      try {
        pos = await requestCurrentCoords();
      } catch (e) {
        if (e instanceof LocationPermissionDeniedError) {
          showDialog('Izin lokasi diperlukan', 'Aktifkan izin lokasi untuk clock-in.');
        } else {
          showDialog('Gagal Clock In', 'Tidak dapat mengambil lokasi. Coba lagi.');
        }
        return;
      }
      if (pos.mocked) {
        showDialog(MOCK_LOCATION_TITLE, MOCK_LOCATION_MESSAGE);
        return;
      }
      // Outside the team's home-base radius is allowed but flagged (geo_fence_ok,
      // computed by the server — migration 0014).
      const queued = await clockIn(pos);
      if (!queued) showToast('Clock in berhasil');
    } catch (e) {
      // Connectivity problems never land here (they go to the offline queue) —
      // this is the server rejecting the clock-in.
      showDialog('Gagal Clock In', e instanceof Error ? e.message : 'Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <H>Mulai Hari Kerja</H>
      <Muted style={{ marginTop: 4 }}>Clock-in untuk mulai merekam rute dan mengaktifkan check-in toko.</Muted>
      <View style={{ marginTop: 10 }}>
        <Btn title="CLOCK IN" onPress={doClockIn} disabled={busy} loading={busy} />
      </View>
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

  const stats = useMemo(() => {
    const ncs = scopeUsers({ users, teams }, me).filter((u) => u.role === 'nc');
    const ncIds = new Set(ncs.map((u) => u.id));
    const today = programDayKey(Date.now());
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
      offtakeMonth,
      target,
    };
  }, [me, users, teams, attendances, visits, stockTakingRows, offtakeRows, shareOfShelfRows, paidVisibilityRows, priceMonitoringRows, ntgGwps, reportReviews, targets]);

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
          title="Offtake Bulan Ini"
          value={String(stats.offtakeMonth)}
          sub={stats.target ? `target ${stats.target} (${Math.round((100 * stats.offtakeMonth) / stats.target)}%)` : 'target belum diset'}
        />
      </View>
    </Card>
  );
}

/** Phase 2 (PRD §16) — same-day glance at the 3 core daily modules for an NC. */
function TodaysReportCard() {
  const me = useCurrentUser()!;
  const navigation = useNavigation();
  const visits = useStore((s) => s.visits);
  const stockTakingRows = useStore((s) => s.stockTakingRows);
  const offtakeRows = useStore((s) => s.offtakeRows);
  const ntgGwps = useStore((s) => s.ntgGwps);
  const status = todaysReportStatus(me.id, visits, stockTakingRows, offtakeRows, ntgGwps);
  const visit = status.activeVisitId ? visits.find((v) => v.id === status.activeVisitId) : undefined;

  const rows: Array<{ label: string; done: boolean }> = [
    { label: 'Stock Taking', done: status.stockTaking },
    { label: 'Offtake', done: status.offtake },
    { label: 'NTG & GWP', done: status.ntgGwp },
  ];

  return (
    <Card>
      <SectionHeader title="Laporan Hari Ini" subtitle="Stock Taking, Offtake, NTG & GWP (harian — PRD §5)" />
      <View style={{ gap: 8, marginTop: 10 }}>
        {rows.map((r) => (
          <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons
              name={r.done ? 'checkmark-circle' : 'ellipse-outline'}
              size={18}
              color={r.done ? C.ok : C.faint}
            />
            <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.text }}>{r.label}</Text>
          </View>
        ))}
      </View>
      {visit ? (
        <View style={{ marginTop: 10 }}>
          <Btn
            small
            variant="outline"
            title="Buka Kunjungan Aktif"
            onPress={() => navigation.navigate('StoreVisit', { visitId: visit.id })}
          />
        </View>
      ) : (
        <Muted style={{ marginTop: 8 }}>Check-in ke toko untuk mulai mengisi laporan.</Muted>
      )}
    </Card>
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

  return (
    <ScrollView
      tabIndex={0}
      role="main"
      refreshControl={refreshControl}
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}
    >
      <SectionHeader title={`Halo, ${me.name}`} subtitle={ROLE_LABEL[me.role]} />

      {(me.role === 'nc' || me.role === 'tl' || me.role === 'arco') && <ClockCard />}
      {me.role === 'nc' && <NcStatsCard />}
      {me.role === 'nc' && <TodaysReportCard />}

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
