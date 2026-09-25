import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Btn, Card, Field, H, Input, ListRow, Muted, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { APP_NAME, ROLE_LABEL, SCORECARD_ROLES } from '../config';
import { C, F } from '../theme';
import { MIN_PASSWORD, useCurrentUser, useStore } from '../store/useStore';

function ChangePasswordCard() {
  const changeOwnPassword = useStore((s) => s.changeOwnPassword);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setErr(null);
  };

  const save = async () => {
    if (next !== confirm) return setErr('Konfirmasi password baru tidak sama.');
    setBusy(true);
    try {
      const e = await changeOwnPassword(current, next);
      if (e) return setErr(e);
      reset();
      showDialog('Password Diubah', 'Gunakan password baru saat login berikutnya.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <H>Keamanan Akun</H>
      {!open ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Btn small variant="outline" title="Ubah Password" onPress={() => setOpen(true)} />
        </View>
      ) : (
        <>
          <Field label="Password Lama">
            <Input value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
          </Field>
          <Field label={`Password Baru (min. ${MIN_PASSWORD} karakter)`}>
            <Input value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" />
          </Field>
          <Field label="Ulangi Password Baru">
            <Input value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
          </Field>
          {err && <Text style={{ color: C.accent, fontSize: 12.5, fontFamily: F.semi }}>{err}</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn title="Simpan" onPress={save} disabled={busy || !current || !next} loading={busy} />
            <Btn variant="outline" title="Batal" onPress={reset} />
          </View>
        </>
      )}
    </Card>
  );
}

export default function ProfileScreen() {
  const me = useCurrentUser()!;
  const navigation = useNavigation<any>();
  const teams = useStore((s) => s.teams);
  const logout = useStore((s) => s.logout);
  const pendingCount = useStore((s) => s.pendingOps.length);
  const team = teams.find((t) => t.id === me.teamId);

  return (
    <ScrollView tabIndex={0} role="main" contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 700, width: '100%', alignSelf: 'center' }}>
      <SectionHeader title={me.name} subtitle={ROLE_LABEL[me.role]} />
      <Card>
        <H>Detail Akun</H>
        <View style={{ marginTop: 8, gap: 4 }}>
          <Muted>Username: {me.username}</Muted>
          <Muted>Telepon: {me.phone || '-'}</Muted>
          <Muted>Kota: {me.city || '-'}</Muted>
          <Muted>Tim: {team?.name ?? '-'}</Muted>
        </View>
      </Card>
      {SCORECARD_ROLES.includes(me.role) && (
        <Card>
          <H>Kinerja</H>
          <View style={{ marginTop: 8 }}>
            <ListRow title="Lihat Skorkartu" subtitle="Skor KPI per periode (PRD §9)" onPress={() => navigation.navigate('Scorecard')} />
          </View>
        </Card>
      )}
      <ChangePasswordCard />
      <Card>
        <H>Tentang</H>
        <Muted style={{ marginTop: 4 }}>
          {APP_NAME} — dibangun di atas arsitektur spc-field-force (Expo + Supabase) yang sudah tervalidasi,
          disesuaikan untuk pelaporan konsultasi nutrisi Enfagrow A+.
        </Muted>
      </Card>
      <Btn
        title="Keluar"
        variant="danger"
        onPress={() =>
          showDialog(
            'Keluar dari akun?',
            pendingCount
              ? `Masih ada ${pendingCount} data offline yang belum tersinkron. Data tetap tersimpan di HP ini dan baru terkirim setelah Anda login lagi di HP ini — sebaiknya sambungkan internet dulu sebelum keluar.`
              : undefined,
            [
              { label: 'Batal' },
              { label: 'Keluar', destructive: true, onPress: () => logout() },
            ],
          )
        }
      />
    </ScrollView>
  );
}
