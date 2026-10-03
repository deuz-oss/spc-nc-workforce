import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAppRoute } from '../navigation';
import { Btn, Card, Chip, Empty, ErrorState, ListRow, Muted, SectionHeader, SkeletonBlock, StatCard } from '../components/ui';
import { HistoryNotice } from '../components/HistoryNotice';
import { useNow } from '../components/useNow';
import { LeafletMap, MapMarker } from '../components/LeafletMap';
import { STOP_FLAG_DURATION_MS } from '../config';
import { C } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { Attendance, RoutePoint } from '../types';
import { fmtDate, fmtDateTime, fmtDurShort, fmtKm, fmtTime } from '../utils/format';
import { detectStops, polylineKm } from '../utils/geo';
import { openReportPhoto } from '../utils/storage';

/**
 * One attendance session's GPS route for a supervisor (TL/ARCO/PM). The store
 * only mirrors the viewer's OWN route points, so another NC's route is fetched
 * on demand (RLS-scoped) when a session is selected.
 */
function RouteCard({ ncId, initialAttendanceId }: { ncId: string; initialAttendanceId?: string }) {
  const attendances = useStore((s) => s.attendances);
  const visits = useStore((s) => s.visits);
  const stores = useStore((s) => s.stores);
  const fetchRoute = useStore((s) => s.fetchRoute);

  const sessions = useMemo(
    () => attendances.filter((a) => a.userId === ncId).sort((a, b) => b.clockInAt - a.clockInAt).slice(0, 7),
    [attendances, ncId],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(initialAttendanceId);
  const session: Attendance | undefined = sessions.find((a) => a.id === selectedId) ?? sessions[0];

  // The fetched route is tagged with its session and attempt: switching
  // session or retrying shows "loading" again without resetting state in the effect.
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; route: RoutePoint[] | null; error: string | null } | null>(null);
  const sessionId = session?.id;
  const key = `${sessionId}:${attempt}`;
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetchRoute(sessionId)
      .then((r) => !cancelled && setResult({ key, route: r, error: null }))
      .catch((e) => !cancelled && setResult({ key, route: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [sessionId, key, fetchRoute]);
  const current = result?.key === key ? result : null;
  const route = current?.route ?? null;
  const error = current?.error ?? null;
  const now = useNow();

  if (!sessions.length) {
    return (
      <Card>
        <SectionHeader level="card" title="Rute" />
        <Empty icon="map-outline" text="Belum ada sesi absensi dalam periode yang dimuat." />
      </Card>
    );
  }

  const end = session?.clockOutAt ?? now;
  const sessionVisits = session
    ? visits.filter((v) => v.ncId === ncId && v.checkInAt >= session.clockInAt && v.checkInAt <= end)
    : [];
  const pts: RoutePoint[] =
    route && route.length ? route : session ? [{ lat: session.clockInLat, lng: session.clockInLng, t: session.clockInAt }] : [];
  const longStops = detectStops(pts).filter((s) => s.durationMs >= STOP_FLAG_DURATION_MS);

  const markers: MapMarker[] = [
    ...(pts.length ? [{ lat: pts[0].lat, lng: pts[0].lng, label: `Clock-in ${fmtTime(pts[0].t)}`, color: C.info }] : []),
    ...sessionVisits.map((v) => ({
      lat: v.lat,
      lng: v.lng,
      label: `${stores.find((s) => s.id === v.storeId)?.name ?? 'Toko'} · ${fmtTime(v.checkInAt)}`,
      color: v.geoValid ? C.ok : C.warn,
    })),
    ...longStops.map((s) => ({ lat: s.lat, lng: s.lng, label: `Berhenti ${fmtDurShort(s.durationMs)} (${fmtTime(s.startT)})`, color: C.accent })),
    ...(pts.length > 1
      ? [{ lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng, label: `Posisi terakhir ${fmtTime(pts[pts.length - 1].t)}`, color: C.primaryDark }]
      : []),
  ];

  return (
    <Card style={{ gap: 10 }}>
      <SectionHeader level="card" title="Rute" subtitle="Jalur GPS selama sesi absensi" />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {sessions.map((a) => (
          <Chip
            key={a.id}
            label={`${fmtDate(a.clockInAt)}${a.clockOutAt ? '' : ' · aktif'}`}
            active={session?.id === a.id}
            onPress={() => setSelectedId(a.id)}
          />
        ))}
      </View>
      {error ? (
        <ErrorState text="Rute belum bisa dimuat. Periksa koneksi internet." onRetry={() => setAttempt((n) => n + 1)} />
      ) : route == null ? (
        <View role="status" aria-label="Memuat rute" style={{ gap: 8 }}>
          <SkeletonBlock height={64} />
          <SkeletonBlock height={220} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <StatCard title="Jam" value={`${fmtTime(session!.clockInAt)} – ${session!.clockOutAt ? fmtTime(session!.clockOutAt) : 'sekarang'}`} />
            <StatCard title="Jarak" value={fmtKm(polylineKm(pts))} sub={`${route.length} titik GPS`} />
            <StatCard title="Kunjungan" value={String(sessionVisits.length)} sub={`${longStops.length} berhenti >${STOP_FLAG_DURATION_MS / 60000} mnt`} />
          </View>
          {route.length === 0 && <Muted>Belum ada titik GPS setelah clock-in (tracking belum berjalan di HP ini).</Muted>}
          <LeafletMap polyline={pts} markers={markers} height={300} />
          <Muted>Biru: clock-in · hijau/kuning: check-in toko (valid/di luar radius) · merah: berhenti lama di luar toko.</Muted>
        </>
      )}
    </Card>
  );
}

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
  const route = useAppRoute<'NcTracker'>();
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
        <StatCard title="Total facing" value={String(totalFacing)} />
        <StatCard title="Porsi rak (SOS)" value={sosPct != null ? `${sosPct}%` : '-'} />
      </View>

      {/* GPS trails aren't shared with the client role (route_points RLS, 0015). */}
      {!hidePii && <RouteCard ncId={ncId} initialAttendanceId={route.params?.attendanceId} />}

      <Card>
        <SectionHeader level="card" title="Share of Shelf" subtitle="Facing counts + foto bukti" />
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
        <SectionHeader level="card" title="Log Kunjungan" />
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
                  meta={v.geoValid ? 'Lokasi sesuai' : 'Di luar radius toko'}
                />
              );
            })}
          </View>
        )}
      </Card>

      {hidePii && (
        <Muted>
          Layar ini tidak menampilkan data pribadi konsumen maupun rute GPS NC — hanya data kunjungan dan facing count.
        </Muted>
      )}
    </ScrollView>
  );
}
