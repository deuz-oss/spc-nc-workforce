import * as TaskManager from 'expo-task-manager';
import type * as Location from 'expo-location';
import { TRACK_MIN_STEP_M } from '../config';
import { recordLocations } from '../utils/routeBuffer';
import { flushRouteBuffer } from '../utils/routeSync';

/**
 * Registered once at module load (imported from index.ts, before the app
 * mounts) so the native side can wake this callback even while the app is
 * backgrounded — or killed: Android then runs it in a headless JS context
 * where the zustand store was never hydrated. So this path never touches the
 * store: whose session to record comes from the persisted tracking context
 * (TrackingWatcher writes it), points go to the on-device buffer, and the
 * upload uses only the persisted Supabase session.
 */
export const LOCATION_TASK_NAME = 'spc-nc-background-location';

/** Shared by the native background task and the web foreground watcher. */
export async function handleLocations(
  locations: Pick<Location.LocationObject, 'coords' | 'timestamp' | 'mocked'>[],
): Promise<void> {
  // Positions from a mock-location app are not where the phone is — never record them.
  const real = locations.filter((l) => !l.mocked);
  const userId = await recordLocations(
    real.map((l) => ({ lat: l.coords.latitude, lng: l.coords.longitude, t: Math.round(l.timestamp) })),
    TRACK_MIN_STEP_M,
  );
  if (userId) await flushRouteBuffer(userId);
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations?.length) return;
  try {
    await handleLocations(locations);
  } catch (e) {
    console.warn('location task failed:', e instanceof Error ? e.message : e);
  }
});
