import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Btn, Card, Empty, Field, Input, ListRow, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { useCurrentUser, useStore, scopeUsers } from '../store/useStore';
import { CoachingLog } from '../types';
import { uid } from '../utils/uuid';
import { fmtDateTime } from '../utils/format';

/** Coaching visit log (PRD §8): free-text + date, linked to an NC. Phase 4a (PRD §16). */
export default function CoachingLogScreen() {
  const me = useCurrentUser()!;
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const coachingLogs = useStore((s) => s.coachingLogs);
  const upsertCoachingLog = useStore((s) => s.upsertCoachingLog);

  const ncUsers = useMemo(() => scopeUsers({ users, teams }, me).filter((u) => u.role === 'nc'), [users, teams, me]);

  const [ncId, setNcId] = useState<string | null>(ncUsers[0]?.id ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const myLogs = useMemo(
    () => coachingLogs.filter((l) => ncUsers.some((u) => u.id === l.ncId)).sort((a, b) => b.date - a.date),
    [coachingLogs, ncUsers],
  );

  const submit = async () => {
    if (!ncId) return showDialog('Pilih NC', 'Pilih NC yang dikunjungi untuk coaching.');
    if (!note.trim()) return showDialog('Catatan kosong', 'Isi catatan coaching sebelum menyimpan.');
    setBusy(true);
    try {
      const now = Date.now();
      const log: CoachingLog = { id: uid('cl_'), tlId: me.id, ncId, date: now, note: note.trim(), createdAt: now };
      const err = await upsertCoachingLog(log);
      if (!err) {
        setNote('');
        showDialog('Tersimpan', 'Catatan coaching berhasil disimpan.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      tabIndex={0}
      role="main"
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}
    >
      <SectionHeader title="Coaching Visit Log" subtitle="Catatan kunjungan coaching untuk NC di tim Anda" />

      <Card style={{ gap: 10 }}>
        <Field label="NC">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {ncUsers.map((nc) => (
              <Btn
                key={nc.id}
                small
                variant={ncId === nc.id ? 'primary' : 'outline'}
                title={nc.name}
                onPress={() => setNcId(nc.id)}
              />
            ))}
          </View>
        </Field>
        <Field label="Catatan Coaching">
          <Input placeholder="Apa yang dibahas/dilatih hari ini?" value={note} onChangeText={setNote} multiline numberOfLines={4} />
        </Field>
        <Btn title="Simpan Catatan" onPress={submit} disabled={busy} loading={busy} />
      </Card>

      <Card>
        <SectionHeader title="Riwayat" />
        {myLogs.length === 0 ? (
          <Empty text="Belum ada catatan coaching." />
        ) : (
          <View style={{ gap: 8, marginTop: 10 }}>
            {myLogs.map((l) => {
              const nc = users.find((u) => u.id === l.ncId);
              return <ListRow key={l.id} title={nc?.name ?? '-'} subtitle={l.note} meta={fmtDateTime(l.date)} numberOfLines={3} />;
            })}
          </View>
        )}
      </Card>
    </ScrollView>
  );
}
