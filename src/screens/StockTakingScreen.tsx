import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import { Badge, Btn, Card, Chip, H, Muted, SectionHeader, StickyFooter, STICKY_FOOTER_SPACE } from '../components/ui';
import { showDialog, showToast } from '../components/dialog';
import { confirmSkippedRows } from '../components/SkuPicker';
import { EvidencePhotoField } from '../components/EvidencePhotoField';
import { ProductLine, ProductQtyList, useProductLines } from '../components/ProductQtyList';
import { QtyStepper } from '../components/QtyStepper';
import { DraftNotice } from '../components/DraftNotice';
import { draftKey, useDraft } from '../components/useDraft';
import { C, SP } from '../theme';
import { reportedSkus, ShownError, useCurrentUser, useStore } from '../store/useStore';

/** What the user has entered so far — also the saved draft. */
interface Draft {
  qty: Record<string, string>; // per SKU; '' / missing = not counted
  oos: Record<string, boolean>;
  manual: ProductLine[];
  photoUri: string | null;
}
const EMPTY: Draft = { qty: {}, oos: {}, manual: [], photoUri: null };
const isEmptyDraft = (d: Draft) =>
  !d.photoUri && !d.manual.length && !Object.values(d.qty).some((v) => v !== '') && !Object.values(d.oos).some(Boolean);

/** Stock Taking (PRD §5.1): quantity on hand per SKU, optional shelf photo. */
export default function StockTakingScreen() {
  const route = useAppRoute<'StockTaking'>();
  const navigation = useNavigation();
  const me = useCurrentUser()!;
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const submitStockTaking = useStore((s) => s.submitStockTaking);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const saved = useDraft(draftKey(visitId, 'stock_taking'), draft, setDraft, isEmptyDraft);

  // One report per visit per SKU (a second one would double the numbers):
  // SKUs already sent for this visit are listed, not offered again.
  const allReported = useStore((s) => s.stockTakingRows);
  const reportedList = useMemo(() => allReported.filter((r) => r.visitId === visitId), [allReported, visitId]);
  const reported = useMemo(() => reportedSkus(reportedList, visitId), [reportedList, visitId]);
  const lines = useProductLines(reported, draft.manual);

  const setQty = (sku: string, v: string) => setDraft((d) => ({ ...d, qty: { ...d.qty, [sku]: v } }));
  const toggleOos = (sku: string) =>
    setDraft((d) => {
      const on = !d.oos[sku];
      // Out of stock means a count of 0; switching it off keeps whatever was typed.
      return { ...d, oos: { ...d.oos, [sku]: on }, qty: on ? { ...d.qty, [sku]: '0' } : d.qty };
    });

  const filled = (sku: string) => (draft.qty[sku] ?? '') !== '';
  const validLines = lines.filter((l) => filled(l.sku));
  const canSubmit = validLines.length > 0 && !busy;

  const submit = async () => {
    if (!validLines.length) {
      showDialog('Belum Ada Jumlah', 'Isi jumlah minimal satu produk (boleh 0) sebelum menyimpan.');
      return;
    }
    // Products typed in by hand but left without a count would be dropped silently.
    const skipped = draft.manual.filter((m) => !filled(m.sku)).map((m) => m.sku);
    if (!(await confirmSkippedRows(skipped))) return;
    setBusy(true);
    try {
      const { queued } = await submitStockTaking(
        visitId,
        storeId,
        validLines.map((l) => ({ sku: l.sku, qtyOnHand: Number(draft.qty[l.sku]), outOfStock: !!draft.oos[l.sku] })),
        draft.photoUri ?? undefined,
      );
      await saved.clear();
      // Saved offline: the store already told the user — no second message.
      if (!queued) showToast('Stock Taking tersimpan');
      navigation.goBack();
    } catch (e: any) {
      if (!(e instanceof ShownError)) showDialog('Gagal Menyimpan', e?.message ?? 'Stock Taking belum tersimpan. Isian Anda tetap ada — coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: STICKY_FOOTER_SPACE, maxWidth: 900, width: '100%', alignSelf: 'center' }}
      >
        <SectionHeader title="Stock Taking" subtitle="Jumlah stok di rak dan gudang toko, per produk" />
        <DraftNotice
          savedAt={saved.restoredAt}
          onDiscard={() => {
            void saved.discard();
            setDraft(EMPTY);
          }}
        />

        {reportedList.length > 0 && (
          <Card>
            <H>{`Sudah dikirim di kunjungan ini (${reportedList.length} produk)`}</H>
            <Muted style={{ marginTop: 2 }}>
              {reportedList.map((r) => `${r.sku}: ${r.qtyOnHand}${r.outOfStock ? ' (stok habis)' : ''}`).join(' · ')}
            </Muted>
          </Card>
        )}

        <ProductQtyList
          lines={lines}
          reported={reported}
          isFilled={filled}
          onAddManual={(sku) => setDraft((d) => ({ ...d, manual: [...d.manual, { sku, label: sku, manual: true }] }))}
          renderControls={(l) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap' }}>
              <QtyStepper value={draft.qty[l.sku] ?? ''} onChange={(v) => setQty(l.sku, v)} label={`Stok ${l.label}`} />
              <Chip label="Stok habis" active={!!draft.oos[l.sku]} color={C.warnStrong} onPress={() => toggleOos(l.sku)} />
            </View>
          )}
        />

        <Card>
          <H>Foto rak / gudang (opsional)</H>
          <Muted style={{ marginTop: 2 }}>Satu foto untuk seluruh Stock Taking kunjungan ini.</Muted>
          <EvidencePhotoField uri={draft.photoUri} onChange={(photoUri) => setDraft((d) => ({ ...d, photoUri }))} />
        </Card>

        {me.role !== 'nc' && (
          <Card>
            <Badge label="Info" color={C.info} />
            <Muted style={{ marginTop: 6 }}>Stock Taking diisi oleh NC pemilik kunjungan.</Muted>
          </Card>
        )}
      </ScrollView>

      <StickyFooter>
        <Btn
          title={validLines.length ? `Simpan Stock Taking (${validLines.length} produk)` : 'Isi jumlah produk dulu'}
          onPress={submit}
          disabled={!canSubmit}
          loading={busy}
        />
      </StickyFooter>
    </View>
  );
}
