import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Btn, Empty, ListRow, Muted, SectionHeader } from '../components/ui';
import { AuditEntry, useStore } from '../store/useStore';
import { fmtDateTime } from '../utils/format';

const ACTION_LABEL: Record<string, string> = {
  'user.create': 'Akun dibuat',
  'user.password_reset': 'Password direset',
  'profiles.update': 'Akun diubah',
  'teams.insert': 'Tim dibuat',
  'teams.update': 'Tim diubah',
  'teams.delete': 'Tim dihapus',
  'stores.update': 'Toko diubah',
  'targets.insert': 'Target dibuat',
  'targets.update': 'Target diubah',
  'targets.delete': 'Target dihapus',
  'report_reviews.insert': 'Review laporan',
  'report_reviews.update': 'Review laporan diubah',
  'consumers.update': 'Data konsumen dihapus (UU PDP)',
  'scorecard_weight_config.insert': 'Bobot skorkartu ditambah',
  'scorecard_weight_config.update': 'Bobot skorkartu diubah',
  'scorecard_weight_config.delete': 'Bobot skorkartu dihapus',
};

const PAGE = 100;

/** Who changed accounts, teams, store pins/assignments, targets, reviews and
 * weights (admin_audit_log, migration 0016). super_admin / PM only (RLS). */
export default function AuditLogScreen() {
  const fetchAuditLog = useStore((s) => s.fetchAuditLog);
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const stores = useStore((s) => s.stores);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: number) => {
      setBusy(true);
      try {
        const page = await fetchAuditLog(PAGE, before);
        setEntries((cur) => (before ? [...cur, ...page] : page));
        setDone(page.length < PAGE);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [fetchAuditLog],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : 'Sistem');
  const targetName = (e: AuditEntry) => {
    if (!e.targetId) return '';
    if (e.targetType === 'profile' || e.targetType === 'profiles') return users.find((u) => u.id === e.targetId)?.name ?? e.targetId;
    if (e.targetType === 'teams') return teams.find((t) => t.id === e.targetId)?.name ?? e.targetId;
    if (e.targetType === 'stores') return stores.find((s) => s.id === e.targetId)?.name ?? e.targetId;
    return e.targetId;
  };
  const describe = (details: Record<string, { from?: unknown; to?: unknown } | unknown>) =>
    Object.entries(details)
      .map(([k, v]) =>
        v && typeof v === 'object' && ('from' in v || 'to' in v)
          ? `${k}: ${String((v as { from?: unknown }).from ?? '-')} → ${String((v as { to?: unknown }).to ?? '-')}`
          : `${k}: ${String(v)}`,
      )
      .join(' · ');

  return (
    <View role="main" style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 6 }}>
        <SectionHeader title="Log Aktivitas Admin" subtitle="Perubahan akun, tim, pin toko, target, review & bobot" />
        {error && <Muted>Gagal memuat: {error}</Muted>}
      </View>
      <FlatList
        data={entries}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 8 }}
        ListEmptyComponent={busy ? null : <Empty text="Belum ada aktivitas tercatat." />}
        renderItem={({ item: e }) => (
          <ListRow
            title={`${ACTION_LABEL[e.action] ?? e.action}${targetName(e) ? ` · ${targetName(e)}` : ''}`}
            subtitle={describe(e.details) || undefined}
            meta={`${fmtDateTime(e.at)} · oleh ${nameOf(e.actorId)}`}
          />
        )}
        ListFooterComponent={
          !done && entries.length > 0 ? (
            <View style={{ alignSelf: 'center', marginTop: 8 }}>
              <Btn small variant="outline" title="Muat Lebih Lama" loading={busy} disabled={busy} onPress={() => void load(entries[entries.length - 1].at)} />
            </View>
          ) : null
        }
      />
    </View>
  );
}
