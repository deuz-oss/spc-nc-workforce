import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import { Badge, Btn, Card, Chip, Empty, Field, H, Input, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { confirmSkippedRows, SkuPicker } from '../components/SkuPicker';
import { EvidencePhotoField } from '../components/EvidencePhotoField';
import { C, F } from '../theme';
import { reportedSkus, ShownError, useCurrentUser, useStore } from '../store/useStore';

/** One in-progress Stock Taking row (PRD §5.1) before submit — not yet a StockTakingRow. */
interface DraftRow {
  key: string;
  sku: string;
  label: string; // product name if picked from master, else the sku itself
  qty: string; // kept as string for a controllable numeric input
  outOfStock: boolean;
  manual: boolean; // true if not from the product master (free-text fallback)
}

export default function StockTakingScreen() {
  const route = useAppRoute<'StockTaking'>();
  const navigation = useNavigation();
  const me = useCurrentUser()!;
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const submitStockTaking = useStore((s) => s.submitStockTaking);

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickedSkus = useMemo(() => new Set(rows.map((r) => r.sku.toLowerCase())), [rows]);
  // One report per visit per SKU (a second one would double the numbers):
  // SKUs already sent for this visit are listed, not offered again.
  const allReported = useStore((s) => s.stockTakingRows);
  const reportedList = useMemo(() => allReported.filter((r) => r.visitId === visitId), [allReported, visitId]);
  const reported = useMemo(() => reportedSkus(reportedList, visitId), [reportedList, visitId]);

  // SkuPicker only offers SKUs that are neither in the form nor already reported.
  const addProduct = (sku: string, label: string, manual: boolean) => {
    setRows((r) => [...r, { key: sku + Date.now(), sku, label, qty: '', outOfStock: false, manual }]);
  };

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  };

  const removeRow = (key: string) => setRows((r) => r.filter((x) => x.key !== key));



  const validRows = rows.filter((r) => r.qty.trim() !== '' && Number(r.qty) >= 0);
  const canSubmit = validRows.length > 0 && !busy;

  const submit = async () => {
    if (!validRows.length) {
      showDialog('Belum lengkap', 'Isi minimal satu SKU dengan jumlah (boleh 0) sebelum menyimpan.');
      return;
    }
    const skipped = rows.filter((r) => !validRows.includes(r)).map((r) => r.sku);
    if (!(await confirmSkippedRows(skipped))) return;
    setBusy(true);
    try {
      const { queued } = await submitStockTaking(
        visitId,
        storeId,
        validRows.map((r) => ({ sku: r.sku, qtyOnHand: Number(r.qty), outOfStock: r.outOfStock })),
        photoUri ?? undefined,
      );
      // Saved offline: the store already told the user — just leave the form.
      if (queued) navigation.goBack();
      else showDialog('Stock Taking Tersimpan', undefined, [{ label: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      if (!(e instanceof ShownError)) showDialog('Gagal Menyimpan', e?.message ?? 'Tidak dapat menyimpan Stock Taking. Coba lagi.');
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
        <SectionHeader title="Stock Taking" subtitle="Harian · quantity on hand per SKU (PRD §5.1)" />

        {reportedList.length > 0 && (
          <Card>
            <H>Sudah Dilaporkan di Kunjungan Ini ({reportedList.length} SKU)</H>
            <Muted style={{ marginTop: 2 }}>{reportedList.map((r) => `${r.sku}: ${r.qtyOnHand}${r.outOfStock ? ' (OOS)' : ''}`).join(' · ')}</Muted>
          </Card>
        )}

        <SkuPicker picked={pickedSkus} reported={reported} onAdd={addProduct} />

        <Card>
          <H>SKU Dipilih ({rows.length})</H>
          {rows.length === 0 ? (
            <Empty text="Belum ada SKU dipilih." />
          ) : (
            <View style={{ gap: 10, marginTop: 10 }}>
              {rows.map((r) => (
                <View key={r.key} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, gap: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.text }} numberOfLines={1}>
                        {r.label}
                      </Text>
                      <Text style={{ fontFamily: F.reg, fontSize: 11.5, color: C.muted }}>
                        {r.sku}
                        {r.manual ? ' · SKU manual' : ''}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => removeRow(r.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={{ color: C.accent, fontFamily: F.semi, fontSize: 12 }}>Hapus</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Input
                        placeholder="Qty on hand"
                        keyboardType="numeric"
                        value={r.qty}
                        onChangeText={(v) => updateRow(r.key, { qty: v.replace(/[^0-9.]/g, '') })}
                      />
                    </View>
                    <Chip
                      label="Out of Stock"
                      active={r.outOfStock}
                      color={C.warn}
                      onPress={() => updateRow(r.key, { outOfStock: !r.outOfStock, qty: r.outOfStock ? r.qty : '0' })}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <H>Foto Rak/Stockroom (opsional)</H>
          <Muted style={{ marginTop: 2 }}>Satu foto untuk seluruh laporan Stock Taking kunjungan ini.</Muted>
          <EvidencePhotoField uri={photoUri} onChange={setPhotoUri} />
        </Card>

        {me.role !== 'nc' && (
          <Card>
            <Badge label="Info" color={C.info} />
            <Muted style={{ marginTop: 6 }}>Stock Taking diisi oleh NC pemilik kunjungan.</Muted>
          </Card>
        )}
      </ScrollView>

      <StickyFooter>
        <Btn title={`Simpan Stock Taking (${validRows.length} SKU)`} onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
