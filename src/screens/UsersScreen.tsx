import React, { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Badge, Btn, Card, Chip, Empty, Field, Input, ListRow, Muted, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { DEFAULT_TEAM_BASE_RADIUS_M, ROLE_LABEL } from '../config';
import { C, T } from '../theme';
import { MIN_PASSWORD, useStore } from '../store/useStore';
import { Role, Team, User } from '../types';
import { parseLatLng } from '../utils/geo';
import {
  LocationPermissionDeniedError,
  MOCK_LOCATION_MESSAGE,
  MOCK_LOCATION_TITLE,
  requestCurrentCoords,
} from '../utils/location';

const ROLE_OPTIONS: Role[] = [
  'nc', 'tl', 'arco', 'pm', 'lead_trainer', 'trainer', 'data_analyst', 'admin_data_entry', 'reckitt_client', 'super_admin',
];

function AddUserForm({ onDone }: { onDone: () => void }) {
  const addUser = useStore((s) => s.addUser);
  const teams = useStore((s) => s.teams);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('nc');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    const error = await addUser({ name, username, password, role, teamId });
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    onDone();
  };

  return (
    <Card style={{ gap: 10 }}>
      <SectionHeader level="card" title="Tambah Pengguna" />
      <Field label="Nama"><Input value={name} onChangeText={setName} /></Field>
      <Field label="Username"><Input value={username} onChangeText={setUsername} autoCapitalize="none" /></Field>
      <Field label="Password"><Input value={password} onChangeText={setPassword} secureTextEntry /></Field>
      <Field label="Peran">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {ROLE_OPTIONS.map((r) => (
            <Chip key={r} label={ROLE_LABEL[r]} active={role === r} onPress={() => setRole(r)} />
          ))}
        </View>
      </Field>
      {(role === 'nc' || role === 'tl') && teams.length > 0 && (
        <Field label="Tim">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip label="Tanpa tim" active={teamId == null} onPress={() => setTeamId(null)} />
            {teams.map((t) => (
              <Chip key={t.id} label={t.name} active={teamId === t.id} onPress={() => setTeamId(t.id)} />
            ))}
          </View>
        </Field>
      )}
      {err && <Text style={[T.label, { color: C.dangerStrong }]}>{err}</Text>}
      <Btn title="Simpan" onPress={submit} disabled={busy} loading={busy} />
    </Card>
  );
}

/** Roles that belong to exactly one team (ARCO spans teams via teams.arco_id instead). */
const TEAM_ROLES: Role[] = ['nc', 'tl'];

function EditUserPanel({ user, onDone }: { user: User; onDone: () => void }) {
  const teams = useStore((s) => s.teams);
  const updateUser = useStore((s) => s.updateUser);
  const setUserPassword = useStore((s) => s.setUserPassword);
  const [role, setRole] = useState<Role>(user.role);
  const [teamId, setTeamId] = useState<string | null>(user.teamId);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const e1 = await updateUser(user.id, { role, teamId: TEAM_ROLES.includes(role) ? teamId : null });
      if (e1) return setErr(e1);
      if (password) {
        const e2 = await setUserPassword(user.id, password);
        if (e2) return setErr(e2);
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <SectionHeader level="card" title={`Ubah ${user.name}`} subtitle={user.username} />
      <Field label="Peran">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {ROLE_OPTIONS.map((r) => (
            <Chip key={r} label={ROLE_LABEL[r]} active={role === r} onPress={() => setRole(r)} />
          ))}
        </View>
      </Field>
      {TEAM_ROLES.includes(role) && (
        <Field label="Tim">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip label="Tanpa tim" active={teamId == null} onPress={() => setTeamId(null)} />
            {teams.map((t) => (
              <Chip key={t.id} label={t.name} active={teamId === t.id} onPress={() => setTeamId(t.id)} />
            ))}
          </View>
        </Field>
      )}
      <Field label={`Reset password (opsional, min. ${MIN_PASSWORD} karakter, huruf + angka)`}>
        <Input value={password} onChangeText={setPassword} secureTextEntry placeholder="Kosongkan bila tidak diubah" />
      </Field>
      {err && <Text style={[T.label, { color: C.dangerStrong }]}>{err}</Text>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn title="Simpan" onPress={save} disabled={busy} loading={busy} />
        <Btn variant="outline" title="Batal" onPress={onDone} />
      </View>
    </Card>
  );
}

/** Create a team, or edit one when `team` is given (super_admin). */
function TeamForm({ team, onDone }: { team?: Team; onDone: () => void }) {
  const users = useStore((s) => s.users);
  const addTeam = useStore((s) => s.addTeam);
  const updateTeam = useStore((s) => s.updateTeam);
  const [name, setName] = useState(team?.name ?? '');
  const [city, setCity] = useState(team?.city ?? '');
  const [tlId, setTlId] = useState<string | null>(team?.tlId ?? null);
  const [arcoId, setArcoId] = useState<string | null>(team?.arcoId ?? null);
  const [baseLat, setBaseLat] = useState(team?.baseLat != null ? String(team.baseLat) : '');
  const [baseLng, setBaseLng] = useState(team?.baseLng != null ? String(team.baseLng) : '');
  const [radiusKm, setRadiusKm] = useState(String((team?.baseRadiusM ?? DEFAULT_TEAM_BASE_RADIUS_M) / 1000));
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const pin = parseLatLng(baseLat, baseLng);
  const radiusM = Math.round(Number(radiusKm.replace(',', '.')) * 1000);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const c = await requestCurrentCoords();
      if (c.mocked) {
        showDialog(MOCK_LOCATION_TITLE, MOCK_LOCATION_MESSAGE);
        return;
      }
      setBaseLat(c.lat.toFixed(6));
      setBaseLng(c.lng.toFixed(6));
    } catch (e) {
      const denied = e instanceof LocationPermissionDeniedError;
      showDialog(denied ? 'Izin lokasi diperlukan' : 'Gagal', denied ? 'Aktifkan izin lokasi.' : 'Tidak dapat mengambil lokasi. Coba lagi.');
    } finally {
      setLocating(false);
    }
  };
  const tls = users.filter((u) => u.role === 'tl' && u.active);
  const arcos = users.filter((u) => u.role === 'arco' && u.active);

  const save = async () => {
    if (pin === 'invalid') {
      return showDialog('Koordinat tidak valid', 'Isi latitude dan longitude keduanya (mis. -6.208763 dan 106.845599), atau kosongkan keduanya.');
    }
    if (!(radiusM > 0)) return showDialog('Radius tidak valid', 'Isi radius geofence dalam km, lebih dari 0.');
    const input = { name, city, tlId, arcoId, baseLat: pin?.lat ?? null, baseLng: pin?.lng ?? null, baseRadiusM: radiusM };
    setBusy(true);
    try {
      if (team) {
        if (await updateTeam(team.id, input)) return; // error already shown
      } else {
        await addTeam(input);
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <SectionHeader level="card" title={team ? `Ubah ${team.name}` : 'Tambah Tim'} subtitle="Satu TL per tim; ARCO boleh memegang beberapa tim" />
      <Field label="Nama Tim"><Input value={name} onChangeText={setName} placeholder="mis. Tim Bandung 1" /></Field>
      <Field label="Kota"><Input value={city} onChangeText={setCity} /></Field>
      <Field label="Team Leader">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip label="Belum ada" active={tlId == null} onPress={() => setTlId(null)} />
          {tls.map((u) => <Chip key={u.id} label={u.name} active={tlId === u.id} onPress={() => setTlId(u.id)} />)}
        </View>
      </Field>
      <Field label="ARCO">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip label="Belum ada" active={arcoId == null} onPress={() => setArcoId(null)} />
          {arcos.map((u) => <Chip key={u.id} label={u.name} active={arcoId === u.id} onPress={() => setArcoId(u.id)} />)}
        </View>
      </Field>
      <Muted>TL yang dipilih otomatis dipindah ke tim ini; TL sebelumnya dilepas dari tim ini.</Muted>
      <Field label="Titik Basis Tim (geofence clock-in)">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Input value={baseLat} onChangeText={setBaseLat} placeholder="Latitude" keyboardType="numbers-and-punctuation" />
          </View>
          <View style={{ flex: 1 }}>
            <Input value={baseLng} onChangeText={setBaseLng} placeholder="Longitude" keyboardType="numbers-and-punctuation" />
          </View>
        </View>
      </Field>
      <View style={{ alignSelf: 'flex-start' }}>
        <Btn small variant="outline" title="Pakai Lokasi Saya Sekarang" onPress={useMyLocation} loading={locating} disabled={locating} />
      </View>
      <Field label="Radius Geofence (km)">
        <Input value={radiusKm} onChangeText={setRadiusKm} keyboardType="decimal-pad" />
      </Field>
      <Muted>
        Clock-in di luar radius ini tetap diterima tetapi ditandai “Pengecualian”. Tanpa titik basis, clock-in tim ini
        tidak dicek geofence.
      </Muted>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn title="Simpan Tim" disabled={!city.trim() || busy} loading={busy} onPress={save} />
        <Btn variant="outline" title="Batal" onPress={onDone} />
      </View>
    </Card>
  );
}

export default function UsersScreen() {
  const navigation = useNavigation();
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const toggleUserActive = useStore((s) => s.toggleUserActive);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = users.find((u) => u.id === editingId);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const editingTeam = teams.find((t) => t.id === editingTeamId);

  return (
    <View role="main" style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 10 }}>
        <SectionHeader
          title={`Pengguna (${users.length})`}
          action={{
            label: showAdd ? 'Tutup form' : 'Tambah',
            onPress: () => setShowAdd((v) => !v),
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Btn small variant="outline" title="Impor Massal (CSV)" onPress={() => navigation.navigate('Import', { mode: 'users' })} />
          <Btn small variant="outline" title={showAddTeam ? 'Tutup Tim' : `Kelola Tim (${teams.length})`} onPress={() => setShowAddTeam((v) => !v)} />
          <Btn small variant="outline" title="Log Aktivitas" onPress={() => navigation.navigate('AuditLog')} />
        </View>
        {showAdd && <AddUserForm onDone={() => setShowAdd(false)} />}
        {showAddTeam && !editingTeam && <TeamForm onDone={() => setShowAddTeam(false)} />}
        {showAddTeam && teams.length > 0 && (
          <Card style={{ gap: 8 }}>
            <SectionHeader level="card" title={`Tim (${teams.length})`} />
            {teams.map((t) => (
              <ListRow
                key={t.id}
                title={t.name}
                subtitle={`${t.city} · TL: ${users.find((u) => u.id === t.tlId)?.name ?? '-'} · ARCO: ${users.find((u) => u.id === t.arcoId)?.name ?? '-'}`}
                meta="Ubah"
                onPress={() => setEditingTeamId(t.id)}
              />
            ))}
          </Card>
        )}
        {editingTeam && <TeamForm key={editingTeam.id} team={editingTeam} onDone={() => setEditingTeamId(null)} />}
        {editing && <EditUserPanel key={editing.id} user={editing} onDone={() => setEditingId(null)} />}
      </View>
      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10 }}
        ListEmptyComponent={<Empty text="Belum ada pengguna." />}
        renderItem={({ item: u }) => {
          const team = teams.find((t) => t.id === u.teamId);
          return (
            <ListRow
              title={u.name}
              subtitle={`${u.username} · ${ROLE_LABEL[u.role]}${team ? ` · ${team.name}` : ''}`}
              trailing={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Badge label={u.active ? 'Aktif' : 'Nonaktif'} color={u.active ? C.ok : C.muted} />
                  <Btn small variant="outline" title="Ubah" onPress={() => setEditingId(u.id)} />
                  <Btn
                    small
                    variant="outline"
                    title={u.active ? 'Nonaktifkan' : 'Aktifkan'}
                    onPress={() =>
                      showDialog(u.active ? 'Nonaktifkan pengguna?' : 'Aktifkan pengguna?', u.name, [
                        { label: 'Batal' },
                        { label: 'Ya', onPress: () => toggleUserActive(u.id) },
                      ])
                    }
                  />
                </View>
              }
            />
          );
        }}
      />
    </View>
  );
}
