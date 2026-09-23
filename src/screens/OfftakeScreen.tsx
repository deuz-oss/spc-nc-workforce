import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Btn, Card, Empty, Field, H, Input, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { C, F } from '../theme';
import { useStore } from '../store/useStore';

interface DraftRow {
  key: string;
  sku: string;
  label: string;
  units: string;
  revenue: string;
  manual: boolean;
}

export default function OfftakeScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const allProducts = useStore((s) => s.products);
  // Filter outside the selector — a selector returning a new array each call is an unstable snapshot under zustand v5.
  const products = useMemo(() => allProducts.filter((p) => p.active), [allProducts]);
  const submitOfftake = useStore((s) => s.submitOfftake);

  const [query, setQuery] = useState('');
  const [manualSku, setManualSku] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  const pickedSkus = useMemo(() => new Set(rows.map((r) => r.sku.toLowerCase())), [rows]);
  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((p) => !pickedSkus.has(p.sku.toLowerCase()))
      .filter((p) => !needle || p.sku.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [products, query, pickedSkus]);

  const addProduct = (sku: string, label: string, manual: boolean) => {
    if (pickedSkus.has(sku.toLowerCase())) return;
    setRows((r) => [...r, { key: sku + Date.now(), sku, label, units: '', revenue: '', manual }]);
    setQuery('');
  };

  const addManual = () => {
    const sku = manualSku.trim();
    if (!sku) return;
    addProduct(sku, sku, true);
    setManualSku('');
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
      if (res.outlierSkus.length) {
        showDialog(
          'Offtake Tersimpan — Ada SKU Ditandai',
          `SKU berikut ditandai outlier (>3x rata-rata 7 hari terakhir) untuk ditinjau TL: ${res.outlierSkus.join(', ')}.`,
          [{ label: 'OK', onPress: () => navigation.goBack() }],
        );
      } else {
        showDialog('Offtake Tersimpan', undefined, [{ label: 'OK', onPress: () => navigation.goBack() }]);
      }
    } catch (e: any) {
      showDialog('Gagal Menyimpan', e?.message ?? 'Tidak dapat menyimpan Offtake. Coba lagi.');
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
        <SectionHeader title="Offtake" subtitle="Harian · unit terjual per SKU (PRD §5.3)" />

        <Card>
          <Field label="Cari SKU dari master produk">
            <Input placeholder="Cari kode SKU atau nama produk..." value={query} onChangeText={setQuery} />
          </Field>
          {query.trim().length > 0 && (
            <View style={{ marginTop: 8, gap: 6 }}>
              {suggestions.length === 0 ? (
                <Muted>Tidak ditemukan di master produk.</Muted>
              ) : (
                suggestions.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => addProduct(p.sku, p.name, false)}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                  >
                    <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.text }}>{p.name}</Text>
                    <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.muted }}>{p.sku}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label="SKU tidak terdaftar di master produk">
                <Input placeholder="Ketik kode SKU manual..." value={manualSku} onChangeText={setManualSku} />
              </Field>
            </View>
            <Btn small variant="outline" title="Tambah" onPress={addManual} />
          </View>
        </Card>

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
