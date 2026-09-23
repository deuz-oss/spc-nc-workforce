import { useEffect } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import { TRACK_INTERVAL_MS } from '../config';
import { useCurrentUser, useStore } from '../store/useStore';
import { LOCATION_TASK_NAME } from '../tasks/locationTask';

/**
 * Dipasang sekali di root: start/stop perekaman GPS selama ada sesi absensi
 * aktif, tidak peduli layar mana yang sedang dibuka.
 *
 * Native (Android/iOS): pakai task background (src/tasks/locationTask.ts)
 * lewat startLocationUpdatesAsync, jadi tetap merekam walau app di-background.
 * Android jalur ini sudah teruji di device fisik pada foundation
 * (spc-field-force); iOS background location masih BELUM divalidasi di
 * device fisik untuk repo ini — lihat README "Status & Gaps".
 * Web: expo-location tidak mengekspos startLocationUpdatesAsync di platform
 * web sama sekali (akan throw kalau dipanggil) — jadi web tetap pakai
 * watchPositionAsync foreground-only.
 */
export function TrackingWatcher() {
  const me = useCurrentUser();
  const activeId = useStore((s) => {
    if (!me || me.role === 'reckitt_client' || me.role === 'super_admin') return null;
    return s.attendances.find((a) => a.userId === me.id && !a.clockOutAt)?.id ?? null;
  });
  const addRoutePoint = useStore((s) => s.addRoutePoint);

  useEffect(() => {
    if (!me || !activeId) {
      if (Platform.OS !== 'web') {
        Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).then((started) => {
          if (started) Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
        });
      }
      return;
    }

    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted' || cancelled) return;

      if (Platform.OS === 'web') {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: TRACK_INTERVAL_MS, distanceInterval: 10 },
          (pos) => addRoutePoint(me.id, { lat: pos.coords.latitude, lng: pos.coords.longitude }),
        );
        return;
      }

      await Location.requestBackgroundPermissionsAsync();
      if (cancelled) return;
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        // Android 13+ requires this separately, or the foreground-service
        // notification below silently never shows even though tracking works.
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      if (cancelled) return;
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: TRACK_INTERVAL_MS,
        distanceInterval: 10,
        foregroundService: {
          notificationTitle: 'SPC NC Workforce',
          notificationBody: 'Merekam rute perjalanan selama sesi absensi aktif.',
        },
      });
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [me && me.id, activeId]);

  return null;
}
