import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Badge, Empty, H, ListRow, Muted } from './ui';
import { LeafletMap, MapMarker } from './LeafletMap';
import { C } from '../theme';
import { useStore } from '../store/useStore';
import { LivePosition, Store, User, Visit } from '../types';
import { agoLabel, liveState, LiveState, STALE_AFTER_MIN } from '../utils/live';

/** Poll interval while the map is on screen. Positions change every ~15-30 s,
 * but a TL glancing at the team doesn't need a tighter loop than this. */
const POLL_MS = 60 * 1000;

const STATE_META: Record<LiveState, { label: string; color: string }> = {
  in_store: { label: 'Di toko', color: C.ok },
  on_the_road: { label: 'Di perjalanan', color: C.info },
  stale: { label: 'Tidak ada update', color: C.muted },
};

/**
 * Live map of a TL's / ARCO's team (PRD §8): every clocked-in NC at their last
 * known GPS position (live_positions() RPC, 0012 — RLS-scoped to the viewer),
 * coloured by whether they're checked in to a store, on the road, or have gone
 * quiet. Before this, the map only showed store check-ins, so an NC who had
 * clocked in and was travelling was invisible to their TL even though their
 * background route was being recorded. Tapping an NC opens NC Tracker with
 * today's route.
 */
export function LiveTeamMap({ ncUsers, visits, stores }: { ncUsers: User[]; visits: Visit[]; stores: Store[] }) {
  const navigation = useNavigation<any>();
  const fetchLivePositions = useStore((s) => s.fetchLivePositions);
  const [positions, setPositions] = useState<LivePosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setPositions(await fetchLivePositions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNow(Date.now());
    }
  }, [fetchLivePositions]);

  // Load on focus and poll while focused; stop when the screen is left.
  useFocusEffect(
    useCallback(() => {
      void load();
      const t = setInterval(load, POLL_MS);
      return () => clearInterval(t);
    }, [load]),
  );
  // Visits change via realtime / refreshData — re-evaluate "in store" labels.
  useEffect(() => setNow(Date.now()), [visits]);

  const ncById = new Map(ncUsers.map((u) => [u.id, u]));
  const rows = (positions ?? [])
    .filter((p) => ncById.has(p.userId))
    .map((p) => {
      const visit = visits.find((v) => v.ncId === p.userId && !v.checkOutAt);
      const store = visit ? stores.find((s) => s.id === visit.storeId) : undefined;
      return { p, nc: ncById.get(p.userId)!, store, state: liveState(p.at, !!visit, now) };
    })
    .sort((a, b) => a.nc.name.localeCompare(b.nc.name));

  const markers: MapMarker[] = rows.map(({ p, nc, store, state }) => ({
    lat: p.lat,
    lng: p.lng,
    label: `${nc.name} · ${store ? store.name : STATE_META[state].label} · ${agoLabel(p.at, now)}`,
    color: STATE_META[state].color,
  }));

  const notClockedIn = ncUsers.length - rows.length;

  return (
    <View style={{ gap: 8 }}>
      <H>Peta Live Tim</H>
      {error ? (
        <Muted style={{ color: C.accent }}>
          Gagal memuat posisi tim{/function .*live_positions/i.test(error) ? ' — migrasi 0012 belum dijalankan.' : '.'}
        </Muted>
      ) : positions == null ? (
        <Muted>Memuat posisi tim…</Muted>
      ) : rows.length === 0 ? (
        <Empty text="Belum ada anggota tim yang clock-in saat ini." />
      ) : (
        <>
          <Muted>
            {rows.length} NC sedang bekerja{notClockedIn > 0 ? ` · ${notClockedIn} belum clock-in` : ''}. Diperbarui tiap
            menit.
          </Muted>
          <LeafletMap markers={markers} height={260} />
          <View style={{ gap: 6 }}>
            {rows.map(({ p, nc, store, state }) => (
              <ListRow
                key={p.attendanceId}
                title={nc.name}
                subtitle={store ? `Check-in di ${store.name}` : `Posisi terakhir ${agoLabel(p.at, now)}`}
                meta={store ? `Update ${agoLabel(p.at, now)}` : 'Lihat rute hari ini'}
                trailing={<Badge label={STATE_META[state].label} color={STATE_META[state].color} />}
                onPress={() => navigation.navigate('NcTracker', { ncId: nc.id, attendanceId: p.attendanceId })}
              />
            ))}
          </View>
          {rows.some((r) => r.state === 'stale') && (
            <Muted>
              "Tidak ada update" = tidak ada titik GPS &gt;{STALE_AFTER_MIN} menit (HP mati, GPS nonaktif, atau app ditutup
              paksa).
            </Muted>
          )}
        </>
      )}
    </View>
  );
}
