import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

let listener: ((s: DialogState | null) => void) | null = null;
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

export function DialogHost() {
  const [state, setState] = useState<DialogState | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  useEffect(() => {
    listener = setState;
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

  const close = (fn?: () => void) => {
    setState(null);
    fn?.();
  };

  return (
    <>
      <Text aria-live="polite" role="status" style={styles.visuallyHidden}>
        {liveMessage}
      </Text>
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
                  {/* primary fill uses onPrimary text; the red destructive fill keeps white */}
                  <Text style={[styles.btnLabel, { color: b.destructive ? '#fff' : C.onPrimary }]}>
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
});
