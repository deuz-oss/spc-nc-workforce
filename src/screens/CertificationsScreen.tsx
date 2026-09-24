import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Badge, Btn, Card, Chip, Empty, Field, H, Input, ListRow, Muted, SectionHeader, StatCard, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { CERT_MANAGER_ROLES, CERT_TYPES } from '../config';
import { C, F } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { Certification } from '../types';
import { parseSessionDate, passRate, toSessionDateText } from '../utils/certification';
import { fmtDate, MONTHS_ID } from '../utils/format';
import { monthKey, shiftMonth } from '../utils/period';
import { uid } from '../utils/uuid';

/**
 * Training certification results (PRD §9, Lead Trainer KPIs). Entry is per
 * training session: pick the certification type and session date, mark each
 * attendee Lulus / Tidak Lulus, save the batch. compute_scorecards() turns
 * these into certification_pass_rate (all types) and tl_coach_certification
 * (type 'tl_coach') — both were permanently "skipped" before this screen
 * existed, since nothing wrote to `certifications`.
 */

type Mark = 'pass' | 'fail';

function monthRange(key: string) {
  const [y, m] = key.split('-').map(Number);
  return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() };
}

const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_ID[m - 1]} ${y}`;
};

export default function CertificationsScreen() {
  const me = useCurrentUser()!;
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const certifications = useStore((s) => s.certifications);
  const addCertifications = useStore((s) => s.addCertifications);
  const deleteCertification = useStore((s) => s.deleteCertification);
  const canEdit = CERT_MANAGER_ROLES.includes(me.role);

  // --- session entry state ---
  const [certType, setCertType] = useState(CERT_TYPES[0].key);
  const [dateText, setDateText] = useState(toSessionDateText(Date.now()));
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState(false);

  // --- history state ---
  const [period, setPeriod] = useState(monthKey());

  const typeDef = CERT_TYPES.find((t) => t.key === certType)!;
  const sessionDate = parseSessionDate(dateText);
  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);
  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users
      .filter((u) => u.active && u.role === typeDef.subjectRole)
      .filter((u) => !teamFilter || u.teamId === teamFilter)
      .filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, typeDef.subjectRole, teamFilter, q]);

  /** People who already have a result for this type on this date — marking them again would double-count. */
  const alreadyRecorded = useMemo(() => {
    const set = new Set<string>();
    if (sessionDate == null) return set;
    for (const c of certifications) if (c.certType === certType && c.date === sessionDate) set.add(c.userId);
    return set;
  }, [certifications, certType, sessionDate]);

  const markedIds = Object.keys(marks);

  const toggle = (userId: string, mark: Mark) =>
    setMarks((m) => {
      const next = { ...m };
      if (next[userId] === mark) delete next[userId];
      else next[userId] = mark;
      return next;
    });

  const changeType = (key: string) => {
    setCertType(key);
    setMarks({}); // subjects differ (NC vs TL) — marks for the old type no longer apply
  };

  const save = async () => {
    if (sessionDate == null) {
      showDialog('Tanggal tidak valid', 'Isi tanggal sesi dengan format YYYY-MM-DD, tidak boleh di masa depan.');
      return;
    }
    const rows: Certification[] = markedIds.map((userId) => ({
      id: uid('cert_'),
      userId,
      certType,
      date: sessionDate,
      passed: marks[userId] === 'pass',
    }));
    setBusy(true);
    try {
      const err = await addCertifications(rows);
      if (!err) {
        setMarks({});
        const passed = rows.filter((r) => r.passed).length;
        showDialog(
          'Hasil Tersimpan',
          `${rows.length} hasil ${typeDef.label} (${fmtDate(sessionDate)}) tersimpan: ${passed} lulus, ${rows.length - passed} tidak lulus. Skorkartu Lead Trainer diperbarui otomatis malam ini.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (c: Certification) =>
    showDialog(
      'Hapus hasil sertifikasi?',
      `${userName.get(c.userId) ?? '-'} · ${CERT_TYPES.find((t) => t.key === c.certType)?.label ?? c.certType} · ${fmtDate(c.date)}`,
      [
        { label: 'Batal' },
        { label: 'Hapus', destructive: true, onPress: () => void deleteCertification(c.id) },
      ],
    );

  const range = monthRange(period);
  const overall = passRate(certifications, range);
  const tlCoach = passRate(certifications, range, 'tl_coach');
  const history = certifications
    .filter((c) => c.date >= range.from && c.date < range.to)
    .sort((a, b) => b.date - a.date || (userName.get(a.userId) ?? '').localeCompare(userName.get(b.userId) ?? ''));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        tabIndex={0}
        role="main"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: canEdit ? 110 : 24, maxWidth: 900, width: '100%', alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader title="Sertifikasi" subtitle="Hasil sertifikasi NC & TL — KPI Lead Trainer (PRD §9)" />

        {canEdit && (
          <Card style={{ gap: 10 }}>
            <H>Catat Hasil Sesi</H>
            <Field label="Jenis Sertifikasi">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {CERT_TYPES.map((t) => (
                  <Chip key={t.key} label={t.label} active={certType === t.key} onPress={() => changeType(t.key)} />
                ))}
              </View>
            </Field>
            <Field label="Tanggal Sesi (YYYY-MM-DD)">
              <Input value={dateText} onChangeText={setDateText} placeholder="2026-09-24" autoCapitalize="none" />
            </Field>
            {sessionDate == null && (
              <Muted style={{ color: C.accent }}>Tanggal tidak valid atau di masa depan.</Muted>
            )}
            <Input placeholder={`Cari ${typeDef.subjectRole === 'tl' ? 'TL' : 'NC'}...`} value={q} onChangeText={setQ} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Semua Tim" active={!teamFilter} onPress={() => setTeamFilter(null)} />
              {teams.map((t) => (
                <Chip key={t.id} label={t.name} active={teamFilter === t.id} onPress={() => setTeamFilter(t.id)} />
              ))}
            </View>

            {candidates.length === 0 ? (
              <Empty text={`Tidak ada ${typeDef.subjectRole === 'tl' ? 'TL' : 'NC'} aktif pada filter ini.`} />
            ) : (
              <View style={{ gap: 8 }}>
                {candidates.map((u) => {
                  const recorded = alreadyRecorded.has(u.id);
                  return (
                    <View
                      key={u.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        borderWidth: 1,
                        borderColor: marks[u.id] ? C.primary : C.border,
                        borderRadius: 12,
                        padding: 10,
                      }}
                    >
                      <View style={{ flexShrink: 1 }}>
                        <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.text }} numberOfLines={1}>
                          {u.name}
                        </Text>
                        <Text style={{ fontFamily: F.reg, fontSize: 11.5, color: C.muted }} numberOfLines={1}>
                          {u.username} · {teamName.get(u.teamId ?? '') ?? 'Tanpa tim'}
                        </Text>
                      </View>
                      {recorded ? (
                        <Badge label="Sudah tercatat" color={C.muted} />
                      ) : (
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <Chip label="Lulus" color={C.ok} active={marks[u.id] === 'pass'} onPress={() => toggle(u.id, 'pass')} />
                          <Chip label="Tidak Lulus" color={C.accent} active={marks[u.id] === 'fail'} onPress={() => toggle(u.id, 'fail')} />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </Card>
        )}

        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Btn small variant="outline" title="‹" onPress={() => setPeriod((p) => shiftMonth(p, -1))} />
            <H style={{ textAlign: 'center', flexShrink: 1 }}>Riwayat {monthLabel(period)}</H>
            <Btn small variant="outline" title="›" onPress={() => setPeriod((p) => shiftMonth(p, 1))} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <StatCard
              title="Tingkat Lulus (semua)"
              value={overall.pct != null ? `${overall.pct}%` : '-'}
              sub={`${overall.passed}/${overall.total} lulus`}
            />
            <StatCard
              title="TL-Coach"
              value={tlCoach.pct != null ? `${tlCoach.pct}%` : '-'}
              sub={`${tlCoach.passed}/${tlCoach.total} lulus`}
            />
          </View>
          {history.length === 0 ? (
            <Empty text="Belum ada hasil sertifikasi pada bulan ini." />
          ) : (
            <View style={{ gap: 8 }}>
              {history.map((c) => (
                <ListRow
                  key={c.id}
                  title={userName.get(c.userId) ?? '-'}
                  subtitle={`${CERT_TYPES.find((t) => t.key === c.certType)?.label ?? c.certType} · ${fmtDate(c.date)}`}
                  trailing={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Badge label={c.passed ? 'Lulus' : 'Tidak Lulus'} color={c.passed ? C.ok : C.accent} />
                      {canEdit && <Btn small variant="outline" title="Hapus" onPress={() => confirmDelete(c)} />}
                    </View>
                  }
                />
              ))}
            </View>
          )}
          <Muted>
            Tingkat lulus dihitung sama seperti skorkartu Lead Trainer: jumlah lulus ÷ jumlah hasil pada bulan tersebut.
          </Muted>
        </Card>
      </ScrollView>

      {canEdit && (
        <StickyFooter>
          <Btn
            title={markedIds.length ? `Simpan ${markedIds.length} Hasil` : 'Tandai peserta untuk disimpan'}
            onPress={save}
            disabled={!markedIds.length || busy || sessionDate == null}
            loading={busy}
          />
        </StickyFooter>
      )}
    </View>
  );
}
