import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import { Btn, Card, Chip, Field, H, Input, KPICard, Muted, SectionHeader, StickyFooter, STICKY_FOOTER_SPACE } from '../components/ui';
import { showDialog, showToast } from '../components/dialog';
import { EvidencePhotoField } from '../components/EvidencePhotoField';
import { CATEGORY_LABEL } from '../config';
import { C } from '../theme';
import { ShownError, useStore } from '../store/useStore';
import { StoreCategory } from '../types';

/** Share of Shelf (PRD §5.2) — one row per visit, required photo (evidence is
 * the source of truth for v1; photo annotation is explicitly out of scope). */
const CATEGORIES: StoreCategory[] = ['premium', 'super_premium'];

export default function ShareOfShelfScreen() {
  const route = useAppRoute<'ShareOfShelf'>();
  const navigation = useNavigation();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const submitShareOfShelf = useStore((s) => s.submitShareOfShelf);

  // Defaults from the store's master data — the NC only types it when it differs.
  const store = useStore((s) => s.stores.find((x) => x.id === storeId));
  const [channel, setChannel] = useState(store?.channel ?? '');
  // One Share of Shelf per category per visit — categories already reported can't be picked again.
  const allSos = useStore((s) => s.shareOfShelfRows);
  const doneCategories = useMemo(
    () => new Set(allSos.filter((r) => r.visitId === visitId).map((r) => r.category)),
    [allSos, visitId],
  );
  const [category, setCategory] = useState<StoreCategory>(() =>
    store && !doneCategories.has(store.category)
      ? store.category
      : (CATEGORIES.find((c) => !doneCategories.has(c)) ?? 'premium'),
  );
  const allDone = CATEGORIES.every((c) => doneCategories.has(c));
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



  const canSubmit =
    !busy &&
    !doneCategories.has(category) &&
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
      const { queued } = await submitShareOfShelf(
        visitId,
        storeId,
        { channel: channel.trim(), category, ownFacingCount: Number(ownFacing), totalFacingCount: Number(totalFacing) },
        photoUri,
      );
      // Saved offline: the store already told the user — no second message.
      if (!queued) showToast('Share of Shelf tersimpan');
      navigation.goBack();
    } catch (e: any) {
      // store action already showed a dialog for offline/upload-failure cases
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
        <SectionHeader title="Share of Shelf" subtitle="Bi-weekly · SOS% per channel & kategori (PRD §5.2)" />

        <Card>
          <Field label="Account / Channel">
            <Input placeholder="mis. DMS, LMT, MTI (definisi menunggu konfirmasi client)" value={channel} onChangeText={setChannel} />
          </Field>
          {!!store?.channel && (
            <Muted style={{ marginTop: 4 }}>Diisi dari data toko ({store.channel}); ubah hanya bila berbeda.</Muted>
          )}
          <View style={{ height: 10 }} />
          <Field label="Kategori">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {CATEGORIES.map((c) =>
                doneCategories.has(c) ? (
                  <Chip key={c} label={`${CATEGORY_LABEL[c]} ✓ sudah dilaporkan`} color={C.ok} />
                ) : (
                  <Chip key={c} label={CATEGORY_LABEL[c]} active={category === c} onPress={() => setCategory(c)} />
                ),
              )}
            </View>
          </Field>
          {allDone && (
            <Muted style={{ marginTop: 8 }}>Semua kategori sudah dilaporkan untuk kunjungan ini.</Muted>
          )}
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
          <EvidencePhotoField uri={photoUri} onChange={setPhotoUri} />
        </Card>
      </ScrollView>

      <StickyFooter>
        <Btn title="Simpan Share of Shelf" onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
