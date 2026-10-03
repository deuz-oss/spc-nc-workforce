import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import { Btn, Card, H, Input, Muted, SectionHeader, StickyFooter, STICKY_FOOTER_SPACE } from '../components/ui';
import { showDialog, showToast } from '../components/dialog';
import { confirmSkippedRows } from '../components/SkuPicker';
import { ProductLine, ProductQtyList, useProductLines } from '../components/ProductQtyList';
import { QtyStepper } from '../components/QtyStepper';
import { DraftNotice } from '../components/DraftNotice';
import { draftKey, useDraft } from '../components/useDraft';
import { SP } from '../theme';
import { reportedSkus, ShownError, useStore } from '../store/useStore';

/** What the user has entered so far — also the saved draft. */
interface Draft {
  units: Record<string, string>; // per SKU; '' / missing = not filled
  revenue: Record<string, string>;
  manual: ProductLine[];
}
const EMPTY: Draft = { units: {}, revenue: {}, manual: [] };
const isEmptyDraft = (d: Draft) =>
  !d.manual.length && !Object.values(d.units).some((v) => v !== '') && !Object.values(d.revenue).some((v) => v !== '');

/** Offtake (PRD §5.3): units sold per SKU, optional revenue. */
export default function OfftakeScreen() {
  const route = useAppRoute<'Offtake'>();
  const navigation = useNavigation();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const submitOfftake = useStore((s) => s.submitOfftake);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const saved = useDraft(draftKey(visitId, 'offtake'), draft, setDraft, isEmptyDraft);

  // One report per visit per SKU (a second one would double the numbers):
  // SKUs already sent for this visit are listed, not offered again.
  const allReported = useStore((s) => s.offtakeRows);
  const reportedList = useMemo(() => allReported.filter((r) => r.visitId === visitId), [allReported, visitId]);
  const reported = useMemo(() => reportedSkus(reportedList, visitId), [reportedList, visitId]);
  const lines = useProductLines(reported, draft.manual);

  const filled = (sku: string) => (draft.units[sku] ?? '') !== '';
  const validLines = lines.filter((l) => filled(l.sku));
  const canSubmit = validLines.length > 0 && !busy;

  const submit = async () => {
    if (!validLines.length) {
      showDialog('Belum Ada Jumlah', 'Isi unit terjual minimal satu produk (boleh 0) sebelum menyimpan.');
      return;
    }
    const skipped = draft.manual.filter((m) => !filled(m.sku)).map((m) => m.sku);
    if (!(await confirmSkippedRows(skipped))) return;
    setBusy(true);
    try {
      const res = await submitOfftake(
        visitId,
        storeId,
        validLines.map((l) => {
          const revenue = (draft.revenue[l.sku] ?? '').trim();
          return { sku: l.sku, unitsSold: Number(draft.units[l.sku]), revenue: revenue ? Number(revenue) : undefined };
        }),
      );
      await saved.clear();
      if (res.queued) {
        navigation.goBack(); // saved offline — the store already told the user
      } else if (res.outlierSkus.length) {
        showDialog(
          'Offtake Tersimpan — Perlu Dicek TL',
          `Angka produk berikut jauh di atas biasanya (lebih dari 3x rata-rata 7 hari) dan akan dicek TL: ${res.outlierSkus.join(', ')}.`,
          [{ label: 'OK', onPress: () => navigation.goBack() }],
        );
      } else {
        showToast('Offtake tersimpan');
        navigation.goBack();
      }
    } catch (e: any) {
      if (!(e instanceof ShownError)) showDialog('Gagal Menyimpan', e?.message ?? 'Offtake belum tersimpan. Isian Anda tetap ada — coba lagi.');
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
        <SectionHeader title="Offtake" subtitle="Unit terjual hari ini, per produk" />
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
            <Muted style={{ marginTop: 2 }}>{reportedList.map((r) => `${r.sku}: ${r.unitsSold} unit`).join(' · ')}</Muted>
          </Card>
        )}

        <ProductQtyList
          lines={lines}
          reported={reported}
          isFilled={filled}
          onAddManual={(sku) => setDraft((d) => ({ ...d, manual: [...d.manual, { sku, label: sku, manual: true }] }))}
          renderControls={(l) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap' }}>
              <QtyStepper
                value={draft.units[l.sku] ?? ''}
                onChange={(v) => setDraft((d) => ({ ...d, units: { ...d.units, [l.sku]: v } }))}
                label={`Unit terjual ${l.label}`}
              />
              <View style={{ flex: 1, minWidth: 140 }}>
                <Input
                  placeholder="Penjualan Rp (opsional)"
                  keyboardType="numeric"
                  value={draft.revenue[l.sku] ?? ''}
                  onChangeText={(v) => setDraft((d) => ({ ...d, revenue: { ...d.revenue, [l.sku]: v.replace(/[^0-9.]/g, '') } }))}
                  accessibilityLabel={`Nilai penjualan ${l.label}, opsional`}
                />
              </View>
            </View>
          )}
        />
      </ScrollView>

      <StickyFooter>
        <Btn
          title={validLines.length ? `Simpan Offtake (${validLines.length} produk)` : 'Isi unit terjual dulu'}
          onPress={submit}
          disabled={!canSubmit}
          loading={busy}
        />
      </StickyFooter>
    </View>
  );
}
