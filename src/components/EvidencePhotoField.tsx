import React from 'react';
import { Image, Platform, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Btn, Muted } from './ui';
import { showDialog } from './dialog';

/**
 * Report evidence photo (Stock Taking, Share of Shelf, Paid Visibility, Price
 * Monitoring). On a phone the photo must come from the camera, taken now —
 * picking from the gallery let an old photo (another day, another store) pass
 * as evidence for this visit. The web app has no reliable camera capture, so
 * it keeps a file picker; field work happens on the phone app.
 */
export function EvidencePhotoField({ uri, onChange }: { uri: string | null; onChange: (uri: string | null) => void }) {
  const take = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showDialog('Izin kamera diperlukan', 'Foto bukti harus diambil langsung dengan kamera.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.4 });
    if (!res.canceled && res.assets[0]) onChange(res.assets[0].uri);
  };

  const pickFile = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4 });
    if (!res.canceled && res.assets[0]) onChange(res.assets[0].uri);
  };

  if (uri) {
    return (
      <View style={{ marginTop: 10, gap: 8 }}>
        <Image source={{ uri }} style={{ width: '100%', height: 160, borderRadius: 12 }} />
        <Btn small variant="outline" title="Hapus Foto" onPress={() => onChange(null)} />
      </View>
    );
  }
  return (
    <View style={{ marginTop: 10, gap: 6, alignItems: 'flex-start' }}>
      {Platform.OS === 'web' ? (
        <Btn small variant="outline" title="Pilih Foto" onPress={pickFile} />
      ) : (
        <>
          <Btn small variant="outline" title="Ambil Foto" onPress={take} />
          <Muted>Foto diambil langsung dari kamera saat kunjungan (galeri tidak bisa dipakai).</Muted>
        </>
      )}
    </View>
  );
}
