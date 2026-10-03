import React from 'react';
import { Image, Platform, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { Btn } from './ui';
import { showDialog } from './dialog';
import { C, R, SP, T } from '../theme';

const DEFAULT_TIPS = ['Ambil dari depan, seluruh rak masuk bingkai', 'Terang dan tidak buram', 'Label produk dan harga terbaca'];

/**
 * Report evidence photo (Stock Taking, Share of Shelf, Paid Visibility, Price
 * Monitoring). On a phone the photo must come from the camera, taken now —
 * picking from the gallery let an old photo (another day, another store) pass
 * as evidence for this visit. The web app has no reliable camera capture, so
 * it keeps a file picker; field work happens on the phone app.
 *
 * Says what a usable photo looks like before it's taken, offers a retake, and
 * that the photo travels with the report (queued with it when offline).
 */
export function EvidencePhotoField({
  uri,
  onChange,
  tips = DEFAULT_TIPS,
}: {
  uri: string | null;
  onChange: (uri: string | null) => void;
  /** What a good photo shows, for this report. */
  tips?: string[];
}) {
  const take = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showDialog('Izin Kamera Diperlukan', 'Foto bukti harus diambil langsung dengan kamera. Izinkan kamera untuk aplikasi ini di Pengaturan HP.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.4 });
    if (!res.canceled && res.assets[0]) onChange(res.assets[0].uri);
  };

  const pickFile = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4 });
    if (!res.canceled && res.assets[0]) onChange(res.assets[0].uri);
  };

  const capture = Platform.OS === 'web' ? pickFile : take;

  if (uri) {
    return (
      <View style={{ marginTop: SP.md, gap: SP.sm }}>
        <Image
          source={{ uri }}
          accessibilityLabel="Foto bukti yang diambil"
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: R.card, backgroundColor: C.divider }}
          resizeMode="cover"
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.xs }}>
          <Ionicons name="checkmark-circle" size={18} color={C.okStrong} />
          <Text style={[T.label, { flex: 1 }]}>Foto siap — dikirim bersama laporan. Bila offline, dikirim otomatis saat online.</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: SP.sm }}>
          <View style={{ flex: 1 }}>
            <Btn variant="outline" title={Platform.OS === 'web' ? 'Ganti Foto' : 'Ulangi Foto'} onPress={capture} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn variant="outline" title="Hapus" onPress={() => onChange(null)} accessibilityLabel="Hapus foto" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ marginTop: SP.md, gap: SP.sm }}>
      <View style={{ gap: 4, padding: SP.md, borderRadius: R.input, backgroundColor: C.surfaceAlt }}>
        <Text style={T.label}>Foto yang baik:</Text>
        {tips.map((t) => (
          <View key={t} style={{ flexDirection: 'row', gap: SP.xs, alignItems: 'flex-start' }}>
            <Ionicons name="checkmark" size={16} color={C.infoStrong} style={{ marginTop: 1 }} />
            <Text style={[T.small, { color: C.text, flex: 1 }]}>{t}</Text>
          </View>
        ))}
      </View>
      <Btn variant="outline" title={Platform.OS === 'web' ? 'Pilih Foto' : 'Ambil Foto'} onPress={capture} />
      {Platform.OS !== 'web' && <Text style={T.small}>Foto diambil langsung dengan kamera — foto dari galeri tidak bisa dipakai.</Text>}
    </View>
  );
}
