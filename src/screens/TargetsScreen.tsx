import React, { memo, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Btn, Card, Chip, Empty, Field, H, Input, Muted, SectionHeader, StatCard, StickyFooter } from '../components/ui';
import { showDialog } from '../components/dialog';
import { TARGET_MANAGER_ROLES } from '../config';
import { C, F } from '../theme';
import { useCurrentUser, useStore } from '../store/useStore';
import { Target, User } from '../types';
import { parseCsv, toCsv } from '../utils/csv';
import { exportCsv } from '../utils/export';
import { fmtNum, MONTHS_ID } from '../utils/format';
import { monthKey } from '../utils/period';
import { uid } from '../utils/uuid';

/**
 * Monthly per-NC targets (PRD §9/§12): offtake target (units) + GWP
 * allocation, set by Data Analyst / Super Admin. One row per NC per
 * `period_key` with store_id = null — the shape every reader already assumes:
 * compute_scorecards() (offtake_achievement, team/regional/program offtake,
 * gwp_absorption_reporting), the TL/ARCO validation rollup, and the
 * management dashboard's "Offtake vs Target" / GWP absorption KPIs.
 *
 * Edits are kept as local drafts and saved in one batch (saveTargets), so a
 * CSV import or "copy last month" can be reviewed before anything is written.
 */

interface Draft {
  offtake: string;
  gwp: string;
}

const EMPTY: Draft = { offtake: '', gwp: '' };

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_ID[m - 1]} ${y}`;
}

const toDraft = (t: Target | undefined): Draft =>
  t ? { offtake: t.offtakeTarget != null ? String(t.offtakeTarget) : '', gwp: t.gwpAllocation != null ? String(t.gwpAllocation) : '' } : EMPTY;

const sameDraft = (a: Draft, b: Draft) => a.offtake.trim() === b.offtake.trim() && a.gwp.trim() === b.gwp.trim();

const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '');

/** Case-insensitive header lookup, tolerant of Indonesian/English column names. */
function col(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (row[k] != null) return row[k].trim();
  return '';
}

const TargetRow = memo(function TargetRow({
  nc,
  teamName,
  value,
  dirty,
  onChange,
}: {
  nc: User;
  teamName: string;
  value: Draft;
  dirty: boolean;
  onChange: (ncId: string, patch: Partial<Draft>) => void;
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: dirty ? C.warn : C.border,
        borderRadius: 12,
        padding: 10,
        gap: 8,
        backgroundColor: C.card,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.text }} numberOfLines={1}>
            {nc.name}
          </Text>
          <Text style={{ fontFamily: F.reg, fontSize: 11.5, color: C.muted }} numberOfLines={1}>
            {nc.username} · {teamName}
          </Text>
        </View>
        {dirty && <Text style={{ fontFamily: F.semi, fontSize: 11.5, color: C.warn }}>Belum disimpan</Text>}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Target Offtake (unit)">
            <Input
              keyboardType="numeric"
              placeholder="-"
              value={value.offtake}
              onChangeText={(v) => onChange(nc.id, { offtake: digitsOnly(v) })}
              aria-label={`Target offtake ${nc.name}`}
            />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Alokasi GWP">
            <Input
              keyboardType="numeric"
              placeholder="-"
              value={value.gwp}
              onChangeText={(v) => onChange(nc.id, { gwp: digitsOnly(v) })}
              aria-label={`Alokasi GWP ${nc.name}`}
            />
          </Field>
        </View>
      </View>
    </View>
  );
});

export default function TargetsScreen() {
  const me = useCurrentUser()!;
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const targets = useStore((s) => s.targets);
  const saveTargets = useStore((s) => s.saveTargets);

  const [period, setPeriod] = useState(monthKey());
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);
  const ncs = useMemo(
    () =>
      users
        .filter((u) => u.role === 'nc' && u.active)
        .sort(
          (a, b) =>
            (teamName.get(a.teamId ?? '') ?? '~').localeCompare(teamName.get(b.teamId ?? '') ?? '~') ||
            a.name.localeCompare(b.name),
        ),
    [users, teamName],
  );

  /** Per-NC (store-less) targets for a period, keyed by NC id. */
  const targetsFor = (key: string) => {
    const m = new Map<string, Target>();
    for (const t of targets) if (t.periodKey === key && t.ncId && !t.storeId) m.set(t.ncId, t);
    return m;
  };
  const existing = useMemo(() => targetsFor(period), [targets, period]);

  const valueOf = (ncId: string): Draft => drafts[ncId] ?? toDraft(existing.get(ncId));
  const dirtyIds = useMemo(
    () => Object.keys(drafts).filter((id) => !sameDraft(drafts[id], toDraft(existing.get(id)))),
    [drafts, existing],
  );
  const dirtySet = useMemo(() => new Set(dirtyIds), [dirtyIds]);

  const onChange = React.useCallback(
    (ncId: string, patch: Partial<Draft>) =>
      setDrafts((d) => ({ ...d, [ncId]: { ...(d[ncId] ?? toDraft(existing.get(ncId))), ...patch } })),
    [existing],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ncs.filter(
      (u) =>
        (!teamFilter || u.teamId === teamFilter) &&
        (!needle || u.name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle)),
    );
  }, [ncs, teamFilter, q]);

  const summary = useMemo(() => {
    let withTarget = 0;
    let offtake = 0;
    let gwp = 0;
    for (const nc of ncs) {
      const v = valueOf(nc.id);
      if (v.offtake || v.gwp) withTarget++;
      offtake += Number(v.offtake) || 0;
      gwp += Number(v.gwp) || 0;
    }
    return { withTarget, offtake, gwp };
    // valueOf reads drafts + existing
  }, [ncs, drafts, existing]);

  if (!TARGET_MANAGER_ROLES.includes(me.role)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Muted>Hanya Data Analyst dan Super Admin yang dapat mengatur target.</Muted>
      </View>
    );
  }

  const changePeriod = (delta: number) => {
    const go = () => {
      setDrafts({});
      setImportErrors([]);
      setPeriod((p) => shiftMonth(p, delta));
    };
    if (!dirtyIds.length) return go();
    showDialog('Buang perubahan?', `${dirtyIds.length} target belum disimpan untuk ${monthLabel(period)}.`, [
      { label: 'Batal' },
      { label: 'Buang', destructive: true, onPress: go },
    ]);
  };

  const copyPrevious = () => {
    const prevKey = shiftMonth(period, -1);
    const prev = targetsFor(prevKey);
    let copied = 0;
    const next = { ...drafts };
    for (const nc of ncs) {
      const cur = valueOf(nc.id);
      const src = prev.get(nc.id);
      // Never overwrite something already set/typed for this period.
      if (!src || cur.offtake || cur.gwp) continue;
      next[nc.id] = toDraft(src);
      copied++;
    }
    setDrafts(next);
    showDialog(
      copied ? 'Target Disalin' : 'Tidak Ada yang Disalin',
      copied
        ? `${copied} target dari ${monthLabel(prevKey)} disalin ke ${monthLabel(period)}. Periksa lalu tekan Simpan.`
        : `Tidak ada NC tanpa target yang punya target di ${monthLabel(prevKey)}.`,
    );
  };

  const doExport = () =>
    exportCsv(
      `target_${period}`,
      toCsv([
        ['username', 'nama', 'tim', 'offtake_target', 'gwp_allocation'],
        ...ncs.map((nc) => {
          const v = valueOf(nc.id);
          return [nc.username, nc.name, teamName.get(nc.teamId ?? '') ?? '', v.offtake, v.gwp];
        }),
      ]),
    );

  const doImport = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const asset: any = res.assets[0];
      const text = asset.file instanceof Blob ? await asset.file.text() : await (await fetch(asset.uri)).text();
      const table = parseCsv(text);
      if (table.length < 2) return showDialog('File kosong atau tanpa baris data.');

      const header = table[0].map((h) => h.trim().toLowerCase());
      const byUsername = new Map(ncs.map((u) => [u.username.toLowerCase(), u]));
      const next = { ...drafts };
      const errs: string[] = [];
      let applied = 0;
      table.slice(1).forEach((r, i) => {
        const row: Record<string, string> = {};
        header.forEach((h, j) => (row[h] = r[j] ?? ''));
        const username = col(row, ['username']).toLowerCase();
        const nc = byUsername.get(username);
        if (!nc) return errs.push(`Baris ${i + 2}: username "${username}" bukan NC aktif`);
        const offtake = col(row, ['offtake_target', 'target_offtake', 'offtake']);
        const gwp = col(row, ['gwp_allocation', 'alokasi_gwp', 'gwp']);
        if ((offtake && !/^\d+$/.test(offtake)) || (gwp && !/^\d+$/.test(gwp))) {
          return errs.push(`Baris ${i + 2} (${username}): nilai harus bilangan bulat ≥ 0`);
        }
        next[nc.id] = { offtake, gwp };
        applied++;
      });
      setDrafts(next);
      setImportErrors(errs);
      showDialog(
        'CSV Terbaca',
        `${applied} baris diterapkan sebagai draft untuk ${monthLabel(period)}${errs.length ? `, ${errs.length} dilewati` : ''}. Periksa lalu tekan Simpan.`,
      );
    } catch {
      showDialog('Gagal membaca file CSV.');
    }
  };

  const save = async () => {
    const upserts: Target[] = [];
    const deleteIds: string[] = [];
    for (const ncId of dirtyIds) {
      const d = drafts[ncId];
      const cur = existing.get(ncId);
      const offtake = d.offtake.trim();
      const gwp = d.gwp.trim();
      if (!offtake && !gwp) {
        if (cur) deleteIds.push(cur.id); // cleared → remove, so it no longer counts as "target set"
        continue;
      }
      upserts.push({
        id: cur?.id ?? uid('tg_'),
        storeId: null,
        ncId,
        periodKey: period,
        offtakeTarget: offtake ? Number(offtake) : undefined,
        gwpAllocation: gwp ? Number(gwp) : undefined,
        setBy: me.id,
      });
    }
    setBusy(true);
    try {
      const err = await saveTargets(upserts, deleteIds);
      if (!err) {
        setDrafts({});
        showDialog(
          'Target Tersimpan',
          `${upserts.length + deleteIds.length} target ${monthLabel(period)} diperbarui. Hitung ulang skorkartu agar skor ikut berubah.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <SectionHeader title="Target Bulanan NC" subtitle="Target offtake & alokasi GWP per NC (PRD §9)" />

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Btn small variant="outline" title="‹ Sebelumnya" onPress={() => changePeriod(-1)} />
          <H style={{ textAlign: 'center', flexShrink: 1 }}>{monthLabel(period)}</H>
          <Btn small variant="outline" title="Berikutnya ›" onPress={() => changePeriod(1)} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <StatCard title="NC dengan Target" value={`${summary.withTarget}/${ncs.length}`} />
          <StatCard title="Total Target Offtake" value={fmtNum(summary.offtake)} />
          <StatCard title="Total Alokasi GWP" value={fmtNum(summary.gwp)} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Btn small variant="outline" title="Salin dari Bulan Lalu" onPress={copyPrevious} />
          <Btn small variant="outline" title="Ekspor CSV" onPress={doExport} />
          <Btn small variant="outline" title="Impor CSV" onPress={doImport} />
        </View>
        <Muted>
          CSV: username, offtake_target, gwp_allocation (kolom nama/tim diabaikan saat impor). Ekspor dulu untuk
          mendapat template berisi semua NC aktif. Kosongkan kedua nilai untuk menghapus target NC tersebut.
        </Muted>
      </Card>

      {importErrors.length > 0 && (
        <Card>
          <H>{importErrors.length} baris CSV dilewati</H>
          {importErrors.slice(0, 5).map((e) => (
            <Muted key={e}>{e}</Muted>
          ))}
        </Card>
      )}

      <Input placeholder="Cari nama atau username NC..." value={q} onChangeText={setQ} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip label="Semua Tim" active={!teamFilter} onPress={() => setTeamFilter(null)} />
        {teams.map((t) => (
          <Chip key={t.id} label={t.name} active={teamFilter === t.id} onPress={() => setTeamFilter(t.id)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        role="main"
        data={visible}
        keyExtractor={(u) => u.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 10, maxWidth: 900, width: '100%', alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty text={ncs.length ? 'Tidak ada NC pada filter ini.' : 'Belum ada NC aktif.'} />}
        renderItem={({ item: nc }) => (
          <TargetRow
            nc={nc}
            teamName={teamName.get(nc.teamId ?? '') ?? 'Tanpa tim'}
            value={valueOf(nc.id)}
            dirty={dirtySet.has(nc.id)}
            onChange={onChange}
          />
        )}
      />
      <StickyFooter>
        <Btn
          title={dirtyIds.length ? `Simpan ${dirtyIds.length} Perubahan` : 'Tidak Ada Perubahan'}
          onPress={save}
          disabled={!dirtyIds.length || busy}
          loading={busy}
        />
      </StickyFooter>
    </View>
  );
}
