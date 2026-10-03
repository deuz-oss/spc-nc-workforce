import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Btn, Card, Chip, Empty, Field, Input, KPICard, ListRow, Muted, SectionHeader } from '../components/ui';
import { showToast } from '../components/dialog';
import { useDataRefresh } from '../components/useDataRefresh';
import { HistoryNotice } from '../components/HistoryNotice';
import { ShowMore } from '../components/ShowMore';
import { CATEGORY_LABEL, PRODUCT_MANAGER_ROLES, TARGET_MANAGER_ROLES } from '../config';
import { C, T } from '../theme';
import { ManagementSummary, useCurrentUser, useStore } from '../store/useStore';
import {
  getRange,
  inRange,
  monthKey,
  monthLabel,
  PERIODS,
  PeriodKey,
  programDayKey,
  programParts,
  shiftMonth,
} from '../utils/period';
import { toCsv } from '../utils/csv';
import { fmtDateTime } from '../utils/format';
import { exportCsv } from '../utils/export';

/** Short "d/M" label for trend bar axes — fmtDate's "23 Sep 2026" is too wide for a 26px bar column. */
function dayLabel(ts: number): string {
  const { d, m } = programParts(ts); // program (WIB) day, like the buckets themselves
  return `${d}/${m + 1}`;
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
              <View key={i} style={{ alignItems: 'center', width: 38 }}>
                <View
                  style={{
                    width: 16,
                    height: Math.max(3, (d.value / max) * 70),
                    backgroundColor: C.primary,
                    borderRadius: 3,
                  }}
                />
                <Text style={[T.meta, { marginTop: 4 }]} numberOfLines={1}>
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
  const refreshControl = useDataRefresh();
  const navigation = useNavigation();
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

  // The month shown by "Bulanan" and used for targets / scorecards — any month,
  // any year (older months load via the history notice below).
  const currentMonth = monthKey();
  const [month, setMonth] = useState(currentMonth);
  const range = useMemo(() => getRange(periodKey, month), [periodKey, month]);
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

  // Figures come from the server (management_summary, 0018) for any period and
  // filter — the device holds only a short row-level window for monitor roles.
  // Offline (or before 0018 is applied) they fall back to the rows on the device.
  const fetchManagementSummary = useStore((s) => s.fetchManagementSummary);
  const filtersActive = !!(city || channel || category || tlId || storeQuery.trim());
  const summaryKey = `${range.from}|${range.to}|${filtersActive ? [...storeIds].sort().join(',') : '*'}`;
  const [summary, setSummary] = useState<{ key: string; data: ManagementSummary } | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Debounced: the store-name search changes the key on every keystroke.
    const t = setTimeout(() => {
      fetchManagementSummary(range, filtersActive ? [...storeIds] : null)
        .then((data) => {
          if (cancelled) return;
          setSummary({ key: summaryKey, data });
          setSummaryFailed(false);
        })
        .catch(() => !cancelled && setSummaryFailed(true));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryKey, fetchManagementSummary]);
  const server = summary?.key === summaryKey ? summary.data : null;

  const totalFacing = server?.totalFacing ?? sosInRange.reduce((t, r) => t + r.totalFacingCount, 0);
  const ownFacing = server?.ownFacing ?? sosInRange.reduce((t, r) => t + r.ownFacingCount, 0);
  const sosPct = totalFacing > 0 ? Math.round((100 * ownFacing) / totalFacing) : null;
  const offtakeSum = server?.offtakeUnits ?? offtakeInRange.reduce((t, r) => t + r.unitsSold, 0);

  const monthlyKey = month;
  const targetSum = targets
    .filter((t) => t.periodKey === monthlyKey && (t.storeId === null || storeIds.has(t.storeId)))
    .reduce((sum, t) => sum + (t.offtakeTarget ?? 0), 0);
  const gwpAllocationSum = targets
    .filter((t) => t.periodKey === monthlyKey && (t.storeId === null || storeIds.has(t.storeId)))
    .reduce((sum, t) => sum + (t.gwpAllocation ?? 0), 0);
  const gwpGivenSum =
    server?.gwpGivenQty ?? ntgInRange.filter((g) => g.stage === 'gwp_given').reduce((t, g) => t + (g.gwpQty ?? 0), 0);
  const gwpAbsorptionPct = gwpAllocationSum > 0 ? Math.round((100 * gwpGivenSum) / gwpAllocationSum) : null;

  const ntgConfirmedStages = new Set(['ntg_confirmed', 'gwp_given', 'wa_followup_scheduled']);
  const ntgCount =
    server?.ntgConsumers ?? new Set(ntgInRange.filter((g) => ntgConfirmedStages.has(g.stage)).map((g) => g.consumerId)).size;

  const buckets = useMemo(() => dayBuckets(range), [range]);
  const serverDays = useMemo(() => new Map((server?.daily ?? []).map((d) => [d.day, d])), [server]);
  const sosTrend = buckets.map((b) => {
    let own: number;
    let tot: number;
    if (server) {
      const d = serverDays.get(programDayKey(b.from));
      own = d?.own ?? 0;
      tot = d?.total ?? 0;
    } else {
      const rows = sosInRange.filter((r) => r.createdAt >= b.from && r.createdAt < b.to);
      tot = rows.reduce((t, r) => t + r.totalFacingCount, 0);
      own = rows.reduce((t, r) => t + r.ownFacingCount, 0);
    }
    return { label: b.label, value: tot > 0 ? Math.round((100 * own) / tot) : 0 };
  });
  const offtakeTrend = buckets.map((b) => ({
    label: b.label,
    value: server
      ? (serverDays.get(programDayKey(b.from))?.units ?? 0)
      : offtakeInRange.filter((r) => r.createdAt >= b.from && r.createdAt < b.to).reduce((t, r) => t + r.unitsSold, 0),
  }));

  const channelBreakdown = useMemo(() => {
    const map = new Map<string, { own: number; total: number }>();
    const rows = server
      ? server.channels
      : sosInRange.map((r) => ({ channel: r.channel, category: r.category, own: r.ownFacingCount, total: r.totalFacingCount }));
    for (const r of rows) {
      const key = `${r.channel || '(kosong)'} · ${CATEGORY_LABEL[r.category] ?? r.category}`;
      const agg = map.get(key) ?? { own: 0, total: 0 };
      agg.own += r.own;
      agg.total += r.total;
      map.set(key, agg);
    }
    return Array.from(map.entries()).map(([key, agg]) => ({
      key,
      sosPct: agg.total > 0 ? Math.round((100 * agg.own) / agg.total) : 0,
    }));
  }, [sosInRange, server]);

  const ncTrackerList = useMemo(() => {
    let list = users.filter((u) => u.role === 'nc' && u.active);
    if (tlId) list = list.filter((u) => u.teamId === users.find((t) => t.id === tlId)?.teamId);
    return list;
  }, [users, tlId]);

  const scorecardCounts = useMemo(() => {
    const thisPeriod = scorecards.filter((sc) => sc.periodKey === monthlyKey);
    return {
      total: thisPeriod.length,
      lastComputedAt: thisPeriod.reduce<number | null>((max, sc) => (max == null || sc.computedAt > max ? sc.computedAt : max), null),
      onTrack: thisPeriod.filter((sc) => sc.status === 'on_track').length,
      needsAttention: thisPeriod.filter((sc) => sc.status === 'needs_attention').length,
      belowTarget: thisPeriod.filter((sc) => sc.status === 'below_target').length,
    };
  }, [scorecards, monthlyKey]);

  const doComputeScorecards = async () => {
    setComputingScorecards(true);
    try {
      const err = await computeScorecards(monthlyKey);
      if (!err) showToast(`Skorkartu ${monthlyKey} dihitung ulang`);
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
      refreshControl={refreshControl}
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
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <Btn small variant="outline" title="‹" onPress={() => setMonth((m) => shiftMonth(m, -1))} />
            <Text style={[T.label, { minWidth: 80, textAlign: 'center' }]}>{monthLabel(month)}</Text>
            <Btn small variant="outline" title="›" disabled={month >= currentMonth} onPress={() => setMonth((m) => shiftMonth(m, 1))} />
            {month !== currentMonth && <Btn small variant="outline" title="Bulan ini" onPress={() => setMonth(currentMonth)} />}
          </View>
          <Muted style={{ marginTop: 4 }}>
            Bulan untuk periode “Bulanan”, target & skorkartu{periodKey !== 'monthly' ? ' (periode harian/mingguan selalu hari/minggu ini)' : ''}.
          </Muted>
          {server ? (
            <Muted style={{ marginTop: 4 }}>Angka dihitung di server untuk seluruh periode.</Muted>
          ) : (
            <>
              {summaryFailed && <Muted style={{ marginTop: 4 }}>Server tidak terjangkau — angka dari data di perangkat.</Muted>}
              <HistoryNotice needsFrom={range.from} />
            </>
          )}
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
            subtitle="Buat dan kelola pertanyaan survey untuk NC"
            action={{ label: 'Kelola Survey', onPress: () => navigation.navigate('SurveyBuilder') }}
          />
        </Card>
      )}

      {PRODUCT_MANAGER_ROLES.includes(me.role) && (
        <Card>
          <SectionHeader
            title="Master Produk"
            subtitle="SKU untuk pilihan laporan NC — tambah, ubah, nonaktifkan"
            action={{ label: 'Kelola', onPress: () => navigation.navigate('Products') }}
          />
        </Card>
      )}

      {me.role === 'pm' && (
        <Card>
          <SectionHeader
            title="Log Aktivitas Admin"
            subtitle="Siapa mengubah akun, tim, pin toko, target, review & bobot skorkartu"
            action={{ label: 'Buka', onPress: () => navigation.navigate('AuditLog') }}
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
            subtitle={`Periode ${monthlyKey}`}
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
            {scorecardCounts.lastComputedAt
              ? `Terakhir dihitung ${fmtDateTime(scorecardCounts.lastComputedAt)}. `
              : ''}
            Dihitung ulang otomatis setiap malam pukul 01:00 WIB; tekan tombol di atas bila perlu skor terbaru sekarang
            (mis. setelah mengubah target).
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
            <ShowMore
              items={ncTrackerList}
              render={(nc) => (
                <ListRow key={nc.id} title={nc.name} subtitle={nc.city ?? '-'} onPress={() => navigation.navigate('NcTracker', { ncId: nc.id })} />
              )}
            />
          )}
        </View>
      </Card>

      {hidePii && (
        <Muted>
          Tampilan ini tidak memuat data pribadi konsumen (nama, kontak WhatsApp) — hanya angka agregat NTG dan GWP,
          sesuai prinsip minimisasi data UU PDP.
        </Muted>
      )}
    </ScrollView>
  );
}
