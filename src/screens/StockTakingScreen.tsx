import React, { useMemo, useState } from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Badge, Btn, Card, Chip, Empty, Field, H, Input, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { C, F } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';

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
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const me = useCurrentUser()!;
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const allProducts = useStore((s) => s.products);
  // Filter outside the selector — a selector returning a new array each call is an unstable snapshot under zustand v5.
  const products = useMemo(() => allProducts.filter((p) => p.active), [allProducts]);
  const submitStockTaking = useStore((s) => s.submitStockTaking);

  const [query, setQuery] = useState('');
  const [manualSku, setManualSku] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
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
    setRows((r) => [...r, { key: sku + Date.now(), sku, label, qty: '', outOfStock: false, manual }]);
    setQuery('');
  };

  const addManual = () => {
    const sku = manualSku.trim();
    if (!sku) return;
    addProduct(sku, sku, true);
    setManualSku('');
  };

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  };

  const removeRow = (key: string) => setRows((r) => r.filter((x) => x.key !== key));

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

  const validRows = rows.filter((r) => r.qty.trim() !== '' && Number(r.qty) >= 0);
  const canSubmit = validRows.length > 0 && !busy;

  const submit = async () => {
    if (!validRows.length) {
      showDialog('Belum lengkap', 'Isi minimal satu SKU dengan jumlah (boleh 0) sebelum menyimpan.');
      return;
    }
    setBusy(true);
    try {
      await submitStockTaking(
        visitId,
        storeId,
        validRows.map((r) => ({ sku: r.sku, qtyOnHand: Number(r.qty), outOfStock: r.outOfStock })),
        photoUri ?? undefined,
      );
      showDialog('Stock Taking Tersimpan', undefined, [{ label: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      showDialog('Gagal Menyimpan', e?.message ?? 'Tidak dapat menyimpan Stock Taking. Coba lagi.');
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
