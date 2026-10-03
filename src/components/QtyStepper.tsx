import React, { useEffect, useRef } from 'react';
import { TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C, F, R, T, TOUCH } from '../theme';

function StepButton({
  icon,
  onPress,
  disabled,
  label,
}: {
  icon: 'remove' | 'add';
  onPress: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={{
        width: TOUCH,
        height: TOUCH,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: R.input,
        borderWidth: 1,
        borderColor: C.borderStrong,
        backgroundColor: C.card,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Ionicons name={icon} size={22} color={C.primaryText} />
    </TouchableOpacity>
  );
}

/**
 * Whole-number quantity: − [value] +, each 48 dp, so a count needs no keyboard
 * most of the time (the field still takes typing for big numbers). Empty means
 * "not filled in" — distinct from 0; the first + gives 1, − on 1 gives 0.
 */
export function QtyStepper({
  value,
  onChange,
  label,
  max = 99999,
}: {
  value: string;
  onChange: (v: string) => void;
  /** What is counted, for screen readers ("Stok Enfagrow A+ 400g"). */
  label: string;
  max?: number;
}) {
  const n = value === '' ? null : Number(value);
  // Fast repeated taps can land before the parent re-renders with the new
  // value — count from the last value sent, not from the (stale) prop.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const step = (delta: number) => {
    const cur = latest.current === '' ? 0 : Number(latest.current);
    const next = String(Math.max(0, Math.min(max, cur + delta)));
    latest.current = next;
    onChange(next);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <StepButton icon="remove" onPress={() => step(-1)} disabled={n == null || n <= 0} label={`Kurangi ${label}`} />
      <TextInput
        value={value}
        onChangeText={(v) => {
          const next = v.replace(/[^0-9]/g, '').slice(0, String(max).length);
          latest.current = next;
          onChange(next);
        }}
        keyboardType="number-pad"
        placeholder="–"
        placeholderTextColor={C.muted}
        accessibilityLabel={label}
        selectTextOnFocus
        style={[
          T.h2,
          {
            width: 72,
            height: TOUCH,
            textAlign: 'center',
            borderRadius: R.input,
            borderWidth: 1,
            borderColor: value === '' ? C.border : C.primaryText,
            backgroundColor: C.card,
            fontFamily: F.bold,
            fontVariant: ['tabular-nums'],
          },
        ]}
      />
      <StepButton icon="add" onPress={() => step(1)} disabled={n != null && n >= max} label={`Tambah ${label}`} />
    </View>
  );
}
