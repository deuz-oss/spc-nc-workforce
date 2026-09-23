import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { showDialog } from '../components/dialog';
import { TRACK_MIN_STEP_M } from '../config';
import { Attendance, Role, RoutePoint, Store, Team, User, Visit } from '../types';
import { haversineM } from '../utils/geo';
import { loadQueue, saveQueue, QueuedOp } from '../utils/offlineQueue';
import { uid } from '../utils/uuid';

async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true;
}

/** Roles not attached to a specific team */
const TEAMLESS_ROLES: Role[] = [
  'super_admin',
  'reckitt_client',
  'pm',
  'data_analyst',
  'lead_trainer',
  'trainer',
  'admin_data_entry',
];

export interface NewStoreInput {
  name: string;
  address: string;
  city: string;
  channel: string;
  account?: string;
  category: Store['category'];
  lat: number | null;
  lng: number | null;
}

interface StoreState {
  ready: boolean;
  sessionUserId: string | null;
  users: User[];
  teams: Team[];
  stores: Store[];
  visits: Visit[];
  attendances: Attendance[];
  /** Clock-in/out and store check-in/out writes still waiting for connectivity to reach Supabase. */
  pendingOps: QueuedOp[];

  /** Restores an existing Supabase session (if any) on cold app start. Call once from App.tsx. */
  init(): Promise<void>;
  /** Retries every queued offline write; called on reconnect and on app start. */
  processPendingOps(): Promise<void>;
  login(username: string, password: string): Promise<string | null>;
  logout(): Promise<void>;

  addUser(p: {
    name: string;
    username: string;
    password: string;
    role: Role;
    teamId: string | null;
    city?: string;
    phone?: string;
  }): Promise<string | null>;
  /** Bulk create, PRD §13 — 215-account scale needs a path beyond one-at-a-time. */
  addUsersBulk(
    rows: Array<{ name: string; username: string; password: string; role: Role; teamId: string | null; city?: string; phone?: string }>,
  ): Promise<{ created: number; errors: string[] }>;
  toggleUserActive(id: string): Promise<void>;
  updateUser(
    id: string,
    patch: Partial<Pick<User, 'name' | 'role' | 'teamId' | 'phone' | 'city'>>,
  ): Promise<string | null>;
  addTeam(p: { name: string; city: string; tlId: string | null; arcoId: string | null }): Promise<void>;

  upsertStore(s: Store): Promise<void>;
  assignStores(ids: string[], ncId: string | null): Promise<void>;

  startVisit(
    storeId: string,
    ncId: string,
    pos: { lat: number; lng: number },
    distM: number | null,
    geoValid: boolean,
  ): Promise<string>;
  finishVisit(id: string): Promise<void>;

  clockIn(pos: { lat: number; lng: number }, geoFenceOk: boolean): Promise<string>;
  /** Resolves true if the write was queued offline (not yet synced), false once it's actually saved/attempted. */
  clockOut(pos: { lat: number; lng: number }): Promise<boolean>;
  addRoutePoint(userId: string, p: Omit<RoutePoint, 't'>): void;
}

/** user yang datanya boleh dilihat `viewer` sesuai posisi (role) — mirrors profiles_select RLS */
export function scopeUsers(s: Pick<StoreState, 'users' | 'teams'>, viewer: User): User[] {
  if (viewer.role === 'tl') return s.users.filter((u) => u.active && u.teamId === viewer.teamId);
  if (viewer.role === 'arco') {
    const myTeamIds = new Set(s.teams.filter((t) => t.arcoId === viewer.id).map((t) => t.id));
    return s.users.filter((u) => u.active && u.teamId && myTeamIds.has(u.teamId));
  }
  if (viewer.role === 'nc') return s.users.filter((u) => u.id === viewer.id);
  // super_admin, pm, reckitt_client, data_analyst, lead_trainer, trainer, admin_data_entry: program-wide view
  return s.users.filter((u) => u.active);
}

export function storeScope(s: Pick<StoreState, 'stores' | 'teams'>, viewer: User): Store[] {
  if (viewer.role === 'tl') return s.stores.filter((st) => st.teamId === viewer.teamId);
  if (viewer.role === 'arco') {
    const myTeamIds = new Set(s.teams.filter((t) => t.arcoId === viewer.id).map((t) => t.id));
    return s.stores.filter((st) => st.teamId && myTeamIds.has(st.teamId));
  }
  if (viewer.role === 'nc') return s.stores.filter((st) => st.assignedNcId === viewer.id);
  return s.stores;
}

function upsertById<T extends { id: string | number }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  return i === -1 ? [row, ...list] : list.map((x, idx) => (idx === i ? row : x));
}

// --- Supabase row <-> app type mapping -------------------------------------

function mapProfile(p: any): User {
  return {
    id: p.id,
    name: p.name,
    username: p.username,
    role: p.role,
    teamId: p.team_id,
    city: p.city ?? undefined,
    phone: p.phone ?? undefined,
    active: p.active,
    createdAt: new Date(p.created_at).getTime(),
  };
}

function mapTeam(t: any): Team {
  return {
    id: t.id,
    name: t.name,
    city: t.city,
    tlId: t.tl_id,
    arcoId: t.arco_id,
  };
}

function mapStore(m: any): Store {
  return {
    id: m.id,
    name: m.name,
    address: m.address,
    city: m.city,
    channel: m.channel,
    account: m.account ?? undefined,
    category: m.category,
    lat: m.lat,
    lng: m.lng,
    assignedNcId: m.assigned_nc_id,
    teamId: m.team_id,
    source: m.source,
    createdAt: new Date(m.created_at).getTime(),
  };
}

function mapVisit(v: any): Visit {
  return {
    id: v.id,
    storeId: v.store_id,
    ncId: v.nc_id,
    checkInAt: new Date(v.check_in_at).getTime(),
    checkOutAt: v.check_out_at ? new Date(v.check_out_at).getTime() : null,
    lat: v.lat,
    lng: v.lng,
    storeDistanceM: v.store_distance_m,
    geoValid: v.geo_valid,
  };
}

function mapAttendance(a: any, route: RoutePoint[]): Attendance {
  return {
    id: a.id,
    userId: a.user_id,
    clockInAt: new Date(a.clock_in_at).getTime(),
    clockInLat: a.clock_in_lat,
    clockInLng: a.clock_in_lng,
    clockOutAt: a.clock_out_at ? new Date(a.clock_out_at).getTime() : null,
    clockOutLat: a.clock_out_lat ?? undefined,
    clockOutLng: a.clock_out_lng ?? undefined,
    route,
    geoFenceOk: a.geo_fence_ok,
    nonMarketMs: a.non_market_ms ?? undefined,
  };
}

/** Re-applies a queued op's optimistic local effect after a cold restart, before it's synced. */
function applyQueuedOpLocally(set: (p: Partial<StoreState>) => void, get: () => StoreState, op: QueuedOp) {
  switch (op.type) {
    case 'clockIn':
      if (!get().attendances.some((a) => a.id === op.attendance.id)) {
        set({ attendances: [op.attendance, ...get().attendances] });
      }
      break;
    case 'clockOut':
      set({
        attendances: get().attendances.map((a) =>
          a.id === op.attendanceId ? { ...a, clockOutAt: op.clockOutAt, clockOutLat: op.lat, clockOutLng: op.lng } : a,
        ),
      });
      break;
    case 'startVisit':
      if (!get().visits.some((v) => v.id === op.visit.id)) {
        set({ visits: [op.visit, ...get().visits] });
      }
      break;
    case 'finishVisit': {
      const v = get().visits.find((x) => x.id === op.visitId);
      if (v && !v.checkOutAt) {
        set({
          visits: get().visits.map((x) => (x.id === op.visitId ? { ...x, checkOutAt: op.checkOutAt } : x)),
        });
      }
      break;
    }
  }
}

function visitRow(v: Visit) {
  return {
    lat: v.lat,
    lng: v.lng,
    store_distance_m: v.storeDistanceM,
    geo_valid: v.geoValid,
  };
}

/** Replays one queued op against Supabase. Returns whether it can be dropped from the queue. */
async function replayOp(get: () => StoreState, op: QueuedOp): Promise<boolean> {
  if (op.type === 'clockIn') {
    const a = op.attendance;
    const { error } = await supabase.from('attendances').insert({
      id: a.id,
      user_id: a.userId,
      clock_in_at: new Date(a.clockInAt).toISOString(),
      clock_in_lat: a.clockInLat,
      clock_in_lng: a.clockInLng,
      clock_out_at: null,
      geo_fence_ok: a.geoFenceOk,
    });
    return !error;
  }
  if (op.type === 'clockOut') {
    const { error } = await supabase
      .from('attendances')
      .update({
        clock_out_at: new Date(op.clockOutAt).toISOString(),
        clock_out_lat: op.lat,
        clock_out_lng: op.lng,
      })
      .eq('id', op.attendanceId);
    return !error;
  }
  if (op.type === 'startVisit') {
    const v = op.visit;
    const { error } = await supabase.from('visits').insert({
      id: v.id,
      store_id: v.storeId,
      nc_id: v.ncId,
      check_in_at: new Date(v.checkInAt).toISOString(),
      check_out_at: null,
      ...visitRow(v),
    });
    return !error;
  }
  // finishVisit
  const { error } = await supabase.rpc('finish_visit', { p_visit_id: op.visitId });
  return !error;
}

async function enqueueOp(set: (p: Partial<StoreState>) => void, get: () => StoreState, op: QueuedOp) {
  const next = [...get().pendingOps, op];
  set({ pendingOps: next });
  await saveQueue(next);
}

// --- module-scope (non-reactive) helpers: realtime channel + debounce ------

let channel: RealtimeChannel | null = null;
let authListenerBound = false;
let netInfoListenerBound = false;

function teardownRealtime() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

function subscribeRealtime(set: (partial: Partial<StoreState>) => void, get: () => StoreState) {
  teardownRealtime();
  channel = supabase
    .channel('app-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ users: get().users.filter((u) => u.id !== (payload.old as any).id) });
      } else {
        set({ users: upsertById(get().users, mapProfile(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ teams: get().teams.filter((t) => t.id !== (payload.old as any).id) });
      } else {
        set({ teams: upsertById(get().teams, mapTeam(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ stores: get().stores.filter((m) => m.id !== (payload.old as any).id) });
      } else {
        set({ stores: upsertById(get().stores, mapStore(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ visits: get().visits.filter((v) => v.id !== (payload.old as any).id) });
      } else {
        set({ visits: upsertById(get().visits, mapVisit(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ attendances: get().attendances.filter((a) => a.id !== (payload.old as any).id) });
      } else {
        const existing = get().attendances.find((a) => a.id === (payload.new as any).id);
        set({ attendances: upsertById(get().attendances, mapAttendance(payload.new, existing?.route ?? [])) });
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'route_points' }, (payload) => {
      const p = payload.new as any;
      set({
        attendances: get().attendances.map((a) =>
          a.id === p.attendance_id
            ? { ...a, route: [...a.route, { lat: p.lat, lng: p.lng, t: new Date(p.recorded_at).getTime() }] }
            : a,
        ),
      });
    })
    .subscribe();
}

/** Fetches the caller's profile + every scoped row (RLS-filtered) and hydrates the store. */
async function hydrateAll(
  set: (partial: Partial<StoreState>) => void,
  get: () => StoreState,
  userId: string,
): Promise<boolean> {
  const { data: me, error: meErr } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (meErr || !me || !me.active) return false;

  const [profilesRes, teamsRes, storesRes, visitsRes, attendancesRes] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('teams').select('*'),
    supabase.from('stores').select('*'),
    supabase.from('visits').select('*'),
    supabase.from('attendances').select('*'),
  ]);

  const attendanceRows = attendancesRes.data ?? [];
  const attendanceIds = attendanceRows.map((a: any) => a.id);
  const { data: routePoints } =
    attendanceIds.length > 0
      ? await supabase
          .from('route_points')
          .select('*')
          .in('attendance_id', attendanceIds)
          .order('recorded_at', { ascending: true })
      : { data: [] as any[] };

  const routesByAttendance = new Map<string, RoutePoint[]>();
  for (const p of routePoints ?? []) {
    const arr = routesByAttendance.get(p.attendance_id) ?? [];
    arr.push({ lat: p.lat, lng: p.lng, t: new Date(p.recorded_at).getTime() });
    routesByAttendance.set(p.attendance_id, arr);
  }

  set({
    sessionUserId: userId,
    users: (profilesRes.data ?? []).map(mapProfile),
    teams: (teamsRes.data ?? []).map(mapTeam),
    stores: (storesRes.data ?? []).map(mapStore),
    visits: (visitsRes.data ?? []).map(mapVisit),
    attendances: attendanceRows.map((a: any) => mapAttendance(a, routesByAttendance.get(a.id) ?? [])),
  });

  subscribeRealtime(set, get);
  return true;
}

async function callAdminUsers(body: Record<string, unknown>): Promise<{ data?: any; error?: string }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) return { error: error.message ?? 'Gagal menghubungi server.' };
  if (data?.error) return { error: data.error };
  return { data };
}

export const useStore = create<StoreState>()((set, get) => ({
  ready: false,
  sessionUserId: null,
  users: [],
  teams: [],
  stores: [],
  visits: [],
  attendances: [],
  pendingOps: [],

  init: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      const ok = await hydrateAll(set, get, session.user.id);
      if (!ok) await supabase.auth.signOut();
      else {
        // queued writes from a previous offline session don't exist server-side yet —
        // re-apply their optimistic effect so the UI still reflects them after a restart.
        const queue = await loadQueue();
        for (const op of queue) applyQueuedOpLocally(set, get, op);
        set({ pendingOps: queue });
        if (queue.length) get().processPendingOps();
      }
    }
    set({ ready: true });

    if (!authListenerBound) {
      authListenerBound = true;
      supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          teardownRealtime();
          set({ sessionUserId: null, users: [], teams: [], stores: [], visits: [], attendances: [] });
        }
      });
    }
    if (!netInfoListenerBound) {
      netInfoListenerBound = true;
      NetInfo.addEventListener((state) => {
        if (state.isConnected && get().pendingOps.length) get().processPendingOps();
      });
    }
  },

  processPendingOps: async () => {
    const queue = get().pendingOps;
    if (!queue.length) return;
    const remaining: QueuedOp[] = [];
    for (const op of queue) {
      const done = await replayOp(get, op);
      if (!done) remaining.push(op);
    }
    set({ pendingOps: remaining });
    await saveQueue(remaining);
    if (remaining.length < queue.length && !remaining.length) {
      showDialog('Tersinkron', 'Data yang tersimpan offline berhasil dikirim ke server.');
    }
  },

  login: async (username, password) => {
    const email = `${username.trim().toLowerCase()}@internal.spc`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return 'Username atau password salah.';
    const ok = await hydrateAll(set, get, data.user.id);
    if (!ok) {
      await supabase.auth.signOut();
      return 'Akun dinonaktifkan atau tidak ditemukan. Hubungi admin.';
    }
    return null;
  },

  logout: async () => {
    teardownRealtime();
    await supabase.auth.signOut();
    set({ sessionUserId: null, users: [], teams: [], stores: [], visits: [], attendances: [] });
  },

  addUser: async ({ name, username, password, role, teamId, city, phone }) => {
    const uname = username.trim().toLowerCase();
    if (!name.trim()) return 'Nama wajib diisi.';
    if (!uname) return 'Username wajib diisi.';
    if (get().users.some((u) => u.username.toLowerCase() === uname)) return 'Username sudah dipakai.';
    if (password.length < 4) return 'Password minimal 4 karakter.';
    const { error } = await callAdminUsers({
      action: 'create',
      username: uname,
      password,
      name: name.trim(),
      role,
      teamId: TEAMLESS_ROLES.includes(role) ? null : teamId,
      city,
      phone: phone?.trim(),
    });
    if (error) return error;
    // the new profile row arrives via the realtime subscription (INSERT on profiles).
    return null;
  },

  addUsersBulk: async (rows) => {
    // PRD §13: single-add ("add user") flow was only ever exercised for a
    // handful of demo accounts — this is the bulk path needed before go-live
    // at 215 accounts. Delegates to the same admin-users edge function, one
    // server round-trip per row (createUser doesn't batch server-side), but
    // keeps client-side validation/dedup consistent with addUser above.
    const seenUsernames = new Set(get().users.map((u) => u.username.toLowerCase()));
    let created = 0;
    const errors: string[] = [];
    for (const [i, r] of rows.entries()) {
      const uname = r.username.trim().toLowerCase();
      if (!r.name.trim()) {
        errors.push(`Baris ${i + 1}: nama kosong`);
        continue;
      }
      if (!uname) {
        errors.push(`Baris ${i + 1}: username kosong`);
        continue;
      }
      if (seenUsernames.has(uname)) {
        errors.push(`Baris ${i + 1}: username "${uname}" sudah dipakai`);
        continue;
      }
      if (r.password.length < 4) {
        errors.push(`Baris ${i + 1}: password minimal 4 karakter`);
        continue;
      }
      const { error } = await callAdminUsers({
        action: 'create',
        username: uname,
        password: r.password,
        name: r.name.trim(),
        role: r.role,
        teamId: TEAMLESS_ROLES.includes(r.role) ? null : r.teamId,
        city: r.city,
        phone: r.phone?.trim(),
      });
      if (error) {
        errors.push(`Baris ${i + 1} (${uname}): ${error}`);
        continue;
      }
      seenUsernames.add(uname);
      created++;
    }
    return { created, errors };
  },

  toggleUserActive: async (id) => {
    const target = get().users.find((u) => u.id === id);
    if (!target) return;
    const nextActive = !target.active;
    if (!nextActive && id === get().sessionUserId) {
      showDialog('Tidak Bisa Menonaktifkan Diri Sendiri', 'Minta akun super admin lain untuk menonaktifkan akun ini.');
      return;
    }
    set({ users: get().users.map((u) => (u.id === id ? { ...u, active: nextActive } : u)) });
    const { error } = await supabase.from('profiles').update({ active: nextActive }).eq('id', id);
    if (error) {
      set({ users: get().users.map((u) => (u.id === id ? { ...u, active: target.active } : u)) });
      showDialog('Gagal Menyimpan', 'Tidak dapat mengubah status pengguna. Periksa koneksi internet dan coba lagi.');
    }
  },

  updateUser: async (id, patch) => {
    const target = get().users.find((u) => u.id === id);
    if (!target) return 'Pengguna tidak ditemukan.';

    const nextRole = patch.role ?? target.role;
    const nextTeamId = TEAMLESS_ROLES.includes(nextRole)
      ? null
      : patch.teamId !== undefined
        ? patch.teamId
        : target.teamId;
    const nextName = patch.name?.trim() || target.name;
    const nextPhone = patch.phone !== undefined ? patch.phone : target.phone;
    const nextCity = patch.city !== undefined ? patch.city : target.city;

    const { error } = await supabase
      .from('profiles')
      .update({ name: nextName, role: nextRole, team_id: nextTeamId, phone: nextPhone, city: nextCity })
      .eq('id', id);
    if (error) return 'Gagal menyimpan perubahan.';

    set({
      users: get().users.map((u) =>
        u.id === id ? { ...u, name: nextName, role: nextRole, teamId: nextTeamId, phone: nextPhone, city: nextCity } : u,
      ),
    });
    return null;
  },

  addTeam: async ({ name, city, tlId, arcoId }) => {
    const t: Team = { id: uid('t_'), name: name.trim() || city.trim(), city: city.trim(), tlId, arcoId };
    set({ teams: [...get().teams, t] });
    const { error } = await supabase.from('teams').insert({
      id: t.id,
      name: t.name,
      city: t.city,
      tl_id: t.tlId,
      arco_id: t.arcoId,
    });
    if (error) {
      set({ teams: get().teams.filter((x) => x.id !== t.id) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan tim baru. Periksa koneksi internet dan coba lagi.');
    }
  },

  upsertStore: async (m) => {
    const list = get().stores;
    const exists = list.some((x) => x.id === m.id);
    set({ stores: exists ? list.map((x) => (x.id === m.id ? m : x)) : [m, ...list] });
    const { error } = await supabase.from('stores').upsert({
      id: m.id,
      name: m.name,
      address: m.address,
      city: m.city,
      channel: m.channel,
      account: m.account,
      category: m.category,
      lat: m.lat,
      lng: m.lng,
      assigned_nc_id: m.assignedNcId,
      team_id: m.teamId,
      source: m.source,
      created_at: new Date(m.createdAt).toISOString(),
    });
    if (error) {
      // rollback to the pre-write list — the local cache must not show a
      // store/edit that never actually landed server-side.
      set({ stores: list });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan data toko ke server. Periksa koneksi internet dan coba lagi.');
    }
  },

  assignStores: async (ids, ncId) => {
    let teamId: string | null | undefined;
    if (ncId) {
      const nc = get().users.find((u) => u.id === ncId);
      teamId = nc?.teamId ?? null;
    }
    const before = get().stores;
    set({
      stores: before.map((m) =>
        ids.includes(m.id) ? { ...m, assignedNcId: ncId, teamId: ncId ? teamId! : m.teamId } : m,
      ),
    });
    const patch: Record<string, unknown> = { assigned_nc_id: ncId };
    if (ncId) patch.team_id = teamId;
    const { error } = await supabase.from('stores').update(patch).in('id', ids);
    if (error) {
      set({ stores: before });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan assignment toko. Periksa koneksi internet dan coba lagi.');
    }
  },

  startVisit: async (storeId, ncId, pos, distM, geoValid) => {
    const v: Visit = {
      id: uid('v_'),
      storeId,
      ncId,
      checkInAt: Date.now(),
      checkOutAt: null,
      lat: pos.lat,
      lng: pos.lng,
      storeDistanceM: distM,
      geoValid,
    };
    set({ visits: [v, ...get().visits] });

    if (!(await isOnline())) {
      await enqueueOp(set, get, { id: uid('op_'), type: 'startVisit', visit: v });
      showDialog('Tersimpan Offline', 'Kunjungan tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.');
      return v.id;
    }

    const { error } = await supabase.from('visits').insert({
      id: v.id,
      store_id: v.storeId,
      nc_id: v.ncId,
      check_in_at: new Date(v.checkInAt).toISOString(),
      check_out_at: null,
      ...visitRow(v),
    });
    if (error) {
      set({ visits: get().visits.filter((x) => x.id !== v.id) });
      throw new Error(error.message);
    }
    return v.id;
  },

  finishVisit: async (id) => {
    const s = get();
    const v = s.visits.find((x) => x.id === id);
    if (!v) return;
    const checkOutAt = Date.now();
    const beforeVisits = s.visits;
    set({ visits: s.visits.map((x) => (x.id === id ? { ...x, checkOutAt } : x)) });

    if (!(await isOnline())) {
      await enqueueOp(set, get, { id: uid('op_'), type: 'finishVisit', visitId: id, checkOutAt });
      showDialog('Tersimpan Offline', 'Check-out tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.');
      return;
    }

    const { error } = await supabase.rpc('finish_visit', { p_visit_id: id });
    if (error) {
      set({ visits: beforeVisits });
      throw new Error(error.message);
    }
  },

  clockIn: async (pos, geoFenceOk) => {
    const userId = get().sessionUserId!;
    const t = Date.now();
    const a: Attendance = {
      id: uid('a_'),
      userId,
      clockInAt: t,
      clockInLat: pos.lat,
      clockInLng: pos.lng,
      clockOutAt: null,
      route: [{ ...pos, t }],
      geoFenceOk,
    };
    set({ attendances: [a, ...get().attendances] });

    if (!(await isOnline())) {
      await enqueueOp(set, get, { id: uid('op_'), type: 'clockIn', attendance: a });
      showDialog('Tersimpan Offline', 'Clock-in tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.');
      return a.id;
    }

    const { error } = await supabase.from('attendances').insert({
      id: a.id,
      user_id: a.userId,
      clock_in_at: new Date(a.clockInAt).toISOString(),
      clock_in_lat: a.clockInLat,
      clock_in_lng: a.clockInLng,
      clock_out_at: null,
      geo_fence_ok: a.geoFenceOk,
    });
    if (error) {
      // rollback optimistic state — a failed insert means the user isn't actually
      // clocked in server-side, so the local cache must not claim otherwise.
      set({ attendances: get().attendances.filter((x) => x.id !== a.id) });
      throw new Error(error.message);
    }
    const { error: rpErr } = await supabase
      .from('route_points')
      .insert({ attendance_id: a.id, user_id: userId, lat: pos.lat, lng: pos.lng, recorded_at: new Date(t).toISOString() });
    if (rpErr) console.warn('clockIn route point failed:', rpErr.message);
    return a.id;
  },

  clockOut: async (pos) => {
    const userId = get().sessionUserId!;
    const a = get().attendances.find((x) => x.userId === userId && !x.clockOutAt);
    if (!a) return false;
    const t = Date.now();
    const shouldAddPoint =
      haversineM(a.route[a.route.length - 1] ?? { lat: a.clockInLat, lng: a.clockInLng }, pos) > TRACK_MIN_STEP_M;
    const before = get().attendances;
    set({
      attendances: before.map((x) =>
        x.id === a.id
          ? {
              ...x,
              clockOutAt: t,
              clockOutLat: pos.lat,
              clockOutLng: pos.lng,
              route: shouldAddPoint ? [...x.route, { ...pos, t }] : x.route,
            }
          : x,
      ),
    });

    if (!(await isOnline())) {
      await enqueueOp(set, get, { id: uid('op_'), type: 'clockOut', attendanceId: a.id, clockOutAt: t, lat: pos.lat, lng: pos.lng });
      showDialog('Tersimpan Offline', 'Clock-out tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.');
      return true;
    }

    const { error } = await supabase
      .from('attendances')
      .update({ clock_out_at: new Date(t).toISOString(), clock_out_lat: pos.lat, clock_out_lng: pos.lng })
      .eq('id', a.id);
    if (error) {
      set({ attendances: before });
      throw new Error(error.message);
    }
    if (shouldAddPoint) {
      const { error: rpErr } = await supabase
        .from('route_points')
        .insert({ attendance_id: a.id, user_id: userId, lat: pos.lat, lng: pos.lng, recorded_at: new Date(t).toISOString() });
      if (rpErr) console.warn('clockOut route point failed:', rpErr.message);
    }
    return false;
  },

  addRoutePoint: (userId, p) => {
    const a = get().attendances.find((x) => x.userId === userId && !x.clockOutAt);
    if (!a) return;
    const last = a.route[a.route.length - 1];
    if (last && haversineM(last, p) < TRACK_MIN_STEP_M) return;
    const t = Date.now();
    set({
      attendances: get().attendances.map((x) => (x.id === a.id ? { ...x, route: [...x.route, { ...p, t }] } : x)),
    });
    supabase
      .from('route_points')
      .insert({ attendance_id: a.id, user_id: userId, lat: p.lat, lng: p.lng, recorded_at: new Date(t).toISOString() })
      .then(({ error }) => {
        if (error) console.warn('addRoutePoint failed:', error.message);
      });
  },
}));

export function useCurrentUser(): User | null {
  return useStore((s) =>
    s.sessionUserId ? (s.users.find((u) => u.id === s.sessionUserId) ?? null) : null,
  );
}
