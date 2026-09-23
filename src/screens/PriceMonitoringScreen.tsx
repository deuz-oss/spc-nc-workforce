import React, { useMemo, useState } from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Btn, Card, Empty, Field, H, Input, Muted, SectionHeader, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { C, F } from '../theme';
import { useStore } from '../store/useStore';

interface DraftRow {
  key: string;
  sku: string;
  label: string;
  ownPrice: string;
  competitor1: string;
  competitor2: string;
  competitor3: string;
  manual: boolean;
}

/** Price Monitoring (PRD §5.6) — optional photo, up to 3 competitor prices per SKU. */
export default function PriceMonitoringScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const visitId: string = route.params?.visitId;
  const storeId: string = route.params?.storeId;

  const products = useStore((s) => s.products.filter((p) => p.active));
  const submitPriceMonitoring = useStore((s) => s.submitPriceMonitoring);

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
    setRows((r) => [...r, { key: sku + Date.now(), sku, label, ownPrice: '', competitor1: '', competitor2: '', competitor3: '', manual }]);
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

  const validRows = rows.filter((r) => r.ownPrice.trim() !== '' && Number(r.ownPrice) >= 0);
  const canSubmit = validRows.length > 0 && !busy;

  const submit = async () => {
    if (!validRows.length) {
      showDialog('Belum lengkap', 'Isi minimal satu SKU dengan harga sendiri (boleh 0) sebelum menyimpan.');
      return;
    }
    setBusy(true);
    try {
      await submitPriceMonitoring(
        visitId,
        storeId,
        validRows.map((r) => ({
          sku: r.sku,
          ownPrice: Number(r.ownPrice),
          competitorPrices: [r.competitor1, r.competitor2, r.competitor3]
            .filter((v) => v.trim() !== '')
            .map(Number)
            .filter((n) => isFinite(n) && n >= 0),
        })),
        photoUri ?? undefined,
      );
      showDialog('Price Monitoring Tersimpan', undefined, [{ label: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      if (e?.message && e.message !== 'Tidak ada koneksi internet.') {
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
        <SectionHeader title="Price Monitoring" subtitle="Bi-weekly · harga sendiri vs kompetitor (PRD §5.6)" />

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
                  <Field label="Harga Sendiri">
                    <Input
                      placeholder="0"
                      keyboardType="numeric"
                      value={r.ownPrice}
                      onChangeText={(v) => updateRow(r.key, { ownPrice: v.replace(/[^0-9.]/g, '') })}
                    />
                  </Field>
                  <Text style={{ fontFamily: F.semi, fontSize: 11.5, color: C.muted, marginTop: 2 }}>Harga Kompetitor (opsional, maks. 3)</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Input
                      placeholder="Kompetitor 1"
                      keyboardType="numeric"
                      style={{ flex: 1 }}
                      value={r.competitor1}
                      onChangeText={(v) => updateRow(r.key, { competitor1: v.replace(/[^0-9.]/g, '') })}
                    />
                    <Input
                      placeholder="Kompetitor 2"
                      keyboardType="numeric"
                      style={{ flex: 1 }}
                      value={r.competitor2}
                      onChangeText={(v) => updateRow(r.key, { competitor2: v.replace(/[^0-9.]/g, '') })}
                    />
                    <Input
                      placeholder="Kompetitor 3"
                      keyboardType="numeric"
                      style={{ flex: 1 }}
                      value={r.competitor3}
                      onChangeText={(v) => updateRow(r.key, { competitor3: v.replace(/[^0-9.]/g, '') })}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <H>Foto (opsional)</H>
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
        <Btn title={`Simpan Price Monitoring (${validRows.length} SKU)`} onPress={submit} disabled={!canSubmit} loading={busy} />
      </StickyFooter>
    </View>
  );
}
