import React, { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Badge, Btn, Card, Chip, Empty, Field, Input, ListRow, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { ROLE_LABEL } from '../config';
import { C, F } from '../theme';
import { useStore } from '../store/useStore';
import { Role } from '../types';

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
      <SectionHeader title="Tambah Pengguna" />
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
      {err && <Text style={{ color: C.accent, fontSize: 12.5, fontFamily: F.semi }}>{err}</Text>}
      <Btn title="Simpan" onPress={submit} disabled={busy} loading={busy} />
    </Card>
  );
}

export default function UsersScreen() {
  const navigation = useNavigation<any>();
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const toggleUserActive = useStore((s) => s.toggleUserActive);
  const [showAdd, setShowAdd] = useState(false);

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
        <Btn small variant="outline" title="Impor Massal (CSV, 215 akun)" onPress={() => navigation.navigate('Import')} />
        {showAdd && <AddUserForm onDone={() => setShowAdd(false)} />}
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
