import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Btn, Card, Chip, Empty, Field, Input, KPICard, ListRow, Muted, SectionHeader } from '../components/ui';
import { showDialog } from '../components/dialog';
import { HistoryNotice } from '../components/HistoryNotice';
import { CATEGORY_LABEL, TARGET_MANAGER_ROLES } from '../config';
import { C, F, T } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { getRange, PERIODS, PeriodKey, inRange, monthKey } from '../utils/period';
import { toCsv } from '../utils/csv';
import { exportCsv } from '../utils/export';

/** Short "d/M" label for trend bar axes — fmtDate's "23 Sep 2026" is too wide for a 26px bar column. */
function dayLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/**
 * PM / Reckitt / Data Analyst management dashboard (PRD §10, §11). Phase 4a
 * (PRD §16). No charting library is installed in this project — trend visuals
 * are plain proportional-width/height Views, which render identically on RN
 * and web via react-native-web, keeping the dependency footprint unchanged.
 *
 * Reckitt PII: `hidePii` is derived from the *viewing* session's role right
 * here and in NcTrackerScreen independently (not passed down as a prop that a
 * call site could forget) — structurally, a reckitt_client session can never
 * render consumer name/WhatsApp contact, because the check happens at the
 * point of rendering, not at the point of navigation.
 */

function TrendBars({ title, data }: { title: string; data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: 8 }}>
      <Text style={T.label}>{title}</Text>
      {data.length === 0 ? (
        <Empty text="Belum ada data pada periode ini." />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 90, paddingVertical: 4 }}>
            {data.map((d, i) => (
              <View key={i} style={{ alignItems: 'center', width: 26 }}>
                <View
                  style={{
                    width: 16,
                    height: Math.max(3, (d.value / max) * 70),
                    backgroundColor: C.primary,
                    borderRadius: 3,
                  }}
                />
                <Text style={{ fontSize: 9, color: C.muted, fontFamily: F.reg, marginTop: 4 }} numberOfLines={1}>
                  {d.label}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function dayBuckets(range: { from: number; to: number }, maxBuckets = 31): Array<{ from: number; to: number; label: string }> {
  const DAY = 86400000;
  const spanDays = Math.round((range.to - range.from) / DAY);
  const totalDays = Math.max(1, Math.min(maxBuckets, spanDays));
  // Ranges longer than maxBuckets (e.g. "Semua", whose range starts at epoch 0)
  // show the most recent days, not the first days of the range (1 Jan 1970).
  const start = spanDays > maxBuckets ? range.to - maxBuckets * DAY : range.from;
  const out: Array<{ from: number; to: number; label: string }> = [];
  for (let i = 0; i < totalDays; i++) {
    const from = start + i * DAY;
    out.push({ from, to: from + DAY, label: dayLabel(from) });
  }
  return out;
}

export default function ManagementDashboard() {
  const me = useCurrentUser()!;
  const navigation = useNavigation<any>();
  const hidePii = me.role === 'reckitt_client'; // PRD §11 review note — structural, derived from session role

  const users = useStore((s) => s.users);
  const stores = useStore((s) => s.stores);
  const shareOfShelfRows = useStore((s) => s.shareOfShelfRows);
  const offtakeRows = useStore((s) => s.offtakeRows);
  const ntgGwps = useStore((s) => s.ntgGwps);
  const visits = useStore((s) => s.visits);
  const targets = useStore((s) => s.targets);
  const scorecards = useStore((s) => s.scorecards);
  const computeScorecards = useStore((s) => s.computeScorecards);
  const [computingScorecards, setComputingScorecards] = useState(false);

  const [periodKey, setPeriodKey] = useState<PeriodKey>('monthly');
  const [city, setCity] = useState<string | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [tlId, setTlId] = useState<string | null>(null);
  const [storeQuery, setStoreQuery] = useState('');

  const range = useMemo(() => getRange(periodKey, new Date().getMonth()), [periodKey]);
  const visitsById = useMemo(() => new Map(visits.map((v) => [v.id, v])), [visits]);

  const cities = useMemo(() => Array.from(new Set(stores.map((s) => s.city))).filter(Boolean).sort(), [stores]);
  const channels = useMemo(() => Array.from(new Set(stores.map((s) => s.channel))).filter(Boolean).sort(), [stores]);
  const tls = useMemo(() => users.filter((u) => u.role === 'tl' && u.active), [users]);

  const filteredStores = useMemo(() => {
    return stores.filter((s) => {
      if (city && s.city !== city) return false;
      if (channel && s.channel !== channel) return false;
      if (category && s.category !== category) return false;
      if (tlId) {
        const tl = users.find((u) => u.id === tlId);
        if (!tl || s.teamId !== tl.teamId) return false;
      }
      if (storeQuery.trim() && !s.name.toLowerCase().includes(storeQuery.trim().toLowerCase())) return false;
      return true;
    });
  }, [stores, city, channel, category, tlId, users, storeQuery]);
  const storeIds = useMemo(() => new Set(filteredStores.map((s) => s.id)), [filteredStores]);

  const sosInRange = useMemo(
    () => shareOfShelfRows.filter((r) => storeIds.has(r.storeId) && inRange(r.createdAt, range)),
    [shareOfShelfRows, storeIds, range],
  );
  const offtakeInRange = useMemo(
    () => offtakeRows.filter((r) => storeIds.has(r.storeId) && inRange(r.createdAt, range)),
    [offtakeRows, storeIds, range],
  );
  const ntgInRange = useMemo(
    () =>
      ntgGwps.filter((g) => {
        const v = visitsById.get(g.visitId);
        return !!v && storeIds.has(v.storeId) && inRange(g.createdAt, range);
      }),
    [ntgGwps, visitsById, storeIds, range],
  );

  const totalFacing = sosInRange.reduce((t, r) => t + r.totalFacingCount, 0);
  const ownFacing = sosInRange.reduce((t, r) => t + r.ownFacingCount, 0);
  const sosPct = totalFacing > 0 ? Math.round((100 * ownFacing) / totalFacing) : null;
  const offtakeSum = offtakeInRange.reduce((t, r) => t + r.unitsSold, 0);

  const monthlyKey = monthKey();
  const targetSum = targets
    .filter((t) => t.periodKey === monthlyKey && (t.storeId === null || storeIds.has(t.storeId)))
    .reduce((sum, t) => sum + (t.offtakeTarget ?? 0), 0);
  const gwpAllocationSum = targets
    .filter((t) => t.periodKey === monthlyKey && (t.storeId === null || storeIds.has(t.storeId)))
    .reduce((sum, t) => sum + (t.gwpAllocation ?? 0), 0);
  const gwpGivenSum = ntgInRange.filter((g) => g.stage === 'gwp_given').reduce((t, g) => t + (g.gwpQty ?? 0), 0);
  const gwpAbsorptionPct = gwpAllocationSum > 0 ? Math.round((100 * gwpGivenSum) / gwpAllocationSum) : null;

  const ntgConfirmedStages = new Set(['ntg_confirmed', 'gwp_given', 'wa_followup_scheduled']);
  const ntgCount = new Set(ntgInRange.filter((g) => ntgConfirmedStages.has(g.stage)).map((g) => g.consumerId)).size;

  const buckets = useMemo(() => dayBuckets(range), [range]);
  const sosTrend = buckets.map((b) => {
    const rows = sosInRange.filter((r) => r.createdAt >= b.from && r.createdAt < b.to);
    const tot = rows.reduce((t, r) => t + r.totalFacingCount, 0);
    const own = rows.reduce((t, r) => t + r.ownFacingCount, 0);
    return { label: b.label, value: tot > 0 ? Math.round((100 * own) / tot) : 0 };
  });
  const offtakeTrend = buckets.map((b) => ({
    label: b.label,
    value: offtakeInRange.filter((r) => r.createdAt >= b.from && r.createdAt < b.to).reduce((t, r) => t + r.unitsSold, 0),
  }));

  const channelBreakdown = useMemo(() => {
    const map = new Map<string, { own: number; total: number }>();
    for (const r of sosInRange) {
      const key = `${r.channel || '(kosong)'} · ${CATEGORY_LABEL[r.category] ?? r.category}`;
      const agg = map.get(key) ?? { own: 0, total: 0 };
      agg.own += r.ownFacingCount;
      agg.total += r.totalFacingCount;
      map.set(key, agg);
    }
    return Array.from(map.entries()).map(([key, agg]) => ({
      key,
      sosPct: agg.total > 0 ? Math.round((100 * agg.own) / agg.total) : 0,
    }));
  }, [sosInRange]);

  const ncTrackerList = useMemo(() => {
    let list = users.filter((u) => u.role === 'nc' && u.active);
    if (tlId) list = list.filter((u) => u.teamId === users.find((t) => t.id === tlId)?.teamId);
    return list;
  }, [users, tlId]);

  const scorecardCounts = useMemo(() => {
    const thisPeriod = scorecards.filter((sc) => sc.periodKey === monthlyKey);
    return {
      total: thisPeriod.length,
      onTrack: thisPeriod.filter((sc) => sc.status === 'on_track').length,
      needsAttention: thisPeriod.filter((sc) => sc.status === 'needs_attention').length,
      belowTarget: thisPeriod.filter((sc) => sc.status === 'below_target').length,
    };
  }, [scorecards, monthlyKey]);

  const doComputeScorecards = async () => {
    setComputingScorecards(true);
    try {
      const err = await computeScorecards(monthlyKey);
      if (!err) showDialog('Skorkartu Dihitung', `Skorkartu periode ${monthlyKey} berhasil dihitung ulang untuk semua posisi.`);
    } finally {
      setComputingScorecards(false);
    }
  };

  const doExport = async () => {
    const rows: Array<Array<string | number>> = [
      ['Metrik', 'Nilai'],
      ['Periode', PERIODS.find((p) => p.key === periodKey)?.label ?? periodKey],
      ['Total Facing', totalFacing],
      ['SOS %', sosPct ?? '-'],
      ['Offtake', offtakeSum],
      ['Target Offtake', targetSum || '-'],
      ['NTG Count', ntgCount],
      ['GWP Absorption %', gwpAbsorptionPct ?? '-'],
    ];
    await exportCsv(`dashboard_${monthlyKey}.csv`, toCsv(rows));
  };

  return (
    <ScrollView
      tabIndex={0}
      role="main"
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}
    >
      <SectionHeader
        title="Dashboard Manajemen"
        subtitle={hidePii ? 'Tampilan Reckitt (read-only, agregat)' : 'Program-wide'}
        action={{ label: 'Ekspor CSV', onPress: doExport }}
      />

      <Card style={{ gap: 10 }}>
        <Field label="Periode">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {PERIODS.map((p) => (
              <Chip key={p.key} label={p.label} active={periodKey === p.key} onPress={() => setPeriodKey(p.key)} />
            ))}
          </View>
          <HistoryNotice needsFrom={range.from} />
        </Field>
        <Field label="Kota">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="Semua" active={!city} onPress={() => setCity(null)} />
            {cities.map((c) => (
              <Chip key={c} label={c} active={city === c} onPress={() => setCity(c)} />
            ))}
          </View>
        </Field>
        <Field label="Channel">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="Semua" active={!channel} onPress={() => setChannel(null)} />
            {channels.map((c) => (
              <Chip key={c} label={c} active={channel === c} onPress={() => setChannel(c)} />
            ))}
          </View>
        </Field>
        <Field label="Kategori">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="Semua" active={!category} onPress={() => setCategory(null)} />
            {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
              <Chip key={k} label={label} active={category === k} onPress={() => setCategory(k)} />
            ))}
          </View>
        </Field>
        <Field label="Team Leader">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="Semua" active={!tlId} onPress={() => setTlId(null)} />
            {tls.map((tl) => (
              <Chip key={tl.id} label={tl.name} active={tlId === tl.id} onPress={() => setTlId(tl.id)} />
            ))}
          </View>
        </Field>
        <Field label="Cari Toko">
          <Input placeholder="Nama toko..." value={storeQuery} onChangeText={setStoreQuery} />
        </Field>
      </Card>

      {me.role === 'data_analyst' && (
        <Card>
          <SectionHeader
            title="Survey"
            subtitle="Question set untuk NC (PRD §5.7)"
            action={{ label: 'Kelola Survey', onPress: () => navigation.navigate('SurveyBuilder') }}
          />
        </Card>
      )}

      {TARGET_MANAGER_ROLES.includes(me.role) && (
        <Card>
          <SectionHeader
            title="Target Bulanan"
            subtitle={
              targetSum
                ? `Periode ${monthlyKey} · total target offtake ${targetSum}`
                : `Periode ${monthlyKey} · belum ada target — skor offtake belum bisa dihitung`
            }
            action={{ label: 'Atur Target', onPress: () => navigation.navigate('Targets') }}
          />
        </Card>
      )}

      {(me.role === 'pm' || me.role === 'data_analyst') && (
        <Card>
          <SectionHeader
            title="Skorkartu Program"
            subtitle={`Periode ${monthlyKey} · PRD §9`}
            action={{ label: 'Lihat Detail', onPress: () => navigation.navigate('Scorecard') }}
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <KPICard title="On Track" value={String(scorecardCounts.onTrack)} status="ok" />
            <KPICard title="Perlu Perhatian" value={String(scorecardCounts.needsAttention)} status="warn" />
            <KPICard title="Di Bawah Target" value={String(scorecardCounts.belowTarget)} status={scorecardCounts.belowTarget > 0 ? 'warn' : 'neutral'} />
          </View>
          {scorecardCounts.total === 0 && (
            <Muted style={{ marginTop: 8 }}>Belum ada skorkartu untuk periode ini — hitung dulu di bawah.</Muted>
          )}
          <View style={{ marginTop: 10 }}>
            <Btn
              title="Hitung Skorkartu"
              variant="outline"
              onPress={doComputeScorecards}
              disabled={computingScorecards}
              loading={computingScorecards}
            />
          </View>
          <Muted style={{ marginTop: 6 }}>
            Belum ada penjadwal otomatis (pg_cron/scheduled function) — hitung ulang manual tiap periode untuk sekarang.
          </Muted>
        </Card>
      )}

      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <KPICard title="Total Facing" value={String(totalFacing)} />
        <KPICard title="SOS %" value={sosPct != null ? `${sosPct}%` : '-'} />
        <KPICard
          title="Offtake vs Target"
          value={String(offtakeSum)}
          target={targetSum ? `Target: ${targetSum}` : 'Target belum diset'}
          status={targetSum ? (offtakeSum >= targetSum ? 'ok' : 'warn') : 'neutral'}
        />
        <KPICard title="NTG Count" value={String(ntgCount)} />
        <KPICard title="GWP Absorption %" value={gwpAbsorptionPct != null ? `${gwpAbsorptionPct}%` : '-'} />
      </View>

      <Card style={{ gap: 16 }}>
        <SectionHeader title="Tren" />
        <TrendBars title="SOS % dari waktu ke waktu" data={sosTrend} />
        <TrendBars title="Offtake dari waktu ke waktu" data={offtakeTrend} />
      </Card>

      <Card>
        <SectionHeader title="Breakdown Channel × Kategori" subtitle="SOS %" />
        {channelBreakdown.length === 0 ? (
          <Empty text="Belum ada data Share of Shelf pada filter ini." />
        ) : (
          <View style={{ marginTop: 10 }}>
            {channelBreakdown.map((row) => (
              <View
                key={row.key}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: C.divider }}
              >
                <Text style={{ ...T.body, flexShrink: 1 }}>{row.key}</Text>
                <Text style={{ ...T.h3 }}>{row.sosPct}%</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <SectionHeader title="NC Tracker" subtitle="Drill-down per NC" />
        <View style={{ gap: 8, marginTop: 10 }}>
          {ncTrackerList.length === 0 ? (
            <Empty text="Tidak ada NC pada filter ini." />
          ) : (
            ncTrackerList.map((nc) => (
              <ListRow key={nc.id} title={nc.name} subtitle={nc.city ?? '-'} onPress={() => navigation.navigate('NcTracker', { ncId: nc.id })} />
            ))
          )}
        </View>
      </Card>

      {hidePii && (
        <Muted>
          Tampilan Reckitt tidak menampilkan data pribadi konsumen (nama/kontak WhatsApp) — hanya angka agregat
          NTG/GWP, sesuai PRD §11 dan catatan data minimization UU PDP. Ekspor terjadwal (email mingguan) belum
          dibangun — butuh infrastruktur email yang belum ada di codebase ini.
        </Muted>
      )}
    </ScrollView>
  );
}
