import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppRoute } from '../navigation';
import { Btn, Card, Empty, Field, H, Input, Muted, SectionHeader, StickyFooter, STICKY_FOOTER_SPACE } from '../components/ui';
import { showDialog } from '../components/dialog';
import { confirmSkippedRows, SkuPicker } from '../components/SkuPicker';
import { C, F } from '../theme';
import { reportedSkus, ShownError, useStore } from '../store/useStore';

interface DraftRow {
  key: string;
  sku: string;
  label: string;
  units: string;
  revenue: string;
  manual: boolean;
}

export default function OfftakeScreen() {
  const route = useAppRoute<'Offtake'>();
  const navigation = useNavigation();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const submitOfftake = useStore((s) => s.submitOfftake);

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  const pickedSkus = useMemo(() => new Set(rows.map((r) => r.sku.toLowerCase())), [rows]);
  // One report per visit per SKU (a second one would double the numbers):
  // SKUs already sent for this visit are listed, not offered again.
  const allReported = useStore((s) => s.offtakeRows);
  const reportedList = useMemo(() => allReported.filter((r) => r.visitId === visitId), [allReported, visitId]);
  const reported = useMemo(() => reportedSkus(reportedList, visitId), [reportedList, visitId]);

  // SkuPicker only offers SKUs that are neither in the form nor already reported.
  const addProduct = (sku: string, label: string, manual: boolean) => {
    setRows((r) => [...r, { key: sku + Date.now(), sku, label, units: '', revenue: '', manual }]);
  };

  const updateRow = (key: string, patch: Partial<DraftRow>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const removeRow = (key: string) => setRows((r) => r.filter((x) => x.key !== key));

  const validRows = rows.filter((r) => r.units.trim() !== '' && Number(r.units) >= 0);
  const canSubmit = validRows.length > 0 && !busy;

  const submit = async () => {
    if (!validRows.length) {
      showDialog('Belum lengkap', 'Isi minimal satu SKU dengan unit terjual (boleh 0) sebelum menyimpan.');
      return;
    }
    const skipped = rows.filter((r) => !validRows.includes(r)).map((r) => r.sku);
    if (!(await confirmSkippedRows(skipped))) return;
    setBusy(true);
    try {
      const res = await submitOfftake(
        visitId,
        storeId,
        validRows.map((r) => ({
          sku: r.sku,
          unitsSold: Number(r.units),
          revenue: r.revenue.trim() ? Number(r.revenue) : undefined,
        })),
      );
      if (res.queued) {
        navigation.goBack(); // saved offline — the store already told the user
      } else if (res.outlierSkus.length) {
        showDialog(
          'Offtake Tersimpan — Ada SKU Ditandai',
          `SKU berikut ditandai outlier (>3x rata-rata 7 hari terakhir) untuk ditinjau TL: ${res.outlierSkus.join(', ')}.`,
          [{ label: 'OK', onPress: () => navigation.goBack() }],
        );
      } else {
        showDialog('Offtake Tersimpan', undefined, [{ label: 'OK', onPress: () => navigation.goBack() }]);
      }
    } catch (e: any) {
      if (!(e instanceof ShownError)) showDialog('Gagal Menyimpan', e?.message ?? 'Tidak dapat menyimpan Offtake. Coba lagi.');
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
        <SectionHeader title="Offtake" subtitle="Harian · unit terjual per SKU (PRD §5.3)" />

        {reportedList.length > 0 && (
          <Card>
            <H>Sudah Dilaporkan di Kunjungan Ini ({reportedList.length} SKU)</H>
            <Muted style={{ marginTop: 2 }}>{reportedList.map((r) => `${r.sku}: ${r.unitsSold} unit`).join(' · ')}</Muted>
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
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Input
                        placeholder="Unit terjual"
                        keyboardType="numeric"
                        value={r.units}
                        onChangeText={(v) => updateRow(r.key, { units: v.replace(/[^0-9.]/g, '') })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Input
                        placeholder="Revenue (opsional)"
                        keyboardType="numeric"
                        value={r.revenue}
                        onChangeText={(v) => updateRow(r.key, { revenue: v.replace(/[^0-9.]/g, '') })}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>
      </ScrollView>

      <StickyFooter>
        <Btn title={`Simpan Offtake (${validRows.length} SKU)`} onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
