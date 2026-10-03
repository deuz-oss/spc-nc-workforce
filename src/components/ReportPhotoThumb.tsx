import React, { useEffect, useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C, R, SP, T } from '../theme';
import { getReportPhotoUrl, openReportPhoto } from '../utils/storage';
import { SkeletonBlock } from './ui';

const SIZE = 72;

/**
 * Evidence photo preview in a review list: the TL sees the shelf without
 * leaving the app; tapping opens the full photo. Not uploaded yet (still queued
 * on the NC's phone) or not visible to this viewer → says so instead.
 */
export function ReportPhotoThumb({ photoRef, label }: { photoRef: string; label: string }) {
  const [state, setState] = useState<{ ref: string; url: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReportPhotoUrl(photoRef)
      .then((url) => !cancelled && setState({ ref: photoRef, url }))
      .catch(() => !cancelled && setState({ ref: photoRef, url: null }));
    return () => {
      cancelled = true;
    };
  }, [photoRef]);

  const current = state?.ref === photoRef ? state : null;

  return (
    <TouchableOpacity
      onPress={() => void openReportPhoto(photoRef)}
      accessibilityRole="imagebutton"
      accessibilityLabel={`Foto bukti ${label}. Ketuk untuk memperbesar.`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: SIZE }}
    >
      {current == null ? (
        <SkeletonBlock width={SIZE} height={SIZE} style={{ borderRadius: R.input }} />
      ) : current.url ? (
        <Image source={{ uri: current.url }} style={{ width: SIZE, height: SIZE, borderRadius: R.input, backgroundColor: C.divider }} />
      ) : (
        <View style={{ width: SIZE, height: SIZE, borderRadius: R.input, backgroundColor: C.divider, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="image-outline" size={26} color={C.muted} />
        </View>
      )}
      <Text style={[T.label, { flex: 1, color: C.primaryText }]}>
        {current && !current.url ? 'Foto belum bisa ditampilkan — ketuk untuk mencoba buka' : 'Ketuk untuk memperbesar foto'}
      </Text>
    </TouchableOpacity>
  );
}
