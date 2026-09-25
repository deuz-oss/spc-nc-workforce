import React, { useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, Chip, Field, H, Input, Muted } from './ui';
import { showDialog } from './dialog';
import { CATEGORY_LABEL } from '../config';
import { C } from '../theme';
import { useStore } from '../store/useStore';
import { Store, StoreCategory } from '../types';
import { parseLatLng } from '../utils/geo';
import { LocationPermissionDeniedError, requestCurrentCoords } from '../utils/location';

/**
 * Edit a store's master data, including its GPS pin (PRD §5 geofence). A store
 * without a pin can never produce a geo-valid visit, so "Pakai Lokasi Saya
 * Sekarang" lets a TL/ARCO standing in the store set it in one tap. Write
 * access follows stores_update RLS (super_admin/admin_data_entry: any store;
 * TL/ARCO: their own team's stores).
 */
export function StoreEditForm({ store, onDone }: { store: Store; onDone: () => void }) {
  const upsertStore = useStore((s) => s.upsertStore);
  const [name, setName] = useState(store.name);
  const [address, setAddress] = useState(store.address);
  const [city, setCity] = useState(store.city);
  const [channel, setChannel] = useState(store.channel);
  const [account, setAccount] = useState(store.account ?? '');
  const [category, setCategory] = useState<StoreCategory>(store.category);
  const [lat, setLat] = useState(store.lat != null ? String(store.lat) : '');
  const [lng, setLng] = useState(store.lng != null ? String(store.lng) : '');
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);

  const pin = parseLatLng(lat, lng);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const c = await requestCurrentCoords();
      setLat(c.lat.toFixed(6));
      setLng(c.lng.toFixed(6));
    } catch (e) {
      const denied = e instanceof LocationPermissionDeniedError;
      showDialog(
        denied ? 'Izin lokasi diperlukan' : 'Gagal',
        denied ? 'Aktifkan izin lokasi untuk mengambil titik toko.' : 'Tidak dapat mengambil lokasi. Coba lagi.',
      );
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return showDialog('Belum lengkap', 'Nama toko wajib diisi.');
    if (pin === 'invalid') {
      return showDialog(
        'Koordinat tidak valid',
        'Isi latitude dan longitude keduanya (mis. -6.208763 dan 106.845599), atau kosongkan keduanya.',
      );
    }
    setBusy(true);
    try {
      await upsertStore({
        ...store,
        name: name.trim(),
        address: address.trim(),
        city: city.trim(),
        channel: channel.trim(),
        account: account.trim() || undefined,
        category,
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <H>Ubah Data Toko</H>
      <Field label="Nama Toko">
        <Input value={name} onChangeText={setName} />
      </Field>
      <Field label="Alamat">
        <Input value={address} onChangeText={setAddress} multiline />
      </Field>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Kota">
            <Input value={city} onChangeText={setCity} />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Channel">
            <Input value={channel} onChangeText={setChannel} placeholder="DMS / LMT / MTI" />
          </Field>
        </View>
      </View>
      <Field label="Account (opsional)">
        <Input value={account} onChangeText={setAccount} />
      </Field>
      <Field label="Kategori">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['premium', 'super_premium'] as StoreCategory[]).map((c) => (
            <Chip key={c} label={CATEGORY_LABEL[c]} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
      </Field>
      <Field label="Titik GPS Toko (untuk geofence check-in)">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Input value={lat} onChangeText={setLat} placeholder="Latitude, mis. -6.208763" keyboardType="numbers-and-punctuation" />
          </View>
          <View style={{ flex: 1 }}>
            <Input value={lng} onChangeText={setLng} placeholder="Longitude, mis. 106.845599" keyboardType="numbers-and-punctuation" />
          </View>
        </View>
      </Field>
      {pin === 'invalid' && <Muted style={{ color: C.accent }}>Koordinat tidak valid.</Muted>}
      {pin === null && (
        <Muted style={{ color: C.warn }}>Tanpa titik GPS, kunjungan ke toko ini tidak pernah terhitung geo-valid.</Muted>
      )}
      <View style={{ alignSelf: 'flex-start' }}>
        <Btn small variant="outline" title="Pakai Lokasi Saya Sekarang" onPress={useMyLocation} disabled={locating} loading={locating} />
      </View>
      <Muted>Gunakan tombol di atas hanya saat berada di dalam/di depan toko.</Muted>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn title="Simpan" onPress={save} disabled={busy} loading={busy} />
        <Btn variant="outline" title="Batal" onPress={onDone} />
      </View>
    </Card>
  );
}
