import React, { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Badge, Btn, Card, Chip, Empty, Field, Input, Muted, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { PRODUCT_MANAGER_ROLES } from '../config';
import { C, F } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { Product } from '../types';

/**
 * Product master (PRD §5.1 SKU picklist) for super_admin / admin_data_entry /
 * data_analyst (products RLS write policy, 0003). Before this screen the
 * master could only grow via CSV import — a discontinued SKU stayed in every
 * NC's Stock Taking / Offtake / Price Monitoring picker forever. Deactivating
 * hides it from pickers; SKU codes are read-only because submitted reports
 * reference them as plain text (no FK), so renaming a code would orphan history.
 */

function ProductEditRow({ product, onDone }: { product: Product; onDone: () => void }) {
  const upsertProduct = useStore((s) => s.upsertProduct);
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return showDialog('Belum lengkap', 'Nama produk wajib diisi.');
    setBusy(true);
    try {
      await upsertProduct({ ...product, name: name.trim(), category: category.trim() || undefined });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Field label="Nama Produk">
        <Input value={name} onChangeText={setName} />
      </Field>
      <Field label="Kategori (opsional)">
        <Input value={category} onChangeText={setCategory} />
      </Field>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn small title="Simpan" onPress={save} disabled={busy} loading={busy} />
        <Btn small variant="outline" title="Batal" onPress={onDone} />
      </View>
    </View>
  );
}

function AddProductForm({ onDone }: { onDone: () => void }) {
  const addProductsBulk = useStore((s) => s.addProductsBulk);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await addProductsBulk([{ sku, name, category }]);
      if (res.errors.length) return showDialog('Gagal Menambah Produk', res.errors.join('\n'));
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <SectionHeader title="Tambah Produk" subtitle="Untuk banyak SKU sekaligus, gunakan Impor CSV" />
      <Field label="Kode SKU (tidak bisa diubah setelah disimpan)">
        <Input value={sku} onChangeText={setSku} autoCapitalize="characters" placeholder="mis. ENF-A-400" />
      </Field>
      <Field label="Nama Produk">
        <Input value={name} onChangeText={setName} placeholder="mis. Enfagrow A+ 400g" />
      </Field>
      <Field label="Kategori (opsional)">
        <Input value={category} onChangeText={setCategory} />
      </Field>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn title="Simpan" onPress={save} disabled={busy || !sku.trim() || !name.trim()} loading={busy} />
        <Btn variant="outline" title="Batal" onPress={onDone} />
      </View>
    </Card>
  );
}

export default function ProductsScreen() {
  const me = useCurrentUser()!;
  const navigation = useNavigation<any>();
  const products = useStore((s) => s.products);
  const upsertProduct = useStore((s) => s.upsertProduct);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const counts = useMemo(
    () => ({ active: products.filter((p) => p.active).length, inactive: products.filter((p) => !p.active).length }),
    [products],
  );
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .filter((p) => filter === 'all' || (filter === 'active') === p.active)
      .filter((p) => !needle || p.sku.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, q, filter]);

  if (!PRODUCT_MANAGER_ROLES.includes(me.role)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Muted>Hanya Super Admin, Admin Data Entry, dan Data Analyst yang dapat mengelola master produk.</Muted>
      </View>
    );
  }

  const toggleActive = (p: Product) =>
    showDialog(
      p.active ? 'Nonaktifkan produk?' : 'Aktifkan produk?',
      p.active
        ? `${p.name} (${p.sku}) tidak akan muncul lagi di pilihan SKU NC. Laporan lama tetap tersimpan.`
        : `${p.name} (${p.sku}) akan muncul lagi di pilihan SKU NC.`,
      [
        { label: 'Batal' },
        { label: p.active ? 'Nonaktifkan' : 'Aktifkan', destructive: p.active, onPress: () => void upsertProduct({ ...p, active: !p.active }) },
      ],
    );

  return (
    <FlatList
      role="main"
      data={visible}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: 16, gap: 10, maxWidth: 900, width: '100%', alignSelf: 'center' }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 10, paddingBottom: 2 }}>
          <SectionHeader
            title={`Master Produk (${products.length})`}
            subtitle="SKU untuk pilihan Stock Taking, Offtake & Price Monitoring"
            action={adding ? undefined : { label: '+ Produk', onPress: () => setAdding(true) }}
          />
          <View style={{ alignSelf: 'flex-start' }}>
            <Btn small variant="outline" title="Impor CSV" onPress={() => navigation.navigate('Import')} />
          </View>
          {adding && <AddProductForm onDone={() => setAdding(false)} />}
          <Input placeholder="Cari SKU atau nama produk..." value={q} onChangeText={setQ} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label={`Aktif (${counts.active})`} active={filter === 'active'} onPress={() => setFilter('active')} />
            <Chip label={`Nonaktif (${counts.inactive})`} active={filter === 'inactive'} onPress={() => setFilter('inactive')} />
            <Chip label="Semua" active={filter === 'all'} onPress={() => setFilter('all')} />
          </View>
        </View>
      }
      ListEmptyComponent={<Empty text={products.length ? 'Tidak ada produk pada filter ini.' : 'Belum ada produk. Tambah atau impor CSV.'} />}
      renderItem={({ item: p }) => (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontFamily: F.semi, fontSize: 13.5, color: p.active ? C.text : C.muted }} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.muted }}>
                {p.sku}
                {p.category ? ` · ${p.category}` : ''}
              </Text>
            </View>
            <Badge label={p.active ? 'Aktif' : 'Nonaktif'} color={p.active ? C.ok : C.muted} />
          </View>
          {editingId === p.id ? (
            <ProductEditRow product={p} onDone={() => setEditingId(null)} />
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Btn small variant="outline" title="Ubah" onPress={() => setEditingId(p.id)} />
              <Btn small variant="outline" title={p.active ? 'Nonaktifkan' : 'Aktifkan'} onPress={() => toggleActive(p)} />
            </View>
          )}
        </Card>
      )}
    />
  );
}
