import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Badge, Btn, Card, Chip, Empty, H, Muted, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { CATEGORY_LABEL, STORE_MANAGER_ROLES, USER_MANAGER_ROLES } from '../config';
import { C, F } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { Role, Store } from '../types';
import { parseCsv } from '../utils/csv';
import { exportCsv } from '../utils/export';
import { uid } from '../utils/uuid';

// --- Store import -----------------------------------------------------------

interface StoreRow {
  name: string;
  address: string;
  city: string;
  channel: string;
  account?: string;
  category: Store['category'];
  lat: number | null;
  lng: number | null;
}

const STORE_TEMPLATE = `nama,alamat,kota,channel,account,kategori,lat,lng
Apotek Kimia Farma Sudirman,"Jl. Jend. Sudirman No.1",Jakarta Selatan,DMS,Kimia Farma,premium,-6.208763,106.845599
Baby Shop Mother Care,"Jl. Diponegoro No.5",Bandung,LMT,Mother Care,super_premium,-6.914744,107.609810`;

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of Object.keys(row)) {
    const norm = k.trim().toLowerCase();
    if (keys.includes(norm)) return (row[k] ?? '').trim();
  }
  return '';
}

function StoreImportSection() {
  const navigation = useNavigation<any>();
  const me = useCurrentUser()!;
  const users = useStore((s) => s.users);
  const upsertStore = useStore((s) => s.upsertStore);

  const [rows, setRows] = useState<StoreRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [ncId, setNcId] = useState<string | null>(null);

  const ncs = useMemo(() => users.filter((u) => u.role === 'nc' && u.active), [users]);
  const assignable = me.role === 'tl' ? ncs.filter((a) => a.teamId === me.teamId) : ncs;

  const downloadTemplate = () => exportCsv('template_toko', STORE_TEMPLATE);

  const readFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const asset: any = res.assets[0];
      let text = '';
      if (asset.file instanceof Blob) text = await asset.file.text();
      else text = await (await fetch(asset.uri)).text();

      const table = parseCsv(text);
      if (table.length < 2) {
        showDialog('File kosong atau tanpa baris data.');
        return;
      }
      const header = table[0].map((h) => h.toLowerCase());
      const out: StoreRow[] = [];
      const errs: string[] = [];
      table.slice(1).forEach((r, i) => {
        const obj: Record<string, string> = {};
        header.forEach((h, j) => (obj[h] = r[j] ?? ''));
        const name = pick(obj, ['nama', 'name', 'store', 'store_name']);
        if (!name) {
          errs.push(`Baris ${i + 2}: kolom "nama" kosong`);
          return;
        }
        const catRaw = pick(obj, ['kategori', 'category']).toLowerCase();
        const latS = pick(obj, ['lat', 'latitude']).replace(',', '.');
        const lngS = pick(obj, ['lng', 'lon', 'long', 'longitude']).replace(',', '.');
        const lat = latS ? parseFloat(latS) : null;
        const lng = lngS ? parseFloat(lngS) : null;
        out.push({
          name,
          address: pick(obj, ['alamat', 'address']),
          city: pick(obj, ['kota', 'city']),
          channel: pick(obj, ['channel']),
          account: pick(obj, ['account']) || undefined,
          category: catRaw.includes('super') ? 'super_premium' : 'premium',
          lat: lat != null && isFinite(lat) ? lat : null,
          lng: lng != null && isFinite(lng) ? lng : null,
        });
      });
      setRows(out);
      setErrors(errs);
    } catch {
      showDialog('Gagal membaca file CSV.');
    }
  };

  const doImport = () => {
    if (!rows?.length) return;
    const nc = ncId ? users.find((u) => u.id === ncId) : null;
    rows.forEach((r) => {
      upsertStore({
        id: uid('st_'),
        name: r.name,
        address: r.address,
        city: r.city,
        channel: r.channel,
        account: r.account,
        category: r.category,
        lat: r.lat,
        lng: r.lng,
        assignedNcId: nc?.id ?? null,
        teamId: nc?.teamId ?? me.teamId ?? null,
        source: 'imported',
        createdAt: Date.now(),
      });
    });
    showDialog(
      'Impor berhasil',
      `${rows.length} toko ditambahkan${nc ? ` dan di-assign ke ${nc.name}` : ' (belum di-assign)'}.`,
      [{ label: 'OK', onPress: () => navigation.goBack() }],
    );
  };

  if (!STORE_MANAGER_ROLES.includes(me.role)) {
    return (
      <Card>
        <Muted>Hanya Super Admin, Admin Data Entry, TL, dan ARCO yang dapat mengimpor toko.</Muted>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Muted>
          Format kolom CSV:{'\n'}
          <Text style={{ fontFamily: F.bold, color: C.text }}>nama, alamat, kota, channel, account, kategori, lat, lng</Text>
          {'\n'}Kolom wajib: nama. Kategori: premium / super_premium. Lat/lng opsional.
        </Muted>
        <View style={{ gap: 8, marginTop: 10 }}>
          <Btn small variant="outline" title="Unduh Template CSV" onPress={downloadTemplate} />
          <Btn small title="Pilih File CSV" onPress={readFile} />
        </View>
      </Card>

      {rows && (
        <>
          <Card>
            <SectionHeader
              title={`${rows.length} toko terbaca`}
              subtitle={assignable.length > 0 ? 'Pilih NC tujuan sebelum mengimpor (opsional)' : undefined}
            />
            {assignable.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                <Chip label="Tanpa assign" active={ncId == null} onPress={() => setNcId(null)} />
                {assignable.map((a) => (
                  <Chip key={a.id} label={a.name} active={ncId === a.id} onPress={() => setNcId(a.id)} />
                ))}
              </View>
            )}
            <View style={{ marginTop: 10 }}>
              <Btn title={`Impor ${rows.length} Toko`} onPress={doImport} />
            </View>
          </Card>

          {errors.length > 0 && (
            <Card>
              <H>{errors.length} baris dilewati</H>
              {errors.slice(0, 5).map((e) => (
                <Muted key={e}>{e}</Muted>
              ))}
            </Card>
          )}

          <Card>
            <H>Preview</H>
            {rows.length === 0 ? (
              <Empty text="Tidak ada data valid." />
            ) : (
              rows.slice(0, 10).map((r, i) => (
                <View
                  key={`${r.name}-${i}`}
                  style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: C.divider, flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}
                >
                  <View style={{ flexShrink: 1 }}>
                    <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.text }} numberOfLines={1}>{r.name}</Text>
                    <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>{r.city || '-'}</Text>
                  </View>
                  <Badge label={CATEGORY_LABEL[r.category]} color={C.info} />
                </View>
              ))
            )}
            {rows.length > 10 && <Muted style={{ marginTop: 6 }}>...dan {rows.length - 10} lainnya</Muted>}
          </Card>
        </>
      )}
    </>
  );
}

// --- Bulk account provisioning (PRD §13) ------------------------------------

interface UserRow {
  name: string;
  username: string;
  password: string;
  role: Role;
  city?: string;
  phone?: string;
}

const USER_TEMPLATE = `nama,username,password,role,kota,telepon
Siti Aminah,nc.siti,ganti123,nc,Jakarta Selatan,081200000001
Budi Santoso,tl.budi,ganti123,tl,Bandung,081200000002`;

const VALID_ROLES: Role[] = [
  'super_admin', 'reckitt_client', 'pm', 'arco', 'tl', 'nc', 'lead_trainer', 'trainer', 'data_analyst', 'admin_data_entry',
];

function UserImportSection() {
  const navigation = useNavigation<any>();
  const me = useCurrentUser()!;
  const addUsersBulk = useStore((s) => s.addUsersBulk);

  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);

  const downloadTemplate = () => exportCsv('template_akun', USER_TEMPLATE);

  const readFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const asset: any = res.assets[0];
      let text = '';
      if (asset.file instanceof Blob) text = await asset.file.text();
      else text = await (await fetch(asset.uri)).text();

      const table = parseCsv(text);
      if (table.length < 2) {
        showDialog('File kosong atau tanpa baris data.');
        return;
      }
      const header = table[0].map((h) => h.toLowerCase());
      const out: UserRow[] = [];
      const errs: string[] = [];
      table.slice(1).forEach((r, i) => {
        const obj: Record<string, string> = {};
        header.forEach((h, j) => (obj[h] = r[j] ?? ''));
        const name = pick(obj, ['nama', 'name']);
        const username = pick(obj, ['username']);
        const password = pick(obj, ['password']);
        const roleRaw = pick(obj, ['role', 'posisi']).toLowerCase() as Role;
        if (!name || !username || !password) {
          errs.push(`Baris ${i + 2}: nama/username/password kosong`);
          return;
        }
        if (!VALID_ROLES.includes(roleRaw)) {
          errs.push(`Baris ${i + 2}: role "${roleRaw}" tidak dikenal`);
          return;
        }
        out.push({
          name,
          username,
          password,
          role: roleRaw,
          city: pick(obj, ['kota', 'city']) || undefined,
          phone: pick(obj, ['telepon', 'phone']) || undefined,
        });
      });
      setRows(out);
      setErrors(errs);
      setResult(null);
    } catch {
      showDialog('Gagal membaca file CSV.');
    }
  };

  const doImport = async () => {
    if (!rows?.length) return;
    setImporting(true);
    try {
      const res = await addUsersBulk(rows.map((r) => ({ ...r, teamId: null })));
      setResult(res);
      if (res.errors.length === 0) {
        showDialog('Impor berhasil', `${res.created} akun dibuat.`, [{ label: 'OK', onPress: () => navigation.goBack() }]);
      }
    } finally {
      setImporting(false);
    }
  };

  if (!USER_MANAGER_ROLES.includes(me.role)) {
    return (
      <Card>
        <Muted>Hanya Super Admin yang dapat melakukan bulk account provisioning.</Muted>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Muted>
          Format kolom CSV:{'\n'}
          <Text style={{ fontFamily: F.bold, color: C.text }}>nama, username, password, role, kota, telepon</Text>
          {'\n'}Role valid: {VALID_ROLES.join(', ')}.{'\n'}
          Tim (teamId) diatur belakangan lewat layar Pengguna — impor CSV ini fokus pada penyediaan akun 215 orang
          secara massal (PRD §13), bukan penugasan tim.
        </Muted>
        <View style={{ gap: 8, marginTop: 10 }}>
          <Btn small variant="outline" title="Unduh Template CSV" onPress={downloadTemplate} />
          <Btn small title="Pilih File CSV" onPress={readFile} />
        </View>
      </Card>

      {rows && (
        <Card>
          <SectionHeader title={`${rows.length} akun terbaca`} />
          <View style={{ marginTop: 10 }}>
            <Btn title={`Buat ${rows.length} Akun`} onPress={doImport} disabled={importing} loading={importing} />
          </View>
        </Card>
      )}

      {errors.length > 0 && (
        <Card>
          <H>{errors.length} baris dilewati (validasi CSV)</H>
          {errors.slice(0, 5).map((e) => (
            <Muted key={e}>{e}</Muted>
          ))}
        </Card>
      )}

      {result && (
        <Card>
          <H>Hasil Impor</H>
          <Muted style={{ marginTop: 4 }}>{result.created} akun berhasil dibuat.</Muted>
          {result.errors.length > 0 && (
            <>
              <Muted style={{ marginTop: 6, fontFamily: F.semi }}>{result.errors.length} gagal:</Muted>
              {result.errors.slice(0, 10).map((e) => (
                <Muted key={e}>{e}</Muted>
              ))}
            </>
          )}
        </Card>
      )}
    </>
  );
}

// --- Screen shell: switch between the two import modes ---------------------

export default function ImportScreen() {
  const [mode, setMode] = useState<'stores' | 'users'>('stores');

  return (
    <ScrollView tabIndex={0} role="main" contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
      <SectionHeader title="Impor Data" subtitle="Unggah CSV untuk toko atau akun pengguna" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Toko" active={mode === 'stores'} onPress={() => setMode('stores')} />
        <Chip label="Akun Pengguna (bulk)" active={mode === 'users'} onPress={() => setMode('users')} />
      </View>
      {mode === 'stores' ? <StoreImportSection /> : <UserImportSection />}
    </ScrollView>
  );
}
