import { useNetInfo } from '@react-native-community/netinfo';
import { useStore } from '../store/useStore';

/**
 * Whether the app can reach the server right now, for UI that should say so
 * up front (online-only actions, the status strip) instead of failing on tap.
 * Unknown (null) while NetInfo is still probing counts as online, so nothing
 * flashes "offline" at startup; running from the offline snapshot counts as offline.
 */
export function useOnline(): boolean {
  const net = useNetInfo();
  const snapshotAt = useStore((s) => s.offlineSnapshotAt);
  return net.isConnected !== false && net.isInternetReachable !== false && snapshotAt == null;
}
