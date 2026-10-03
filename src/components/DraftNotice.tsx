import React from 'react';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Btn } from './ui';
import { C, R, SP, T } from '../theme';
import { fmtTime } from '../utils/format';

/** Tells the user a form was pre-filled from their unsent draft, with a way to start over. */
export function DraftNotice({ savedAt, onDiscard }: { savedAt: number | null; onDiscard: () => void }) {
  if (savedAt == null) return null;
  return (
    <View
      role="status"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: SP.sm,
        padding: SP.md,
        borderRadius: R.card,
        backgroundColor: C.infoBg,
      }}
    >
      <Ionicons name="document-text-outline" size={20} color={C.infoStrong} />
      <Text style={[T.status, { flex: 1, minWidth: 180 }]}>
        {`Isian yang belum dikirim dipulihkan (tersimpan ${fmtTime(savedAt)}).`}
      </Text>
      <Btn small variant="outline" title="Mulai dari Kosong" onPress={onDiscard} />
    </View>
  );
}
