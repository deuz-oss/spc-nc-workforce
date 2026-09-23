import React, { useMemo, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Btn, Card, Chip, Field, H, Input, KPICard, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { CATEGORY_LABEL } from '../config';
import { C } from '../theme';
import { useStore } from '../store/useStore';
import { StoreCategory } from '../types';

/** Share of Shelf (PRD §5.2) — one row per visit, required photo (evidence is
 * the source of truth for v1; photo annotation is explicitly out of scope). */
export default function ShareOfShelfScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const submitShareOfShelf = useStore((s) => s.submitShareOfShelf);

  const [channel, setChannel] = useState('');
  const [category, setCategory] = useState<StoreCategory>('premium');
  const [ownFacing, setOwnFacing] = useState('');
  const [totalFacing, setTotalFacing] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sosPct = useMemo(() => {
    const own = Number(ownFacing);
    const total = Number(totalFacing);
    if (!totalFacing.trim() || !isFinite(total) || total <= 0 || !isFinite(own)) return null;
    return Math.round((own / total) * 1000) / 10;
  }, [ownFacing, totalFacing]);

  const facingInvalid =
    ownFacing.trim() !== '' && totalFacing.trim() !== '' && Number(ownFacing) > Number(totalFacing);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4 });
    if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showDialog('Izin kamera diperlukan');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.4 });
    if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
  };

  const canSubmit =
    !busy &&
    ownFacing.trim() !== '' &&
    totalFacing.trim() !== '' &&
    !facingInvalid &&
    Number(ownFacing) >= 0 &&
    Number(totalFacing) >= 0 &&
    !!photoUri;

  const submit = async () => {
    if (!photoUri) {
      showDialog('Belum lengkap', 'Foto wajib untuk Share of Shelf — manual count adalah sumber data utama, foto sebagai bukti (PRD §5.2).');
      return;
    }
    if (facingInvalid) {
      showDialog('Tidak valid', 'Own facing tidak boleh melebihi total facing.');
      return;
    }
    setBusy(true);
    try {
      await submitShareOfShelf(
        visitId,
        storeId,
        { channel: channel.trim(), category, ownFacingCount: Number(ownFacing), totalFacingCount: Number(totalFacing) },
        photoUri,
      );
      showDialog('Share of Shelf Tersimpan', undefined, [{ label: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      // store action already showed a dialog for offline/upload-failure cases
      if (e?.message && !['Tidak ada koneksi internet.', 'Upload foto gagal.'].includes(e.message)) {
        showDialog('Gagal Menyimpan', e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120, maxWidth: 900, width: '100%', alignSelf: 'center' }}
      >
        <SectionHeader title="Share of Shelf" subtitle="Bi-weekly · SOS% per channel & kategori (PRD §5.2)" />

        <Card>
          <Field label="Account / Channel">
            <Input placeholder="mis. DMS, LMT, MTI (definisi menunggu konfirmasi client)" value={channel} onChangeText={setChannel} />
          </Field>
          <View style={{ height: 10 }} />
          <Field label="Kategori">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['premium', 'super_premium'] as StoreCategory[]).map((c) => (
                <Chip key={c} label={CATEGORY_LABEL[c]} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
          </Field>
        </Card>

        <Card>
          <H>Facing Count</H>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="Own Facing">
                <Input placeholder="0" keyboardType="numeric" value={ownFacing} onChangeText={(v) => setOwnFacing(v.replace(/[^0-9]/g, ''))} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Total Category Facing">
                <Input placeholder="0" keyboardType="numeric" value={totalFacing} onChangeText={(v) => setTotalFacing(v.replace(/[^0-9]/g, ''))} />
              </Field>
            </View>
          </View>
          {facingInvalid && <Muted style={{ marginTop: 8, color: C.accent }}>Own facing tidak boleh melebihi total facing.</Muted>}
          <View style={{ marginTop: 12 }}>
            <KPICard title="SOS %" value={sosPct != null ? `${sosPct}%` : '-'} status="neutral" />
          </View>
        </Card>

        <Card>
          <H>Foto Rak (wajib)</H>
          <Muted style={{ marginTop: 2 }}>Bukti evidence — hitung manual tetap jadi sumber data utama (annotasi foto di luar scope v1).</Muted>
          {photoUri ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              <Image source={{ uri: photoUri }} style={{ width: '100%', height: 160, borderRadius: 12 }} />
              <Btn small variant="outline" title="Hapus Foto" onPress={() => setPhotoUri(null)} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Btn small variant="outline" title="Pilih dari Galeri" onPress={pickPhoto} />
              <Btn small variant="outline" title="Ambil Foto" onPress={takePhoto} />
            </View>
          )}
        </Card>
      </ScrollView>

      <StickyFooter>
        <Btn title="Simpan Share of Shelf" onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
