import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, Empty, ListRow, Muted, SectionHeader, StatusBadge } from '../components/ui';
import { ROLE_LABEL, SCORECARD_KPI_LABEL } from '../config';
import { C, F, STATUS_COLOR, T } from '../theme';
import { useCurrentUser, useStore, scopeUsers } from '../store/useStore';
import { Scorecard, ScorecardStatus } from '../types';

/**
 * Scorecard display (PRD §9). Phase 4b (PRD §16). `scorecards.breakdown` is
 * server-computed by compute_scorecards() (0006 migration) — every KPI key it
 * contains is rendered with its human label; `_skipped` entries (KPIs the
 * schema can't back yet) are rendered explicitly as "not computable", never
 * hidden, so a scorecard never silently implies more coverage than it has.
 */

function statusMeta(status: ScorecardStatus): { label: string; color: string; icon: keyof typeof Ionicons.glyphMap } {
  switch (status) {
    case 'on_track':
      return { label: 'On Track', color: STATUS_COLOR.on_track, icon: 'checkmark-circle' };
    case 'below_target':
      return { label: 'Di Bawah Target', color: STATUS_COLOR.below_target, icon: 'alert-circle' };
    default:
      return { label: 'Perlu Perhatian', color: STATUS_COLOR.needs_attention, icon: 'warning' };
  }
}

function ScorecardCard({ sc, subtitle }: { sc: Scorecard; subtitle?: string }) {
  const [open, setOpen] = useState(false);
  const meta = statusMeta(sc.status);
  const skipped: string[] = Array.isArray((sc.breakdown as any)?._skipped) ? (sc.breakdown as any)._skipped : [];
  const note: string | undefined = (sc.breakdown as any)?._note;
  const kpiEntries = Object.entries(sc.breakdown).filter(([k]) => k !== '_skipped' && k !== '_note');

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={T.h3}>{sc.periodKey}</Text>
          {subtitle && <Muted>{subtitle}</Muted>}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: F.xbold, fontSize: 20, color: meta.color }}>{Math.round(sc.score)}</Text>
          <StatusBadge label={meta.label} color={meta.color} icon={meta.icon} />
        </View>
      </View>
      <ListRow title={open ? 'Sembunyikan rincian KPI' : 'Lihat rincian KPI'} onPress={() => setOpen((o) => !o)} meta={open ? '▲' : '▼'} />
      {open && (
        <View style={{ marginTop: 4, gap: 6 }}>
          {note && <Muted>{note}</Muted>}
          {kpiEntries.map(([key, value]) => (
            <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={T.body}>{SCORECARD_KPI_LABEL[key] ?? key}</Text>
              <Text style={{ ...T.body, fontFamily: F.semi }}>{String(value)}%</Text>
            </View>
          ))}
          {skipped.map((key) => (
            <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...T.body, color: C.muted }}>{SCORECARD_KPI_LABEL[key] ?? key}</Text>
              <Text style={{ ...T.small, color: C.muted }}>Belum dapat dihitung — lihat PRD §15</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

export default function ScorecardScreen() {
  const me = useCurrentUser()!;
  const scorecards = useStore((s) => s.scorecards);
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);

  const mine = useMemo(
    () => scorecards.filter((sc) => sc.subjectId === me.id).sort((a, b) => (a.periodKey < b.periodKey ? 1 : -1)),
    [scorecards, me.id],
  );

  const latestPeriod = useMemo(
    () => scorecards.reduce<string | null>((max, sc) => (max === null || sc.periodKey > max ? sc.periodKey : max), null),
    [scorecards],
  );

  const subordinates = useMemo(() => {
    const scopedIds = new Set(scopeUsers({ users, teams }, me).map((u) => u.id));
    scopedIds.delete(me.id);
    if (!scopedIds.size || !latestPeriod) return [];
    return scorecards
      .filter((sc) => scopedIds.has(sc.subjectId) && sc.periodKey === latestPeriod)
      .sort((a, b) => a.score - b.score); // worst first — most actionable
  }, [scorecards, users, teams, me, latestPeriod]);

  return (
    <ScrollView tabIndex={0} role="main" contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 800, width: '100%', alignSelf: 'center' }}>
      <SectionHeader title="Skorkartu Saya" subtitle={ROLE_LABEL[me.role]} />
      {mine.length === 0 ? (
        <Empty text="Belum ada skorkartu untukmu. Skorkartu dihitung oleh Data Analyst/PM setiap periode." />
      ) : (
        mine.map((sc) => <ScorecardCard key={sc.id} sc={sc} />)
      )}

      {subordinates.length > 0 && (
        <>
          <SectionHeader title="Skorkartu Tim/Program" subtitle={`Periode ${latestPeriod}`} />
          {subordinates.map((sc) => {
            const subject = users.find((u) => u.id === sc.subjectId);
            return <ScorecardCard key={sc.id} sc={sc} subtitle={`${subject?.name ?? '-'} · ${ROLE_LABEL[sc.role]}`} />;
          })}
        </>
      )}
    </ScrollView>
  );
}
