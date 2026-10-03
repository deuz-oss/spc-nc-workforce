import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import { Btn, Card, Chip, Field, H, Input, KPICard, Muted, SectionHeader, StickyFooter, STICKY_FOOTER_SPACE } from '../components/ui';
import { showDialog, showToast } from '../components/dialog';
import { EvidencePhotoField } from '../components/EvidencePhotoField';
import { DraftNotice } from '../components/DraftNotice';
import { draftKey, useDraft } from '../components/useDraft';
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
  const draft = useMemo(() => ({ channel, category, ownFacing, totalFacing, photoUri }), [channel, category, ownFacing, totalFacing, photoUri]);
  const saved = useDraft(
    draftKey(visitId, 'share_of_shelf'),
    draft,
    (d) => {
      setChannel(d.channel);
      if (!doneCategories.has(d.category)) setCategory(d.category);
      setOwnFacing(d.ownFacing);
      setTotalFacing(d.totalFacing);
      setPhotoUri(d.photoUri);
    },
    (d) => !d.ownFacing && !d.totalFacing && !d.photoUri,
  );

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
      showDialog('Foto Belum Ada', 'Ambil foto rak sebagai bukti sebelum menyimpan.');
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
      await saved.clear();
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
        <SectionHeader title="Share of Shelf" subtitle="Porsi rak produk kita dibanding seluruh kategori" />
        <DraftNotice
          savedAt={saved.restoredAt}
          onDiscard={() => {
            void saved.discard();
            setOwnFacing('');
            setTotalFacing('');
            setPhotoUri(null);
          }}
        />

        <Card>
          <Field label="Channel toko">
            <Input placeholder="mis. DMS, LMT, MTI" value={channel} onChangeText={setChannel} />
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
          <H>Hitung facing</H>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="Facing produk kita" required>
                <Input placeholder="0" keyboardType="numeric" value={ownFacing} onChangeText={(v) => setOwnFacing(v.replace(/[^0-9]/g, ''))} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Total facing kategori" required>
                <Input placeholder="0" keyboardType="numeric" value={totalFacing} onChangeText={(v) => setTotalFacing(v.replace(/[^0-9]/g, ''))} />
              </Field>
            </View>
          </View>
          {facingInvalid && <Muted style={{ marginTop: 8, color: C.accent }}>Own facing tidak boleh melebihi total facing.</Muted>}
          <View style={{ marginTop: 12 }}>
            <KPICard title="Porsi rak (SOS)" value={sosPct != null ? `${sosPct}%` : '-'} status="neutral" />
          </View>
        </Card>

        <Card>
          <H>Foto rak (wajib)</H>
          <Muted style={{ marginTop: 2 }}>Bukti untuk angka yang Anda hitung di atas.</Muted>
          <EvidencePhotoField
            uri={photoUri}
            onChange={setPhotoUri}
            tips={['Seluruh rak kategori masuk bingkai', 'Ambil dari depan, tidak miring', 'Terang dan tidak buram']}
          />
        </Card>
      </ScrollView>

      <StickyFooter>
        <Btn title={busy ? 'Mengirim…' : 'Simpan Share of Shelf'} onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
