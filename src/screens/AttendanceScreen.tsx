import React, { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Btn, Card, Empty, GeoValidBadge, H, ListRow, Muted } from '../components/ui';
import { showDialog } from '../components/dialog';
import { C, T } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDate, fmtDurClock, fmtDurShort, fmtKm, fmtTime } from '../utils/format';
import { polylineKm } from '../utils/geo';

/** Mirror ringkas dari sesi aktif — tab ini bisa clock-out tanpa harus balik ke Dashboard. */
function LiveSessionCard({ me }: { me: ReturnType<typeof useCurrentUser> }) {
  const attendances = useStore((s) => s.attendances);
  const clockOutStore = useStore((s) => s.clockOut);
  const active = attendances.find((a) => a.userId === me!.id && !a.clockOutAt);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active && active.id]);

  if (!active) return null;

  const doClockOut = async () => {
    setBusy(true);
    try {
      const last = active.route[active.route.length - 1] ?? { lat: active.clockInLat, lng: active.clockInLng };
      const queued = await clockOutStore(last);
      if (!queued) showDialog('Clock Out berhasil');
    } catch {
      showDialog('Gagal Clock Out', 'Tidak dapat menyimpan clock-out ke server. Periksa koneksi internet dan coba lagi.');
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
      <Btn title="CLOCK OUT" variant="danger" onPress={doClockOut} disabled={busy} />
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
            trailing={<GeoValidBadge ok={a.geoFenceOk} okLabel="OK" badLabel="Exception" />}
            emphasis={a.clockOutAt ? undefined : { color: C.warn, label: 'Berlangsung' }}
          />
        )}
      />
    </View>
  );
}
