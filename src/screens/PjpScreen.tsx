import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Badge, Btn, Card, Empty, Input, ListRow, Muted, SectionHeader } from '../components/ui';
import { showToast } from '../components/dialog';
import { HistoryNotice } from '../components/HistoryNotice';
import { useDataRefresh } from '../components/useDataRefresh';
import { useAppRoute } from '../navigation';
import { scopeUsers, useCurrentUser, useStore } from '../store/useStore';
import { C, T } from '../theme';
import { Schedule } from '../types';
import { PJP_MANAGER_ROLES } from '../config';
import { MONTHS_SHORT, programDayKey, programParts } from '../utils/period';
import { copyWeekPlan, planCompliance, scheduleStatus, ScheduleStatus, weekDays, weekStart } from '../utils/pjp';
import { useNow } from '../components/useNow';

const DAY = 86400000;
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const dayTitle = (ts: number) => {
  const { d, m, dow } = programParts(ts);
  return `${DAY_NAMES[dow]}, ${d} ${MONTHS_SHORT[m]}`;
};
const weekTitle = (start: number) => {
  const a = programParts(start);
  const b = programParts(start + 5 * DAY);
  return `${a.d} ${MONTHS_SHORT[a.m]} – ${b.d} ${MONTHS_SHORT[b.m]} ${b.y}`;
};

const STATUS: Record<ScheduleStatus, { label: string; color: string }> = {
  visited: { label: 'Dikunjungi', color: C.ok },
  missed: { label: 'Terlewat', color: C.accent },
  planned: { label: 'Direncanakan', color: C.info },
};

/**
 * PJP (Permanent Journey Plan): which stores an NC visits on which day of the
 * week (Mon–Sat, WIB). TL / ARCO / Super Admin / Admin Data Entry plan it for
 * the NCs in their scope; an NC sees their own plan. A plan turns "Dikunjungi"
 * when the NC checks in at that store that day (server link, 0020).
 */
export default function PjpScreen() {
  const me = useCurrentUser()!;
  const route = useAppRoute<'Pjp'>();
  const navigation = useNavigation();
  const refreshControl = useDataRefresh();
  const users = useStore((s) => s.users);
  const teams = useStore((s) => s.teams);
  const stores = useStore((s) => s.stores);
  const visits = useStore((s) => s.visits);
  const schedules = useStore((s) => s.schedules);
  const addSchedules = useStore((s) => s.addSchedules);
  const deleteSchedule = useStore((s) => s.deleteSchedule);

  const canManage = PJP_MANAGER_ROLES.includes(me.role);
  const ncs = useMemo(
    () => (canManage ? scopeUsers({ users, teams }, me).filter((u) => u.role === 'nc') : [me]),
    [canManage, users, teams, me],
  );
  const [ncId, setNcId] = useState<string | null>(route.params?.ncId ?? (me.role === 'nc' ? me.id : null));
  const [ncQuery, setNcQuery] = useState('');
  const [week, setWeek] = useState(() => weekStart(Date.now()));
  const [addingDay, setAddingDay] = useState<number | null>(null);
  const [storeQuery, setStoreQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const nc = ncs.find((u) => u.id === ncId) ?? null;
  const now = useNow();
  const thisWeek = weekStart(now);
  const days = weekDays(week);
  const storesById = useMemo(() => new Map(stores.map((st) => [st.id, st])), [stores]);

  const ncMatches = useMemo(() => {
    const needle = ncQuery.trim().toLowerCase();
    return ncs
      .filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [ncs, ncQuery]);

  const weekPlans = useMemo(
    () => (nc ? schedules.filter((s) => s.ncId === nc.id && s.plannedDate >= week && s.plannedDate < week + 7 * DAY) : []),
    [schedules, nc, week],
  );
  const plansByDay = useMemo(() => {
    const m = new Map<string, Schedule[]>();
    for (const s of weekPlans) m.set(programDayKey(s.plannedDate), [...(m.get(programDayKey(s.plannedDate)) ?? []), s]);
    return m;
  }, [weekPlans]);
  const compliance = nc ? planCompliance(schedules, visits, new Set([nc.id]), { from: week, to: week + 7 * DAY }) : null;

  // Store picker for the day being edited: the NC's assigned stores first.
  const storeMatches = useMemo(() => {
    if (addingDay == null || !nc) return [];
    const planned = new Set((plansByDay.get(programDayKey(addingDay)) ?? []).map((s) => s.storeId));
    const needle = storeQuery.trim().toLowerCase();
    return stores
      .filter((st) => !planned.has(st.id))
      .filter((st) => !needle || st.name.toLowerCase().includes(needle) || st.city.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.assignedNcId === nc.id) - Number(a.assignedNcId === nc.id) || a.name.localeCompare(b.name))
      .slice(0, 15);
  }, [addingDay, nc, plansByDay, stores, storeQuery]);

  const addStore = async (storeId: string) => {
    if (!nc || addingDay == null) return;
    setBusy(true);
    try {
      if (!(await addSchedules(nc.id, [{ storeId, plannedDate: addingDay }]))) setStoreQuery('');
    } finally {
      setBusy(false);
    }
  };

  const copyLastWeek = async () => {
    if (!nc) return;
    const plans = copyWeekPlan(schedules, nc.id, week - 7 * DAY, week);
    if (!plans.length) {
      showToast('Tidak ada jadwal minggu lalu untuk disalin', 'info');
      return;
    }
    setBusy(true);
    try {
      if (!(await addSchedules(nc.id, plans))) showToast(`${plans.length} jadwal disalin dari minggu lalu`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      tabIndex={0}
      role="main"
      refreshControl={refreshControl}
      contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' }}
    >
      <SectionHeader
        title="Jadwal Kunjungan (PJP)"
        subtitle={canManage ? 'Rencana toko per hari untuk NC di tim Anda' : 'Rencana kunjungan Anda'}
      />

      {canManage && (
        <View style={{ alignSelf: 'flex-start' }}>
          <Btn small variant="outline" title="Impor Jadwal (CSV)" onPress={() => navigation.navigate('Import', { mode: 'pjp' })} />
        </View>
      )}

      {canManage && (
        <Card style={{ gap: 8 }}>
          {nc ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flexShrink: 1 }}>
                <Text style={T.h3}>{nc.name}</Text>
                <Muted>{[teams.find((t) => t.id === nc.teamId)?.name, nc.city].filter(Boolean).join(' · ') || nc.username}</Muted>
              </View>
              <Btn small variant="outline" title="Ganti NC" onPress={() => setNcId(null)} />
            </View>
          ) : (
            <>
              <Text style={T.h3}>Pilih NC</Text>
              <Input placeholder="Cari nama atau username NC..." value={ncQuery} onChangeText={setNcQuery} />
              {ncMatches.length === 0 ? (
                <Muted>Tidak ada NC yang cocok.</Muted>
              ) : (
                ncMatches.map((u) => (
                  <ListRow
                    key={u.id}
                    title={u.name}
                    subtitle={[teams.find((t) => t.id === u.teamId)?.name, u.city].filter(Boolean).join(' · ') || u.username}
                    onPress={() => {
                      setNcId(u.id);
                      setNcQuery('');
                    }}
                  />
                ))
              )}
            </>
          )}
        </Card>
      )}

      {nc && (
        <>
          <Card style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn small variant="outline" title="‹" onPress={() => setWeek((w) => w - 7 * DAY)} />
              <Text style={[T.label, { minWidth: 150, textAlign: 'center' }]}>{weekTitle(week)}</Text>
              <Btn small variant="outline" title="›" onPress={() => setWeek((w) => w + 7 * DAY)} />
              {week !== thisWeek && <Btn small variant="outline" title="Minggu ini" onPress={() => setWeek(thisWeek)} />}
            </View>
            {compliance && compliance.due > 0 && (
              <Muted>
                Kepatuhan PJP: {compliance.visited}/{compliance.due} jadwal yang sudah lewat dikunjungi (
                {Math.round((100 * compliance.visited) / compliance.due)}%)
              </Muted>
            )}
            {canManage && (
              <View style={{ alignSelf: 'flex-start' }}>
                <Btn small variant="outline" title="Salin Jadwal Minggu Lalu" onPress={copyLastWeek} disabled={busy} />
              </View>
            )}
            <HistoryNotice needsFrom={week} />
          </Card>

          {days.map((day) => {
            const key = programDayKey(day);
            const plans = [...(plansByDay.get(key) ?? [])].sort((a, b) =>
              (storesById.get(a.storeId)?.name ?? '').localeCompare(storesById.get(b.storeId)?.name ?? ''),
            );
            const isToday = key === programDayKey(now);
            return (
              <Card key={key} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={T.h3}>{dayTitle(day)}</Text>
                  {isToday && <Badge label="Hari ini" color={C.info} />}
                </View>
                {plans.length === 0 ? (
                  <Muted>Belum ada toko dijadwalkan.</Muted>
                ) : (
                  plans.map((s) => {
                    const store = storesById.get(s.storeId);
                    const st = STATUS[scheduleStatus(s, visits)];
                    return (
                      <View key={s.id} style={{ gap: 4 }}>
                        <ListRow
                          title={store?.name ?? s.storeId}
                          subtitle={store ? `${store.city}${store.assignedNcId && store.assignedNcId !== nc.id ? ' · toko NC lain' : ''}` : undefined}
                          trailing={<Badge label={st.label} color={st.color} />}
                        />
                        {canManage && st.label !== STATUS.visited.label && (
                          <View style={{ alignSelf: 'flex-end' }}>
                            <Btn small variant="outline" title="Hapus" onPress={() => void deleteSchedule(s.id)} />
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
                {canManage &&
                  (addingDay === day ? (
                    <View style={{ gap: 6 }}>
                      <Input placeholder="Cari toko (nama atau kota)..." value={storeQuery} onChangeText={setStoreQuery} autoFocus />
                      {storeMatches.length === 0 ? (
                        <Empty text="Tidak ada toko yang cocok." />
                      ) : (
                        storeMatches.map((st) => (
                          <ListRow
                            key={st.id}
                            title={st.name}
                            subtitle={`${st.city}${st.assignedNcId === nc.id ? ' · toko NC ini' : ''}`}
                            onPress={busy ? undefined : () => void addStore(st.id)}
                          />
                        ))
                      )}
                      <View style={{ alignSelf: 'flex-start' }}>
                        <Btn small variant="outline" title="Selesai" onPress={() => { setAddingDay(null); setStoreQuery(''); }} />
                      </View>
                    </View>
                  ) : (
                    <View style={{ alignSelf: 'flex-start' }}>
                      <Btn small variant="outline" title="+ Tambah Toko" onPress={() => { setAddingDay(day); setStoreQuery(''); }} />
                    </View>
                  ))}
              </Card>
            );
          })}
        </>
      )}

      {!nc && !canManage && <Empty text="Belum ada jadwal." />}
    </ScrollView>
  );
}
