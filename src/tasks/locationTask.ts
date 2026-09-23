import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { useStore } from '../store/useStore';

/**
 * Registered once at module load (imported from index.ts, before the app
 * mounts) so the native side can wake this callback even while the app is
 * backgrounded — TrackingWatcher only starts/stops it, the actual point
 * recording happens here via useStore.getState() (works outside React).
 */
export const LOCATION_TASK_NAME = 'spc-nc-background-location';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const last = locations[locations.length - 1];
  const userId = useStore.getState().sessionUserId;
  if (!last || !userId) return;
  useStore.getState().addRoutePoint(userId, { lat: last.coords.latitude, lng: last.coords.longitude });
});
