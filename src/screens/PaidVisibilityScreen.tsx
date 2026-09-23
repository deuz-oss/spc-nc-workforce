import React, { useState } from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Btn, Card, Chip, H, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { COMPLIANCE_CHECKLIST_ITEMS, VISIBILITY_TYPES } from '../config';
import { C, F } from '../theme';
import { useStore } from '../store/useStore';

/** Paid Visibility (PRD §5.5) — required photo, compliance checklist. Visibility
 * type list and checklist items aren't specified by the client brief; defaults
 * defined in config.ts, pending confirmation. */
export default function PaidVisibilityScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const submitPaidVisibility = useStore((s) => s.submitPaidVisibility);

  const [visibilityType, setVisibilityType] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleItem = (key: string) => setChecklist((c) => ({ ...c, [key]: !c[key] }));

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

  const canSubmit = !busy && !!visibilityType && !!photoUri;

  const submit = async () => {
    if (!visibilityType) {
      showDialog('Belum lengkap', 'Pilih jenis visibility.');
      return;
    }
    if (!photoUri) {
      showDialog('Belum lengkap', 'Foto wajib untuk Paid Visibility (PRD §5.5).');
      return;
    }
    setBusy(true);
    try {
      await submitPaidVisibility(visitId, storeId, { visibilityType, complianceChecklist: checklist }, photoUri);
      showDialog('Paid Visibility Tersimpan', undefined, [{ label: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
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
        <SectionHeader title="Paid Visibility" subtitle="Bi-weekly · asset tracking (PRD §5.5)" />

        <Card>
          <H>Jenis Visibility</H>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {VISIBILITY_TYPES.map((v) => (
              <Chip key={v.key} label={v.label} active={visibilityType === v.key} onPress={() => setVisibilityType(v.key)} />
            ))}
          </View>
        </Card>

        <Card>
          <H>Compliance Checklist</H>
          <View style={{ gap: 10, marginTop: 10 }}>
            {COMPLIANCE_CHECKLIST_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.key}
                onPress={() => toggleItem(item.key)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!checklist[item.key] }}
              >
                <Ionicons
                  name={checklist[item.key] ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={checklist[item.key] ? C.primaryDark : C.faint}
                />
                <Text style={{ flex: 1, fontFamily: F.reg, fontSize: 13, color: C.text }}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <Card>
          <H>Foto (wajib)</H>
          <Muted style={{ marginTop: 2 }}>Bukti pemasangan asset visibility.</Muted>
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
        <Btn title="Simpan Paid Visibility" onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
