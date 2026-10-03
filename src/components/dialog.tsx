import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, ELEV, F, R, SP, T } from '../theme';

export interface DialogButton {
  label: string;
  onPress?: () => void;
  destructive?: boolean;
}

interface DialogState {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

let listener: ((s: DialogState) => void) | null = null;
let announceListener: ((msg: string) => void) | null = null;

/**
 * Pengganti Alert.alert yang bekerja di Android, iOS, dan Web
 * (Alert.alert tidak melakukan apa-apa di web).
 */
export function showDialog(title: string, message?: string, buttons?: DialogButton[]) {
  const btns = buttons && buttons.length ? buttons : [{ label: 'OK' }];
  listener?.({ title, message, buttons: btns });
}

/**
 * Announces a status/error message to screen readers via a shared, always-mounted
 * aria-live region — for messages that render inline on a screen (e.g. form errors)
 * rather than through showDialog, and so would otherwise be silent to assistive tech.
 */
export function announce(message: string) {
  announceListener?.(message);
}

let toastListener: ((t: { message: string; kind: ToastKind }) => void) | null = null;

export type ToastKind = 'success' | 'info';

/**
 * Brief, non-blocking confirmation ("Stock Taking tersimpan") that disappears
 * by itself — for outcomes the user needs to see but not acknowledge. Errors,
 * decisions and anything the user must read keep using showDialog.
 */
export function showToast(message: string, kind: ToastKind = 'success') {
  toastListener?.({ message, kind });
}

const TOAST_MS = 2600;

export function DialogHost() {
  // FIFO queue — a dialog raised while another is open (e.g. the background
  // offline-sync "Tersinkron" notice) waits its turn instead of replacing the
  // open one and silently discarding that dialog's button callbacks.
  const [queue, setQueue] = useState<DialogState[]>([]);
  const state = queue[0] ?? null;
  const [liveMessage, setLiveMessage] = useState('');

  useEffect(() => {
    // A double tap raises the same dialog twice — keep one, or the second
    // would act on a state the first one already changed.
    listener = (s) =>
      setQueue((q) => (q.some((x) => x.title === s.title && x.message === s.message) ? q : [...q, s]));
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    announceListener = (msg) => {
      // clear first so the same message announced twice in a row still fires a change
      setLiveMessage('');
      setTimeout(() => setLiveMessage(msg), 50);
    };
    return () => {
      announceListener = null;
    };
  }, []);

  // Toast: one at a time, the newest replaces the current one.
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; kind: ToastKind; n: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    toastListener = ({ message, kind }) => {
      setToast((t) => ({ message, kind, n: (t?.n ?? 0) + 1 }));
      announceListener?.(message);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
    };
    return () => {
      toastListener = null;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const close = (fn?: () => void) => {
    setQueue((q) => q.slice(1));
    fn?.();
  };

  return (
    <>
      <Text aria-live="polite" role="status" style={styles.visuallyHidden}>
        {liveMessage}
      </Text>
      {toast && (
        // Above the bottom tab bar / form footer; never blocks touches.
        <View pointerEvents="none" style={[styles.toastWrap, { bottom: insets.bottom + 84 }]}>
          <View key={toast.n} style={styles.toast}>
            <Ionicons
              name={toast.kind === 'success' ? 'checkmark-circle' : 'information-circle'}
              size={18}
              color={toast.kind === 'success' ? C.okBg : C.infoBg}
            />
            <Text style={styles.toastText}>{toast.message}</Text>
          </View>
        </View>
      )}
      <Modal
        visible={!!state}
        transparent
        animationType="fade"
        onRequestClose={() => close()}
        aria-label={state?.title}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>{state?.title}</Text>
            {state?.message ? <Text style={styles.message}>{state.message}</Text> : null}
            <View style={styles.buttonsRow}>
              {(state?.buttons ?? []).map((b) => (
                <TouchableOpacity
                  key={b.label}
                  activeOpacity={0.8}
                  onPress={() => close(b.onPress)}
                  style={[
                    styles.btn,
                    { backgroundColor: b.destructive ? C.accent : C.primary },
                  ]}
                >
                          <Text style={[styles.btnLabel, { color: C.onPrimary }]}>
                    {b.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  backdrop: {
    flex: 1,
    backgroundColor: C.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: R.card,
    padding: 18,
    width: '100%',
    maxWidth: 380,
    ...ELEV[2],
  },
  title: { ...T.h2, fontSize: 16 },
  message: { marginTop: 8, color: C.muted, fontSize: 13, lineHeight: 19, fontFamily: F.reg },
  buttonsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: SP.sm, marginTop: 18 },
  btn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: R.btn },
  btnLabel: { fontWeight: '700', fontFamily: F.bold, fontSize: 13 },
  toastWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 420,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: R.btn,
    backgroundColor: C.primary,
    ...ELEV[2],
  },
  toastText: { flexShrink: 1, color: C.onPrimary, fontFamily: F.semi, fontSize: 13 },
});
