import React, { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Badge, Btn, Card, Empty, GeoValidBadge, H, ListRow, Muted } from '../components/ui';
import { showDialog, showToast } from '../components/dialog';
import { C, T } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDate, fmtDurClock, fmtDurShort, fmtKm, fmtTime } from '../utils/format';
import { polylineKm } from '../utils/geo';
import { getCurrentCoords } from '../utils/location';

/** Mirror ringkas dari sesi aktif — tab ini bisa clock-out tanpa harus balik ke Dashboard. */
function LiveSessionCard({ me }: { me: ReturnType<typeof useCurrentUser> }) {
  const attendances = useStore((s) => s.attendances);
  const clockOutStore = useStore((s) => s.clockOut);
  const finishVisit = useStore((s) => s.finishVisit);
  const visits = useStore((s) => s.visits);
  const stores = useStore((s) => s.stores);
  const active = attendances.find((a) => a.userId === me!.id && !a.clockOutAt);
  const openVisit = visits.find((v) => v.ncId === me!.id && !v.checkOutAt);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active && active.id]);

  if (!active) return null;

  /** A store visit left open at clock-out would stay open (and block the next
   * check-in) until the server's auto-close — close it first, at the same moment. */
  const requestClockOut = () => {
    if (!openVisit) return void doClockOut();
    const storeName = stores.find((s) => s.id === openVisit.storeId)?.name ?? 'toko';
    showDialog('Masih Check-in di Toko', `Anda belum check-out dari ${storeName}. Check-out toko sekaligus clock-out sekarang?`, [
      { label: 'Batal' },
      { label: 'Check-out & Clock Out', onPress: () => void doClockOut(openVisit.id) },
    ]);
  };

  const doClockOut = async (visitToClose?: string) => {
    setBusy(true);
    try {
      if (visitToClose) await finishVisit(visitToClose);
      // Record where the user actually is at clock-out; the last route point
      // can be stale (tracking stopped/denied). Fall back to it only if no fix.
      const last = active.route[active.route.length - 1] ?? { lat: active.clockInLat, lng: active.clockInLng };
      // A mocked fix is not a real position — fall back like having no fix.
      const fix = await getCurrentCoords();
      const pos = fix && !fix.mocked ? { lat: fix.lat, lng: fix.lng } : last;
      const queued = await clockOutStore(pos);
      if (!queued) showToast('Clock out berhasil');
    } catch (e) {
      // Connectivity problems are queued offline, never thrown — this is a server rejection.
      showDialog('Gagal Clock Out', e instanceof Error ? e.message : 'Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <H>Sesi Berlangsung</H>
        <GeoValidBadge ok={active.geoFenceOk} okLabel="Dalam geo-fence" badLabel="Pengecualian" />
      </View>
      <Text style={[T.timer, { marginTop: 4 }]}>{fmtDurClock(now - active.clockInAt)}</Text>
      <Muted style={{ marginBottom: 8 }}>
        Masuk {fmtTime(active.clockInAt)} · {fmtKm(polylineKm(active.route))} · {active.route.length} titik rute
      </Muted>
      <Btn title="CLOCK OUT" variant="danger" onPress={requestClockOut} disabled={busy} loading={busy} />
    </Card>
  );
}

/** Riwayat absensi milik NC/TL/ARCO yang login. */
export default function AttendanceScreen() {
  const me = useCurrentUser();
  const attendances = useStore((s) => s.attendances);

  const mine = attendances
    .filter((a) => a.userId === me!.id)
    .sort((a, b) => b.clockInAt - a.clockInAt);

  return (
    <View role="main" style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
        <LiveSessionCard me={me} />
        <H>Riwayat Absensi Saya ({mine.length})</H>
      </View>
      <FlatList
        data={mine}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Empty text="Belum ada riwayat. Mulai sesi dari tab Dashboard." />}
        renderItem={({ item: a }) => (
          <ListRow
            title={fmtDate(a.clockInAt)}
            subtitle={`${fmtTime(a.clockInAt)} → ${a.clockOutAt ? fmtTime(a.clockOutAt) : 'berlangsung...'} · ${fmtDurShort((a.clockOutAt ?? Date.now()) - a.clockInAt)} · ${fmtKm(polylineKm(a.route))}`}
            trailing={
              a.autoClosed ? (
                <Badge label="Ditutup otomatis" color={C.warn} />
              ) : (
                <GeoValidBadge ok={a.geoFenceOk} okLabel="OK" badLabel="Exception" />
              )
            }
            emphasis={a.clockOutAt ? undefined : { color: C.warn, label: 'Berlangsung' }}
          />
        )}
      />
    </View>
  );
}
