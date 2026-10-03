import { useState } from 'react';
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { showDialog, showToast } from './dialog';
import { VISIT_VALID_RADIUS_M } from '../config';
import { useCurrentUser, useStore } from '../store/useStore';
import { Store } from '../types';
import { haversineM } from '../utils/geo';
import {
  Coords,
  getCurrentCoords,
  LocationPermissionDeniedError,
  MOCK_LOCATION_MESSAGE,
  MOCK_LOCATION_TITLE,
  requestCurrentCoords,
} from '../utils/location';

/**
 * The field-day actions (clock in/out, store check-in) shared by Dashboard,
 * Absensi, Toko and Detail Toko. The rules are the same everywhere — one store
 * at a time, geofence radius, no mocked GPS, close an open visit before
 * clock-out — only the feedback around them lives here (what is happening,
 * and what to do when it fails).
 */

const openInMaps = (lat: number, lng: number) =>
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`).catch(() => undefined);

export function useCheckIn() {
  const navigation = useNavigation();
  const me = useCurrentUser()!;
  const stores = useStore((s) => s.stores);
  const visits = useStore((s) => s.visits);
  const attendances = useStore((s) => s.attendances);
  const startVisit = useStore((s) => s.startVisit);
  /** The store being checked into while its GPS fix is taken. */
  const [checkingStoreId, setCheckingStoreId] = useState<string | null>(null);

  const checkIn = async (store: Store): Promise<void> => {
    const openHere = visits.find((v) => v.storeId === store.id && v.ncId === me.id && !v.checkOutAt);
    if (openHere) {
      navigation.navigate('StoreVisit', { visitId: openHere.id });
      return;
    }
    if (!attendances.some((a) => a.userId === me.id && !a.clockOutAt)) {
      showDialog('Belum Clock In', 'Clock in dulu di Dashboard, baru check-in ke toko.', [
        { label: 'Tutup' },
        { label: 'Ke Dashboard', onPress: () => navigation.navigate('Main', { screen: 'Dashboard' }) },
      ]);
      return;
    }
    // One store at a time — reports and CFT are attributed per visit.
    const openElsewhere = visits.find((v) => v.ncId === me.id && !v.checkOutAt && v.storeId !== store.id);
    if (openElsewhere) {
      const other = stores.find((s) => s.id === openElsewhere.storeId);
      showDialog(
        'Masih di Toko Lain',
        `Check-out dulu dari ${other?.name ?? 'toko sebelumnya'} sebelum check-in ke toko ini.`,
        [
          { label: 'Tutup' },
          { label: 'Buka Kunjungan', onPress: () => navigation.navigate('StoreVisit', { visitId: openElsewhere.id }) },
        ],
      );
      return;
    }

    setCheckingStoreId(store.id);
    let pos: Coords;
    try {
      pos = await requestCurrentCoords();
    } catch (e) {
      setCheckingStoreId(null);
      const denied = e instanceof LocationPermissionDeniedError;
      showDialog(
        denied ? 'Izin Lokasi Diperlukan' : 'Lokasi Tidak Didapat',
        denied
          ? 'Izinkan akses lokasi untuk aplikasi ini di Pengaturan HP, lalu coba lagi.'
          : 'GPS belum mendapat posisi. Pastikan GPS aktif, berdiri dekat pintu atau jendela, lalu coba lagi.',
        [{ label: 'Tutup' }, { label: 'Coba Lagi', onPress: () => void checkIn(store) }],
      );
      return;
    }
    if (pos.mocked) {
      setCheckingStoreId(null);
      showDialog(MOCK_LOCATION_TITLE, MOCK_LOCATION_MESSAGE);
      return;
    }
    let dist: number | null = null;
    if (store.lat != null && store.lng != null) {
      dist = Math.round(haversineM({ lat: store.lat, lng: store.lng }, pos));
      if (dist > VISIT_VALID_RADIUS_M) {
        setCheckingStoreId(null);
        const { lat, lng } = store;
        showDialog(
          'Terlalu Jauh dari Toko',
          `Anda ${dist} m dari titik toko (batas ${VISIT_VALID_RADIUS_M} m). Dekati toko lalu coba lagi. Bila Anda sudah di dalam toko, minta TL memperbaiki titik GPS toko.`,
          [
            { label: 'Tutup' },
            { label: 'Buka di Maps', onPress: () => openInMaps(lat, lng) },
            { label: 'Coba Lagi', onPress: () => void checkIn(store) },
          ],
        );
        return;
      }
    }
    try {
      // A store without a GPS pin can't be geofence-verified — record the
      // visit, but never as geo-valid (it would otherwise count toward the
      // PRD §7 valid-visit KPI with zero location evidence).
      const id = await startVisit(store.id, me.id, pos, dist, dist != null);
      navigation.navigate('StoreVisit', { visitId: id });
    } catch (e) {
      // Connectivity problems are queued offline, never thrown — this is a server rejection.
      showDialog('Check-in Gagal', e instanceof Error ? e.message : 'Coba lagi.');
    } finally {
      setCheckingStoreId(null);
    }
  };

  return { checkIn, checkingStoreId };
}

export function useClockActions() {
  const me = useCurrentUser()!;
  const attendances = useStore((s) => s.attendances);
  const visits = useStore((s) => s.visits);
  const stores = useStore((s) => s.stores);
  const clockInStore = useStore((s) => s.clockIn);
  const clockOutStore = useStore((s) => s.clockOut);
  const finishVisit = useStore((s) => s.finishVisit);
  const active = attendances.find((a) => a.userId === me.id && !a.clockOutAt);
  const openVisit = visits.find((v) => v.ncId === me.id && !v.checkOutAt);
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);

  const clockIn = async () => {
    setBusy('in');
    try {
      let pos: Coords;
      try {
        pos = await requestCurrentCoords();
      } catch (e) {
        const denied = e instanceof LocationPermissionDeniedError;
        showDialog(
          denied ? 'Izin Lokasi Diperlukan' : 'Lokasi Tidak Didapat',
          denied
            ? 'Izinkan akses lokasi untuk aplikasi ini di Pengaturan HP, lalu coba lagi.'
            : 'GPS belum mendapat posisi. Pastikan GPS aktif, lalu coba lagi.',
          [{ label: 'Tutup' }, { label: 'Coba Lagi', onPress: () => void clockIn() }],
        );
        return;
      }
      if (pos.mocked) {
        showDialog(MOCK_LOCATION_TITLE, MOCK_LOCATION_MESSAGE);
        return;
      }
      // Outside the team's home-base radius is allowed but flagged (geo_fence_ok,
      // computed by the server — migration 0014).
      const queued = await clockInStore(pos);
      if (!queued) showToast('Clock in berhasil');
    } catch (e) {
      // Connectivity problems never land here (they go to the offline queue) —
      // this is the server rejecting the clock-in.
      showDialog('Clock In Gagal', e instanceof Error ? e.message : 'Coba lagi.');
    } finally {
      setBusy(null);
    }
  };

  const doClockOut = async (visitToClose?: string) => {
    // Read the session now, not from this render — a confirm can outlive it.
    const active = useStore.getState().attendances.find((a) => a.userId === me.id && !a.clockOutAt);
    if (!active) return;
    setBusy('out');
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
      showDialog('Clock Out Gagal', e instanceof Error ? e.message : 'Coba lagi.');
    } finally {
      setBusy(null);
    }
  };

  /** A store visit left open at clock-out would stay open (and block the next
   * check-in) until the server's auto-close — close it first, at the same moment. */
  const clockOut = () => {
    if (!openVisit) {
      showDialog('Akhiri Hari Kerja?', 'Clock out menghentikan perekaman rute untuk hari ini.', [
        { label: 'Batal' },
        { label: 'Clock Out', destructive: true, onPress: () => void doClockOut() },
      ]);
      return;
    }
    const storeName = stores.find((s) => s.id === openVisit.storeId)?.name ?? 'toko';
    showDialog('Masih Check-in di Toko', `Anda belum check-out dari ${storeName}. Check-out sekaligus clock out sekarang?`, [
      { label: 'Batal' },
      { label: 'Check-out & Clock Out', destructive: true, onPress: () => void doClockOut(openVisit.id) },
    ]);
  };

  return { active, openVisit, clockIn, clockOut, busy };
}
