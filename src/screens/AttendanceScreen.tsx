import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { Badge, Btn, Card, Empty, GeoValidBadge, H, ListRow, Muted } from '../components/ui';
import { useClockActions } from '../components/fieldActions';
import { useNow } from '../components/useNow';
import { C, T } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { fmtDate, fmtDurClock, fmtDurShort, fmtKm, fmtTime } from '../utils/format';
import { polylineKm } from '../utils/geo';

/** The running session, with clock-out right here (shared with the Dashboard). */
function LiveSessionCard() {
  const { active, clockOut, busy } = useClockActions();
  const now = useNow(1000);
  if (!active) return null;

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <H>Sesi berlangsung</H>
        <GeoValidBadge ok={active.geoFenceOk} okLabel="Dalam area tim" badLabel="Di luar area tim" />
      </View>
      <Text style={[T.timer, { marginTop: 4 }]}>{fmtDurClock(now - active.clockInAt)}</Text>
      <Muted style={{ marginBottom: 8 }}>
        Masuk {fmtTime(active.clockInAt)} · {fmtKm(polylineKm(active.route))} tercatat
      </Muted>
      <Btn
        title={busy === 'out' ? 'Menyimpan…' : 'CLOCK OUT'}
        variant="danger"
        onPress={clockOut}
        disabled={busy != null}
        loading={busy === 'out'}
      />
    </Card>
  );
}

/** Riwayat absensi milik NC/TL/ARCO yang login. */
export default function AttendanceScreen() {
  const me = useCurrentUser();
  const attendances = useStore((s) => s.attendances);
  const now = useNow();

  const mine = attendances
    .filter((a) => a.userId === me!.id)
    .sort((a, b) => b.clockInAt - a.clockInAt);

  return (
    <View role="main" style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
        <LiveSessionCard />
        <H>Riwayat Absensi Saya ({mine.length})</H>
      </View>
      <FlatList
        data={mine}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Empty text="Belum ada riwayat. Clock in dari Dashboard untuk memulai." />}
        renderItem={({ item: a }) => (
          <ListRow
            title={fmtDate(a.clockInAt)}
            subtitle={`${fmtTime(a.clockInAt)} → ${a.clockOutAt ? fmtTime(a.clockOutAt) : 'berlangsung'} · ${fmtDurShort((a.clockOutAt ?? now) - a.clockInAt)} · ${fmtKm(polylineKm(a.route))}`}
            trailing={
              a.autoClosed ? (
                <Badge label="Ditutup otomatis" color={C.warn} />
              ) : (
                <GeoValidBadge ok={a.geoFenceOk} okLabel="Dalam area" badLabel="Di luar area" />
              )
            }
            emphasis={a.clockOutAt ? undefined : { color: C.warn, label: 'Berlangsung' }}
          />
        )}
      />
    </View>
  );
}
