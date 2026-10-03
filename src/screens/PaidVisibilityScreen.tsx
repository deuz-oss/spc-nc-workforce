import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Btn, Card, Chip, H, Muted, SectionHeader, StickyFooter, STICKY_FOOTER_SPACE } from '../components/ui';
import { showDialog, showToast } from '../components/dialog';
import { EvidencePhotoField } from '../components/EvidencePhotoField';
import { DraftNotice } from '../components/DraftNotice';
import { draftKey, useDraft } from '../components/useDraft';
import { COMPLIANCE_CHECKLIST_ITEMS, VISIBILITY_TYPES } from '../config';
import { C, T, TOUCH } from '../theme';
import { ShownError, useStore } from '../store/useStore';

/** Paid Visibility (PRD §5.5) — required photo, compliance checklist. Visibility
 * type list and checklist items aren't specified by the client brief; defaults
 * defined in config.ts, pending confirmation. */
export default function PaidVisibilityScreen() {
  const route = useAppRoute<'PaidVisibility'>();
  const navigation = useNavigation();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const submitPaidVisibility = useStore((s) => s.submitPaidVisibility);

  // One Paid Visibility per type per visit — types already reported can't be picked again.
  const allPv = useStore((s) => s.paidVisibilityRows);
  const doneTypes = useMemo(
    () => new Set(allPv.filter((r) => r.visitId === visitId).map((r) => r.visibilityType)),
    [allPv, visitId],
  );
  const [visibilityType, setVisibilityType] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useMemo(() => ({ visibilityType, checklist, photoUri }), [visibilityType, checklist, photoUri]);
  const saved = useDraft(
    draftKey(visitId, 'paid_visibility'),
    draft,
    (d) => {
      if (d.visibilityType && !doneTypes.has(d.visibilityType)) setVisibilityType(d.visibilityType);
      setChecklist(d.checklist);
      setPhotoUri(d.photoUri);
    },
    (d) => !d.visibilityType && !d.photoUri && !Object.values(d.checklist).some(Boolean),
  );

  const toggleItem = (key: string) => setChecklist((c) => ({ ...c, [key]: !c[key] }));



  const canSubmit = !busy && !!visibilityType && !doneTypes.has(visibilityType) && !!photoUri;

  const submit = async () => {
    if (!visibilityType) {
      showDialog('Belum lengkap', 'Pilih jenis visibility.');
      return;
    }
    if (!photoUri) {
      showDialog('Foto Belum Ada', 'Ambil foto materi promosi yang terpasang sebelum menyimpan.');
      return;
    }
    setBusy(true);
    try {
      const { queued } = await submitPaidVisibility(visitId, storeId, { visibilityType, complianceChecklist: checklist }, photoUri);
      await saved.clear();
      // Saved offline: the store already told the user — no second message.
      if (!queued) showToast('Paid Visibility tersimpan');
      navigation.goBack();
    } catch (e: any) {
      if (!(e instanceof ShownError)) {
        showDialog('Gagal Menyimpan', e?.message ?? 'Coba lagi.');
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
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: STICKY_FOOTER_SPACE, maxWidth: 900, width: '100%', alignSelf: 'center' }}
      >
        <SectionHeader title="Paid Visibility" subtitle="Cek materi promosi berbayar yang terpasang di toko" />
        <DraftNotice
          savedAt={saved.restoredAt}
          onDiscard={() => {
            void saved.discard();
            setVisibilityType(null);
            setChecklist({});
            setPhotoUri(null);
          }}
        />

        <Card>
          <H>Jenis materi promosi</H>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {VISIBILITY_TYPES.map((v) =>
              doneTypes.has(v.key) ? (
                <Chip key={v.key} label={`${v.label} ✓ sudah dilaporkan`} color={C.ok} />
              ) : (
                <Chip key={v.key} label={v.label} active={visibilityType === v.key} onPress={() => setVisibilityType(v.key)} />
              ),
            )}
          </View>
        </Card>

        <Card>
          <H>Checklist kepatuhan</H>
          <View style={{ gap: 10, marginTop: 10 }}>
            {COMPLIANCE_CHECKLIST_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.key}
                onPress={() => toggleItem(item.key)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TOUCH }}
                accessibilityRole="checkbox"
                accessibilityLabel={item.label}
                accessibilityState={{ checked: !!checklist[item.key] }}
              >
                <Ionicons
                  name={checklist[item.key] ? 'checkbox' : 'square-outline'}
                  size={28}
                  color={checklist[item.key] ? C.primaryDark : C.muted}
                />
                <Text style={[T.body, { flex: 1 }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <Card>
          <H>Foto materi promosi (wajib)</H>
          <Muted style={{ marginTop: 2 }}>Bukti pemasangan asset visibility.</Muted>
          <EvidencePhotoField
            uri={photoUri}
            onChange={setPhotoUri}
            tips={['Seluruh materi promosi terlihat utuh', 'Posisinya di rak/toko ikut terlihat', 'Terang dan tidak buram']}
          />
        </Card>
      </ScrollView>

      <StickyFooter>
        <Btn title={busy ? 'Mengirim…' : 'Simpan Paid Visibility'} onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
