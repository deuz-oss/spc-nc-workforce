import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Btn, Card, Field, H, Input, Muted } from './ui';
import { showDialog } from './dialog';
import { C, R, SP, T } from '../theme';
import { useStore } from '../store/useStore';

/** One product line of a per-SKU report: from the product master, or typed in by hand. */
export interface ProductLine {
  sku: string;
  label: string;
  manual: boolean;
}

const SEARCH_FROM = 8;

/**
 * Active master products not yet reported for this visit (one report per visit
 * per SKU, migration 0013), followed by the SKUs the user typed in by hand.
 * SKUs are compared lower-cased.
 */
export function useProductLines(reported: Set<string>, manual: ProductLine[]): ProductLine[] {
  const products = useStore((s) => s.products);
  return useMemo(() => {
    const manualKeys = new Set(manual.map((m) => m.sku.toLowerCase()));
    const fromMaster = products
      .filter((p) => p.active && !reported.has(p.sku.toLowerCase()) && !manualKeys.has(p.sku.toLowerCase()))
      .map((p) => ({ sku: p.sku, label: p.name, manual: false }));
    return [...fromMaster, ...manual];
  }, [products, reported, manual]);
}

/**
 * Every product as a row with its own controls (quantity stepper etc.), so the
 * NC fills counts straight down the list instead of searching SKU by SKU. A
 * search box appears once the list is long; untouched rows are not saved.
 */
export function ProductQtyList({
  lines,
  reported,
  isFilled,
  renderControls,
  onAddManual,
}: {
  lines: ProductLine[];
  reported: Set<string>;
  isFilled: (sku: string) => boolean;
  renderControls: (line: ProductLine) => React.ReactNode;
  onAddManual: (sku: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [manualSku, setManualSku] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? lines.filter((l) => l.sku.toLowerCase().includes(needle) || l.label.toLowerCase().includes(needle))
    : lines;
  const filledCount = lines.filter((l) => isFilled(l.sku)).length;

  const addManual = () => {
    const sku = manualSku.trim();
    if (!sku) return;
    const key = sku.toLowerCase();
    if (reported.has(key)) {
      showDialog('Sudah Dilaporkan', `Produk ${sku} sudah dilaporkan di kunjungan ini.`);
      return;
    }
    if (lines.some((l) => l.sku.toLowerCase() === key)) {
      setQuery(sku);
      setManualSku('');
      return;
    }
    onAddManual(sku);
    setManualSku('');
  };

  return (
    <Card style={{ gap: SP.md }}>
      <View>
        <H>{`Produk (${filledCount} dari ${lines.length} diisi)`}</H>
        <Muted style={{ marginTop: 2 }}>Isi jumlah untuk produk yang ada di toko. Produk yang dibiarkan kosong tidak ikut dikirim.</Muted>
      </View>
      {lines.length > SEARCH_FROM && (
        <Input placeholder="Cari nama atau kode produk..." value={query} onChangeText={setQuery} accessibilityLabel="Cari produk" />
      )}
      {lines.length === 0 ? (
        <Muted>Belum ada produk di master produk. Tambahkan kode produk di bawah.</Muted>
      ) : shown.length === 0 ? (
        <Muted>{`Tidak ada produk yang cocok dengan "${query.trim()}".`}</Muted>
      ) : (
        shown.map((l) => (
          <View
            key={l.sku}
            style={{
              gap: SP.sm,
              padding: SP.md,
              borderRadius: R.input,
              borderWidth: 1,
              borderColor: isFilled(l.sku) ? C.primaryText : C.border,
              backgroundColor: isFilled(l.sku) ? C.surfaceAlt : C.card,
            }}
          >
            <View>
              <Text style={T.h3} numberOfLines={2}>
                {l.label}
              </Text>
              <Text style={T.small}>{l.manual ? `${l.sku} · ditambah manual` : l.sku}</Text>
            </View>
            {renderControls(l)}
          </View>
        ))
      )}
      <Field label="Produk tidak ada di daftar?">
        <View style={{ flexDirection: 'row', gap: SP.sm, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Input placeholder="Ketik kode produk" value={manualSku} onChangeText={setManualSku} onSubmitEditing={addManual} autoCapitalize="characters" />
          </View>
          <Btn variant="outline" title="Tambah" onPress={addManual} disabled={!manualSku.trim()} />
        </View>
      </Field>
    </Card>
  );
}
