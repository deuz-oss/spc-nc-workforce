import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Btn, Card, Field, Input, Muted } from './ui';
import { showDialog } from './dialog';
import { C, F } from '../theme';
import { useStore } from '../store/useStore';

/**
 * SKU search + manual entry for the per-SKU report forms (Stock Taking,
 * Offtake, Price Monitoring). Offers active products from the product master,
 * minus SKUs already in the form (`picked`) and already reported for this
 * visit (`reported` — one report per visit per SKU, migration 0013). SKUs are
 * compared lower-cased.
 */
export function SkuPicker({
  picked,
  reported,
  onAdd,
}: {
  picked: Set<string>;
  reported: Set<string>;
  onAdd: (sku: string, label: string, manual: boolean) => void;
}) {
  const allProducts = useStore((s) => s.products);
  // Filter outside the selector — a selector returning a new array each call is an unstable snapshot under zustand v5.
  const products = useMemo(() => allProducts.filter((p) => p.active), [allProducts]);
  const [query, setQuery] = useState('');
  const [manualSku, setManualSku] = useState('');

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((p) => !picked.has(p.sku.toLowerCase()) && !reported.has(p.sku.toLowerCase()))
      .filter((p) => !needle || p.sku.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [products, query, picked, reported]);

  const add = (sku: string, label: string, manual: boolean) => {
    const key = sku.toLowerCase();
    if (picked.has(key)) return;
    if (reported.has(key)) {
      showDialog('Sudah Dilaporkan', `SKU ${sku} sudah dilaporkan di kunjungan ini.`);
      return;
    }
    onAdd(sku, label, manual);
    setQuery('');
  };

  const addManual = () => {
    const sku = manualSku.trim();
    if (!sku) return;
    add(sku, sku, true);
    setManualSku('');
  };

  return (
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
                onPress={() => add(p.sku, p.name, false)}
                accessibilityRole="button"
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
  );
}

/**
 * Before saving a per-SKU report: rows the user added but left without a
 * value would otherwise be dropped silently. Resolves true to save only the
 * filled rows, false to go back and fill them in.
 */
export function confirmSkippedRows(skipped: string[]): Promise<boolean> {
  if (!skipped.length) return Promise.resolve(true);
  return new Promise((resolve) =>
    showDialog(
      `${skipped.length} SKU Belum Diisi`,
      `SKU berikut belum diisi dan TIDAK akan ikut tersimpan: ${skipped.join(', ')}. SKU yang sudah dilaporkan tidak bisa ditambah lagi di kunjungan ini.`,
      [
        { label: 'Kembali & Isi', onPress: () => resolve(false) },
        { label: 'Simpan Tanpa SKU Itu', onPress: () => resolve(true) },
      ],
    ),
  );
}
