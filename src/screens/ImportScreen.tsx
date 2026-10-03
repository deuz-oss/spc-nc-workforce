import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Badge, Btn, Card, Chip, Empty, H, Muted, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { CATEGORY_LABEL, PJP_MANAGER_ROLES, PRODUCT_MANAGER_ROLES, STORE_MANAGER_ROLES, USER_MANAGER_ROLES } from '../config';
import { C, F, T } from '../theme';
import { scopeUsers, useCurrentUser, useStore } from '../store/useStore';
import { Role, Store } from '../types';
import { parseCsv } from '../utils/csv';
import { exportCsv } from '../utils/export';
import { uid } from '../utils/uuid';
import { programDayKey } from '../utils/period';
import { weekStart } from '../utils/pjp';
import { parsePjpCsv, PJP_TEMPLATE } from '../utils/pjpImport';
import { useAppRoute } from '../navigation';
import { useNow } from '../components/useNow';
import { OnlineOnlyNote } from '../components/OnlineOnlyNote';
import { useOnline } from '../components/useOnline';

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
  const online = useOnline();
  const navigation = useNavigation();
  const me = useCurrentUser()!;
  const users = useStore((s) => s.users);
  const addStoresBulk = useStore((s) => s.addStoresBulk);

  const [rows, setRows] = useState<StoreRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [ncId, setNcId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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

  const doImport = async () => {
    if (!rows?.length) return;
    const nc = ncId ? users.find((u) => u.id === ncId) : null;
    const now = Date.now();
    setImporting(true);
    try {
      const res = await addStoresBulk(
        rows.map((r) => ({
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
          source: 'imported' as const,
          createdAt: now,
        })),
      );
      if (res.errors.length === 0) {
        showDialog(
          'Impor berhasil',
          `${res.created} toko ditambahkan${nc ? ` dan di-assign ke ${nc.name}` : ' (belum di-assign)'}.`,
          [{ label: 'OK', onPress: () => navigation.goBack() }],
        );
      } else {
        showDialog(
          res.created ? 'Impor Sebagian' : 'Impor Gagal',
          `${res.created} dari ${rows.length} toko tersimpan.\n${res.errors.slice(0, 3).join('\n')}`,
        );
      }
    } finally {
      setImporting(false);
    }
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
            <SectionHeader level="card"
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
              <Btn title={`Impor ${rows.length} Toko`} onPress={doImport} disabled={importing || !online} loading={importing} />
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
                    <Text style={T.label} numberOfLines={1}>{r.name}</Text>
                    <Text style={T.meta} numberOfLines={1}>{r.city || '-'}</Text>
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
  const online = useOnline();
  const navigation = useNavigation();
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
          Tim diatur sesudahnya lewat tombol “Ubah” di layar Pengguna — impor ini hanya membuat akun secara massal.
        </Muted>
        <View style={{ gap: 8, marginTop: 10 }}>
          <Btn small variant="outline" title="Unduh Template CSV" onPress={downloadTemplate} />
          <Btn small title="Pilih File CSV" onPress={readFile} />
        </View>
      </Card>

      {rows && (
        <Card>
          <SectionHeader level="card" title={`${rows.length} akun terbaca`} />
          <View style={{ marginTop: 10 }}>
            <Btn title={`Buat ${rows.length} Akun`} onPress={doImport} disabled={importing || !online} loading={importing} />
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

// --- Product master import (Phase 2 — PRD §5.1 "SKU list from product master") ---

interface ProductRow {
  sku: string;
  name: string;
  category?: string;
}

const PRODUCT_TEMPLATE = `sku,name,category
ENF-A-400,Enfagrow A+ 400g,Premium
ENF-A-900,Enfagrow A+ 900g,Premium`;

function ProductImportSection() {
  const online = useOnline();
  const navigation = useNavigation();
  const me = useCurrentUser()!;
  const addProductsBulk = useStore((s) => s.addProductsBulk);

  const [rows, setRows] = useState<ProductRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);

  const downloadTemplate = () => exportCsv('template_produk', PRODUCT_TEMPLATE);

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
      const out: ProductRow[] = [];
      const errs: string[] = [];
      table.slice(1).forEach((r, i) => {
        const obj: Record<string, string> = {};
        header.forEach((h, j) => (obj[h] = r[j] ?? ''));
        const sku = pick(obj, ['sku', 'kode']);
        const name = pick(obj, ['name', 'nama']);
        if (!sku || !name) {
          errs.push(`Baris ${i + 2}: sku/name kosong`);
          return;
        }
        out.push({ sku, name, category: pick(obj, ['category', 'kategori']) || undefined });
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
      const res = await addProductsBulk(rows);
      setResult(res);
      if (res.errors.length === 0) {
        showDialog('Impor berhasil', `${res.created} produk ditambahkan ke master.`, [
          { label: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } finally {
      setImporting(false);
    }
  };

  if (!PRODUCT_MANAGER_ROLES.includes(me.role)) {
    return (
      <Card>
        <Muted>Hanya Super Admin, Admin Data Entry, dan Data Analyst yang dapat mengelola master produk.</Muted>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Muted>
          Format kolom CSV:{'\n'}
          <Text style={{ fontFamily: F.bold, color: C.text }}>sku, name, category</Text>
          {'\n'}Kolom wajib: sku, name. Kategori opsional. Produk ini muncul sebagai daftar di Stock Taking, Offtake
          dan Price Monitoring; NC tetap bisa menambah kode produk yang belum terdaftar.
        </Muted>
        <View style={{ gap: 8, marginTop: 10 }}>
          <Btn small variant="outline" title="Unduh Template CSV" onPress={downloadTemplate} />
          <Btn small title="Pilih File CSV" onPress={readFile} />
        </View>
      </Card>

      {rows && (
        <Card>
          <SectionHeader level="card" title={`${rows.length} produk terbaca`} />
          <View style={{ marginTop: 10 }}>
            <Btn title={`Impor ${rows.length} Produk`} onPress={doImport} disabled={importing || !online} loading={importing} />
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
          <Muted style={{ marginTop: 4 }}>{result.created} produk berhasil ditambahkan.</Muted>
          {result.errors.length > 0 && (
            <>
              <Muted style={{ marginTop: 6, fontFamily: F.semi }}>{result.errors.length} gagal/dilewati:</Muted>
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

// --- PJP visit plans (Jadwal Kunjungan) ---------------------------------------

const DAY = 86400000;

function PjpImportSection() {
  const online = useOnline();
  const navigation = useNavigation();
  const me = useCurrentUser()!;
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const stores = useStore((s) => s.stores);
  const importSchedules = useStore((s) => s.importSchedules);

  const now = useNow();
  const thisWeek = weekStart(now);
  const [week, setWeek] = useState(() => weekStart(Date.now()) + 7 * DAY);
  const [table, setTable] = useState<string[][] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  const ncs = useMemo(() => scopeUsers({ users, teams }, me).filter((u) => u.role === 'nc'), [users, teams, me]);
  const parsed = useMemo(() => (table ? parsePjpCsv(table, { ncs, stores, week }) : null), [table, ncs, stores, week]);
  const usesDayColumn = !!table?.[0]?.some((h) => ['hari', 'day'].includes(h.trim().toLowerCase()));
  const ncName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const storeName = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);

  const downloadTemplate = () => exportCsv('template_jadwal_pjp', PJP_TEMPLATE);

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
      const t = parseCsv(text);
      if (t.length < 2) {
        showDialog('File kosong atau tanpa baris data.');
        return;
      }
      setTable(t);
      setResult(null);
    } catch {
      showDialog('Gagal membaca file CSV.');
    }
  };

  const doImport = async () => {
    if (!parsed?.plans.length) return;
    setImporting(true);
    try {
      const res = await importSchedules(parsed.plans);
      setResult(res);
      if (res.errors.length === 0) {
        showDialog(
          'Impor berhasil',
          `${res.created} jadwal ditambahkan${res.skipped ? `, ${res.skipped} sudah ada sebelumnya` : ''}.`,
          [{ label: 'OK', onPress: () => navigation.goBack() }],
        );
      }
    } finally {
      setImporting(false);
    }
  };

  if (!PJP_MANAGER_ROLES.includes(me.role)) {
    return (
      <Card>
        <Muted>Hanya Super Admin, Admin Data Entry, TL, dan ARCO yang dapat mengimpor jadwal PJP.</Muted>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Muted>
          Format kolom CSV:{'\n'}
          <Text style={{ fontFamily: F.bold, color: C.text }}>username, toko, kota, tanggal, hari</Text>
          {'\n'}username = username NC{me.role === 'tl' || me.role === 'arco' ? ' di tim Anda' : ''}. toko = ID atau nama
          toko persis; isi kota bila ada toko bernama sama. Isi tanggal (YYYY-MM-DD atau DD/MM/YYYY) atau hari
          (Senin–Sabtu, pada minggu yang dipilih setelah file dibaca). Jadwal yang sudah ada dilewati.
        </Muted>
        <View style={{ gap: 8, marginTop: 10 }}>
          <Btn small variant="outline" title="Unduh Template CSV" onPress={downloadTemplate} />
          <Btn small title="Pilih File CSV" onPress={readFile} />
        </View>
      </Card>

      {parsed && (
        <>
          <Card>
            <SectionHeader level="card"
              title={`${parsed.plans.length} jadwal siap diimpor`}
              subtitle={`${parsed.read} baris terbaca${parsed.errors.length ? ` · ${parsed.errors.length} dilewati` : ''}`}
            />
            {usesDayColumn && (
              <View style={{ gap: 6, marginTop: 10 }}>
                <Muted>Kolom hari mengacu ke minggu yang dimulai:</Muted>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {[0, 1, 2].map((n) => {
                    const w = thisWeek + n * 7 * DAY;
                    const label = n === 0 ? 'Minggu ini' : n === 1 ? 'Minggu depan' : '2 minggu lagi';
                    return <Chip key={n} label={`${label} (${programDayKey(w)})`} active={week === w} onPress={() => setWeek(w)} />;
                  })}
                </View>
              </View>
            )}
            <View style={{ marginTop: 10 }}>
              <Btn
                title={`Impor ${parsed.plans.length} Jadwal`}
                onPress={doImport}
                disabled={importing || !online || parsed.plans.length === 0}
                loading={importing}
              />
            </View>
          </Card>

          {parsed.errors.length > 0 && (
            <Card>
              <H>{parsed.errors.length} baris dilewati (validasi CSV)</H>
              {parsed.errors.slice(0, 10).map((e) => (
                <Muted key={e}>{e}</Muted>
              ))}
              {parsed.errors.length > 10 && <Muted>...dan {parsed.errors.length - 10} lainnya</Muted>}
            </Card>
          )}

          {result && (
            <Card>
              <H>Hasil Impor</H>
              <Muted style={{ marginTop: 4 }}>
                {result.created} jadwal ditambahkan{result.skipped ? `, ${result.skipped} sudah ada sebelumnya` : ''}.
              </Muted>
              {result.errors.map((e) => (
                <Muted key={e} style={{ color: C.accent }}>
                  {e}
                </Muted>
              ))}
            </Card>
          )}

          <Card>
            <H>Preview</H>
            {parsed.plans.length === 0 ? (
              <Empty text="Tidak ada data valid." />
            ) : (
              parsed.plans.slice(0, 10).map((p) => (
                <View
                  key={`${p.ncId}-${p.storeId}-${p.plannedDate}`}
                  style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: C.divider, flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}
                >
                  <View style={{ flexShrink: 1 }}>
                    <Text style={T.label} numberOfLines={1}>
                      {storeName.get(p.storeId)}
                    </Text>
                    <Text style={T.meta} numberOfLines={1}>
                      {ncName.get(p.ncId)}
                    </Text>
                  </View>
                  <Badge label={programDayKey(p.plannedDate)} color={C.info} />
                </View>
              ))
            )}
            {parsed.plans.length > 10 && <Muted style={{ marginTop: 6 }}>...dan {parsed.plans.length - 10} lainnya</Muted>}
          </Card>
        </>
      )}
    </>
  );
}

// --- Screen shell: switch between import modes ------------------------------

type ImportMode = 'stores' | 'users' | 'products' | 'pjp';

export default function ImportScreen() {
  const route = useAppRoute<'Import'>();
  const [mode, setMode] = useState<ImportMode>(route.params?.mode ?? 'stores');

  return (
    <ScrollView tabIndex={0} role="main" contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
      <SectionHeader title="Impor Data" subtitle="Unggah CSV untuk toko, akun pengguna, master produk, atau jadwal PJP" />
      <OnlineOnlyNote text="Offline — impor baru bisa dijalankan saat ada koneksi." />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip label="Toko" active={mode === 'stores'} onPress={() => setMode('stores')} />
        <Chip label="Akun Pengguna (bulk)" active={mode === 'users'} onPress={() => setMode('users')} />
        <Chip label="Master Produk" active={mode === 'products'} onPress={() => setMode('products')} />
        <Chip label="Jadwal PJP" active={mode === 'pjp'} onPress={() => setMode('pjp')} />
      </View>
      {mode === 'stores' ? (
        <StoreImportSection />
      ) : mode === 'users' ? (
        <UserImportSection />
      ) : mode === 'products' ? (
        <ProductImportSection />
      ) : (
        <PjpImportSection />
      )}
    </ScrollView>
  );
}
