import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Last-known snapshot of the signed-in user's working data, so a cold start
 * without connectivity can still open the app (clock state, assigned stores,
 * product picklist, today's visits) instead of signing the user out. Written
 * by useStore whenever the cached slices change; read only by init() when the
 * server can't be reached. Deliberately small: reference data plus the user's
 * OWN recent field activity — never the program-wide monitor-role view.
 */
export interface OfflineSnapshot {
  savedAt: number;
  /** Earliest field-activity timestamp the snapshot covers (open sessions excepted). */
  historyFrom: number;
  /** State slices keyed by their useStore field name. */
  data: Record<string, unknown[]>;
}

const snapshotKey = (userId: string) => `spc_nc_snapshot_v1:${userId}`;

/** The user whose session is persisted — read when the session itself can't be
 * loaded offline (an expired access token that can't be refreshed without network). */
const LAST_USER_KEY = 'spc_nc_last_user_v1';

export async function saveSnapshot(userId: string, snapshot: OfflineSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(snapshotKey(userId), JSON.stringify(snapshot));
  } catch {
    /* best-effort — e.g. storage quota; the app just can't open offline next time */
  }
}

export async function loadSnapshot(userId: string): Promise<OfflineSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(snapshotKey(userId));
    return raw ? (JSON.parse(raw) as OfflineSnapshot) : null;
  } catch {
    return null;
  }
}

export async function deleteSnapshot(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(snapshotKey(userId));
  } catch {
    /* best-effort */
  }
}

export async function setLastUser(userId: string | null): Promise<void> {
  try {
    if (userId) await AsyncStorage.setItem(LAST_USER_KEY, userId);
    else await AsyncStorage.removeItem(LAST_USER_KEY);
  } catch {
    /* best-effort */
  }
}

export async function getLastUser(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}
