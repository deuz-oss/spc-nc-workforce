import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

export class LocationPermissionDeniedError extends Error {}

const HIGH_ACCURACY_TIMEOUT_MS = 12000;
const FALLBACK_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('location-timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * High accuracy relies on a live GPS fix, which can stall for a long time or
 * fail outright indoors/with a weak signal. Give it a bounded window, then
 * fall back to Balanced (network/Wi-Fi based) accuracy, which resolves fast
 * and reliably even without a clear sky view.
 */
async function readPosition(): Promise<Location.LocationObject> {
  try {
    return await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      HIGH_ACCURACY_TIMEOUT_MS,
    );
  } catch {
    return withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      FALLBACK_TIMEOUT_MS,
    );
  }
}

/** Minta izin lalu ambil posisi sekarang; lempar LocationPermissionDeniedError bila izin ditolak */
export async function requestCurrentCoords(): Promise<Coords> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new LocationPermissionDeniedError();
  const pos = await readPosition();
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

/** Minta izin lalu ambil posisi sekarang; null bila izin ditolak/gagal */
export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    return await requestCurrentCoords();
  } catch {
    return null;
  }
}
