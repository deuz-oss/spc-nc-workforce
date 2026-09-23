import React from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Btn, Card, H, ListRow, Muted, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { APP_NAME, ROLE_LABEL, SCORECARD_ROLES } from '../config';
import { useCurrentUser, useStore } from '../store/useStore';

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
