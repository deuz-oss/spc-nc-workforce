import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Form drafts kept on the phone, so entered data survives going back, an app
 * restart or Android killing the app in the background. Only UI state — what
 * the user typed — is stored; nothing here touches the offline queue. A draft
 * is removed once the form is submitted, and all of a visit's drafts at
 * check-out (the server refuses reports after that).
 *
 * Keys: `draft:<visitId>:<form>` for visit reports, `draft:<other>` otherwise.
 */
const PREFIX = 'draft:';
const SAVE_DELAY_MS = 400;

interface Stored<T> {
  savedAt: number;
  value: T;
}

export function draftKey(visitId: string | undefined, form: string): string {
  return visitId ? `${PREFIX}${visitId}:${form}` : `${PREFIX}${form}`;
}

/** Drops every draft of a visit (after check-out). Best-effort. */
export async function clearVisitDrafts(visitId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(`${PREFIX}${visitId}:`));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {
    /* a stale draft only means a pre-filled form later — never block check-out */
  }
}

/**
 * Restores `key`'s draft once on mount (unless the user already started typing)
 * and saves `value` after each change; an empty value removes the draft.
 * Returns when the restored draft was saved, so the screen can say so.
 */
export function useDraft<T>(
  key: string | null,
  value: T,
  restore: (v: T) => void,
  isEmpty: (v: T) => boolean,
): { restoredAt: number | null; clear: () => Promise<void>; discard: () => Promise<void> } {
  const [loaded, setLoaded] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const touched = useRef(false);
  const cleared = useRef(false);
  // Latest callbacks, without re-running the load/save effects when they change.
  const restoreRef = useRef(restore);
  const isEmptyRef = useRef(isEmpty);
  useEffect(() => {
    restoreRef.current = restore;
    isEmptyRef.current = isEmpty;
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled || !raw || touched.current) return;
        const stored = JSON.parse(raw) as Stored<T>;
        restoreRef.current(stored.value);
        setRestoredAt(stored.savedAt);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Changes before the stored draft is read are the user's own: they win.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!loaded) touched.current = true;
    if (!key || !loaded || cleared.current) return;
    const t = setTimeout(() => {
      if (cleared.current) return;
      const write = isEmptyRef.current(value)
        ? AsyncStorage.removeItem(key)
        : AsyncStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value } satisfies Stored<T>));
      write.catch(() => undefined);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [key, value, loaded]);

  /** After a successful submit: remove the draft and stop saving. */
  const clear = async () => {
    cleared.current = true;
    setRestoredAt(null);
    if (key) await AsyncStorage.removeItem(key).catch(() => undefined);
  };

  /** "Start over": remove the restored draft; whatever is typed next is saved again. */
  const discard = async () => {
    setRestoredAt(null);
    if (key) await AsyncStorage.removeItem(key).catch(() => undefined);
  };

  return { restoredAt, clear, discard };
}
