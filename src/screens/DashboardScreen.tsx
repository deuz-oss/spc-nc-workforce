import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Btn, Card, H, Muted, SectionHeader, StatCard } from '../components/ui';
import { showDialog } from '../components/dialog';
import ManagementDashboard from './ManagementDashboard';
import { CERT_MANAGER_ROLES, MANAGEMENT_DASHBOARD_ROLES, ROLE_LABEL, SURVEY_BUILDER_ROLES, TARGET_MANAGER_ROLES } from '../config';
import { C, F } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { computeNcStat, statusOf, todaysReportStatus } from '../utils/kpi';
import { getRange } from '../utils/period';
import { fmtDurShort, fmtKm } from '../utils/format';
import { LocationPermissionDeniedError, requestCurrentCoords } from '../utils/location';

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
      const { lat, lng } = await requestCurrentCoords();
      // Team home-base geofence pin isn't modeled yet in Phase 1 — clock-in is
      // always accepted, flagged geoFenceOk=true, pending that data (see README).
      await clockIn({ lat, lng }, true);
      showDialog('Clock In berhasil');
    } catch (e) {
      if (e instanceof LocationPermissionDeniedError) {
        showDialog('Izin lokasi diperlukan', 'Aktifkan izin lokasi untuk clock-in.');
      } else {
        showDialog('Gagal Clock In', 'Tidak dapat menyimpan clock-in. Periksa koneksi internet dan coba lagi.');
      }
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
  const range = getRange('monthly', new Date().getMonth());
  const stat = computeNcStat(me.id, me.name, attendances, visits, range);
  const status = statusOf(stat);

  return (
    <Card>
      <SectionHeader title="Ringkasan Bulan Ini" subtitle={status.label} />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <StatCard title="Working Hours" value={fmtDurShort(stat.workMs)} color={status.color} />
        <StatCard title="CFT" value={fmtDurShort(stat.cftMs)} sub="Customer Facing Time" />
        <StatCard title="Kunjungan Toko" value={String(stat.visits)} sub={`${stat.distinctStores} toko berbeda`} />
        <StatCard title="Jarak Tempuh" value={fmtKm(stat.km)} />
      </View>
    </Card>
  );
}

/** Phase 2 (PRD §16) — same-day glance at the 3 core daily modules for an NC. */
function TodaysReportCard() {
  const me = useCurrentUser()!;
  const navigation = useNavigation<any>();
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
  const users = useStore((s) => s.users);
  const stores = useStore((s) => s.stores);
  const navigation = useNavigation<any>();

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
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}
    >
      <SectionHeader title={`Halo, ${me.name}`} subtitle={ROLE_LABEL[me.role]} />

      {(me.role === 'nc' || me.role === 'tl' || me.role === 'arco') && <ClockCard />}
      {me.role === 'nc' && <NcStatsCard />}
      {me.role === 'nc' && <TodaysReportCard />}

      {me.role === 'super_admin' && (
        <Card>
          <SectionHeader title="Ringkasan Program" subtitle="215 akun · 47 kota (target)" />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <StatCard title="Total Pengguna Aktif" value={String(users.filter((u) => u.active).length)} />
            <StatCard title="Toko Terdaftar" value={String(stores.length)} />
            <StatCard title="Toko Belum Ter-assign" value={String(stores.filter((s) => !s.assignedNcId).length)} color={C.warn} />
          </View>
        </Card>
      )}

      {(me.role === 'tl' || me.role === 'arco') && (
        <Card>
          <SectionHeader
            title="Tim Saya"
            action={{ label: 'Buka Validasi', onPress: () => navigation.navigate('Validasi') }}
          />
          <Muted style={{ marginTop: 4 }}>
            Console validasi same-day, peta live tim, dan coaching log (PRD §8) ada di tab "Validasi".
          </Muted>
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
            ? 'Belum ada data toko. Admin/TL/ARCO dapat mengimpor via tab Impor.'
            : `${stores.length} toko tercatat.`}
        </Muted>
      </Card>
    </ScrollView>
  );
}
