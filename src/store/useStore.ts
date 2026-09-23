import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { showDialog } from '../components/dialog';
import { TRACK_MIN_STEP_M } from '../config';
import {
  Attendance,
  CoachingLog,
  Consumer,
  NtgGwp,
  OfftakeRow,
  PaidVisibilityRow,
  PriceMonitoringRow,
  Product,
  ReportReview,
  ReportReviewStatus,
  ReportType,
  Role,
  RoutePoint,
  ShareOfShelfRow,
  StockTakingRow,
  Store,
  StoreCategory,
  Survey,
  SurveyResponse,
  Target,
  Team,
  User,
  Visit,
} from '../types';
import { haversineM } from '../utils/geo';
import { loadQueue, saveQueue, QueuedOp } from '../utils/offlineQueue';
import { extFromUri, uploadReportMedia } from '../utils/storage';
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
  /** Phase 2 (PRD §16) — product master + the 3 core daily report modules. */
  products: Product[];
  stockTakingRows: StockTakingRow[];
  offtakeRows: OfftakeRow[];
  consumers: Consumer[];
  ntgGwps: NtgGwp[];
  /** Phase 3 (PRD §16) — bi-weekly/periodic modules. */
  shareOfShelfRows: ShareOfShelfRow[];
  paidVisibilityRows: PaidVisibilityRow[];
  priceMonitoringRows: PriceMonitoringRow[];
  surveys: Survey[];
  surveyResponses: SurveyResponse[];
  /** Phase 4a (PRD §16) — TL/ARCO exception-based validation queue + coaching log (PRD §8). */
  reportReviews: ReportReview[];
  coachingLogs: CoachingLog[];
  /** Offtake/GWP targets set by Data Analyst (PRD §12) — schema existed since Phase 1 but was
   * never wired into the store until Phase 4a needed "offtake vs. target" for the TL/ARCO and
   * PM/Reckitt dashboards. */
  targets: Target[];
  /** Clock-in/out, store check-in/out, and Stock Taking/Offtake submissions still waiting for connectivity to reach Supabase. */
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

  // --- Phase 2: product master + core daily report modules ---
  upsertProduct(p: Product): Promise<void>;
  /** Bulk create from CSV (Data Analyst/Admin Data Entry/Super Admin), mirrors addUsersBulk's shape. */
  addProductsBulk(
    rows: Array<{ sku: string; name: string; category?: string }>,
  ): Promise<{ created: number; errors: string[] }>;

  /** Stock Taking (PRD §5.1) — offline-queued like clock/check ops (text-primary, no required photo). */
  submitStockTaking(
    visitId: string,
    storeId: string,
    rows: Array<{ sku: string; qtyOnHand: number; outOfStock: boolean }>,
    photoUri?: string,
  ): Promise<{ queued: boolean }>;
  /** Offtake (PRD §5.3) — offline-queued; outlier flag is server-computed (trigger), never set client-side. */
  submitOfftake(
    visitId: string,
    storeId: string,
    rows: Array<{ sku: string; unitsSold: number; revenue?: number }>,
  ): Promise<{ queued: boolean; outlierSkus: string[] }>;

  /** NTG & GWP consumer funnel (PRD §5.4) — online-required, like upsertStore (richer/less frequent than clock/check writes). */
  upsertConsumer(c: Consumer): Promise<string | null>;
  upsertNtgGwp(n: NtgGwp): Promise<string | null>;

  // --- Phase 3: bi-weekly/periodic modules (PRD §5.2, §5.5, §5.6, §5.7/§6) ---
  // All online-required (no offline queue) — required-photo modules can't queue
  // the photo (see offlineQueue.ts comment), and Price Monitoring/Survey are
  // low-frequency enough not to justify extending the queue further.

  /** Share of Shelf (PRD §5.2) — required photo; fails outright if offline or the upload fails. */
  submitShareOfShelf(
    visitId: string,
    storeId: string,
    input: { channel: string; category: StoreCategory; ownFacingCount: number; totalFacingCount: number },
    photoUri: string,
  ): Promise<void>;
  /** Paid Visibility (PRD §5.5) — required photo, same online-or-fail contract as Share of Shelf. */
  submitPaidVisibility(
    visitId: string,
    storeId: string,
    input: { visibilityType: string; complianceChecklist: Record<string, boolean> },
    photoUri: string,
  ): Promise<void>;
  /** Price Monitoring (PRD §5.6) — optional photo; a failed optional-photo upload is a soft-fail (row still saves). */
  submitPriceMonitoring(
    visitId: string,
    storeId: string,
    rows: Array<{ sku: string; ownPrice: number; competitorPrices: number[] }>,
    photoUri?: string,
  ): Promise<void>;

  /** Survey (PRD §5.7) — generic question sets; also backs the Nutrition Quiz (§6) via NutritionQuizScreen. */
  upsertSurvey(s: Survey): Promise<string | null>;
  submitSurveyResponse(r: SurveyResponse): Promise<string | null>;

  // --- Phase 4a: TL/ARCO validation console (PRD §8) ---
  /** Approve or flag a report row (exception-based queue — PRD §8 review note). Plain online write, no offline queue (desk-review action, not field-critical). */
  reviewReport(reportType: ReportType, reportId: string, status: ReportReviewStatus, note?: string): Promise<string | null>;
  upsertCoachingLog(log: CoachingLog): Promise<string | null>;
  /** Data Analyst/super_admin only (matches targets RLS write policy, 0001 migration). */
  upsertTarget(t: Target): Promise<string | null>;

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

/** Consumers scoped by the NC who created them (PRD §5.4/§17 consumer flow) — mirrors scopeUsers/storeScope. */
export function consumerScope(s: Pick<StoreState, 'consumers' | 'users' | 'teams'>, viewer: User): Consumer[] {
  if (viewer.role === 'nc') return s.consumers.filter((c) => c.createdByNcId === viewer.id);
  if (viewer.role === 'tl') {
    const ncIds = new Set(s.users.filter((u) => u.teamId === viewer.teamId).map((u) => u.id));
    return s.consumers.filter((c) => ncIds.has(c.createdByNcId));
  }
  if (viewer.role === 'arco') {
    const myTeamIds = new Set(s.teams.filter((t) => t.arcoId === viewer.id).map((t) => t.id));
    const ncIds = new Set(s.users.filter((u) => u.teamId && myTeamIds.has(u.teamId)).map((u) => u.id));
    return s.consumers.filter((c) => ncIds.has(c.createdByNcId));
  }
  return s.consumers; // monitor roles: program-wide
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

function mapProduct(p: any): Product {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category ?? undefined,
    active: p.active,
    createdAt: new Date(p.created_at).getTime(),
  };
}

function mapStockTaking(r: any): StockTakingRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    sku: r.sku,
    qtyOnHand: r.qty_on_hand,
    outOfStock: r.out_of_stock,
    photoUrl: r.photo_url ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
  };
}

function mapOfftake(r: any): OfftakeRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    sku: r.sku,
    unitsSold: r.units_sold,
    revenue: r.revenue ?? undefined,
    isOutlier: r.is_outlier,
    createdAt: new Date(r.created_at).getTime(),
  };
}

function mapConsumer(c: any): Consumer {
  return {
    id: c.id,
    name: c.name,
    waContact: c.wa_contact,
    consent: c.consent,
    childAgeBracket: c.child_age_bracket ?? '',
    currentBrand: c.current_brand ?? undefined,
    quizResult: c.quiz_result ?? undefined,
    createdByNcId: c.created_by_nc_id,
    createdAt: new Date(c.created_at).getTime(),
  };
}

function mapNtgGwp(g: any): NtgGwp {
  return {
    id: g.id,
    consumerId: g.consumer_id,
    visitId: g.visit_id,
    stage: g.stage,
    gwpItem: g.gwp_item ?? undefined,
    gwpQty: g.gwp_qty ?? undefined,
    offtakeId: g.offtake_id ?? undefined,
    createdAt: new Date(g.created_at).getTime(),
  };
}

function mapShareOfShelf(r: any): ShareOfShelfRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    channel: r.channel,
    category: r.category,
    ownFacingCount: r.own_facing_count,
    totalFacingCount: r.total_facing_count,
    photoUrl: r.photo_url,
    createdAt: new Date(r.created_at).getTime(),
  };
}

function mapPaidVisibility(r: any): PaidVisibilityRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    visibilityType: r.visibility_type,
    complianceChecklist: r.compliance_checklist ?? {},
    photoUrl: r.photo_url,
    createdAt: new Date(r.created_at).getTime(),
  };
}

function mapPriceMonitoring(r: any): PriceMonitoringRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    sku: r.sku,
    ownPrice: r.own_price,
    competitorPrices: r.competitor_prices ?? [],
    photoUrl: r.photo_url ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
  };
}

function mapSurvey(s: any): Survey {
  return {
    id: s.id,
    title: s.title,
    questions: s.questions ?? [],
    campaignTag: s.campaign_tag ?? undefined,
    createdBy: s.created_by,
    createdAt: new Date(s.created_at).getTime(),
  };
}

function mapSurveyResponse(r: any): SurveyResponse {
  return {
    id: r.id,
    surveyId: r.survey_id,
    visitId: r.visit_id ?? null,
    consumerId: r.consumer_id ?? null,
    answers: r.answers ?? {},
    createdAt: new Date(r.created_at).getTime(),
  };
}

function mapTarget(t: any): Target {
  return {
    id: t.id,
    storeId: t.store_id ?? null,
    ncId: t.nc_id ?? null,
    periodKey: t.period_key,
    offtakeTarget: t.offtake_target ?? undefined,
    gwpAllocation: t.gwp_allocation ?? undefined,
    setBy: t.set_by,
  };
}

function mapReportReview(r: any): ReportReview {
  return {
    id: r.id,
    reportType: r.report_type,
    reportId: r.report_id,
    status: r.status,
    reviewedBy: r.reviewed_by ?? undefined,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).getTime() : undefined,
    note: r.note ?? undefined,
  };
}

function mapCoachingLog(l: any): CoachingLog {
  return {
    id: l.id,
    tlId: l.tl_id,
    ncId: l.nc_id,
    date: new Date(l.date).getTime(),
    note: l.note,
    createdAt: new Date(l.created_at).getTime(),
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
    case 'submitStockTaking': {
      const existing = get().stockTakingRows;
      const fresh = op.rows.filter((r) => !existing.some((x) => x.id === r.id));
      if (fresh.length) set({ stockTakingRows: [...fresh, ...existing] });
      break;
    }
    case 'submitOfftake': {
      const existing = get().offtakeRows;
      const fresh = op.rows.filter((r) => !existing.some((x) => x.id === r.id));
      if (fresh.length) set({ offtakeRows: [...fresh, ...existing] });
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

function stockTakingRow(r: StockTakingRow) {
  return {
    id: r.id,
    visit_id: r.visitId,
    store_id: r.storeId,
    sku: r.sku,
    qty_on_hand: r.qtyOnHand,
    out_of_stock: r.outOfStock,
    photo_url: r.photoUrl ?? null,
    created_at: new Date(r.createdAt).toISOString(),
  };
}

/** `is_outlier` deliberately omitted — the server trigger (offtake_flag_outlier,
 * 0003 migration) sets it on insert; the client never writes this column. */
function offtakeRow(r: OfftakeRow) {
  return {
    id: r.id,
    visit_id: r.visitId,
    store_id: r.storeId,
    sku: r.sku,
    units_sold: r.unitsSold,
    revenue: r.revenue ?? null,
    created_at: new Date(r.createdAt).toISOString(),
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
  if (op.type === 'submitStockTaking') {
    const { error } = await supabase.from('stock_taking').insert(op.rows.map(stockTakingRow));
    return !error;
  }
  if (op.type === 'submitOfftake') {
    // Replayed inserts don't read back is_outlier — the row's flag stays as last
    // known (false) locally until the next hydrateAll/realtime update corrects
    // it; the server-side value (set by the trigger) is authoritative regardless.
    const { error } = await supabase.from('offtake').insert(op.rows.map(offtakeRow));
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ products: get().products.filter((p) => p.id !== (payload.old as any).id) });
      } else {
        set({ products: upsertById(get().products, mapProduct(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_taking' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ stockTakingRows: get().stockTakingRows.filter((r) => r.id !== (payload.old as any).id) });
      } else {
        set({ stockTakingRows: upsertById(get().stockTakingRows, mapStockTaking(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'offtake' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ offtakeRows: get().offtakeRows.filter((r) => r.id !== (payload.old as any).id) });
      } else {
        set({ offtakeRows: upsertById(get().offtakeRows, mapOfftake(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'consumers' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ consumers: get().consumers.filter((c) => c.id !== (payload.old as any).id) });
      } else {
        set({ consumers: upsertById(get().consumers, mapConsumer(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ntg_gwp' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ ntgGwps: get().ntgGwps.filter((g) => g.id !== (payload.old as any).id) });
      } else {
        set({ ntgGwps: upsertById(get().ntgGwps, mapNtgGwp(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'share_of_shelf' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ shareOfShelfRows: get().shareOfShelfRows.filter((r) => r.id !== (payload.old as any).id) });
      } else {
        set({ shareOfShelfRows: upsertById(get().shareOfShelfRows, mapShareOfShelf(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'paid_visibility' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ paidVisibilityRows: get().paidVisibilityRows.filter((r) => r.id !== (payload.old as any).id) });
      } else {
        set({ paidVisibilityRows: upsertById(get().paidVisibilityRows, mapPaidVisibility(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'price_monitoring' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ priceMonitoringRows: get().priceMonitoringRows.filter((r) => r.id !== (payload.old as any).id) });
      } else {
        set({ priceMonitoringRows: upsertById(get().priceMonitoringRows, mapPriceMonitoring(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'surveys' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ surveys: get().surveys.filter((s) => s.id !== (payload.old as any).id) });
      } else {
        set({ surveys: upsertById(get().surveys, mapSurvey(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'survey_responses' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ surveyResponses: get().surveyResponses.filter((r) => r.id !== (payload.old as any).id) });
      } else {
        set({ surveyResponses: upsertById(get().surveyResponses, mapSurveyResponse(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'report_reviews' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ reportReviews: get().reportReviews.filter((r) => r.id !== (payload.old as any).id) });
      } else {
        set({ reportReviews: upsertById(get().reportReviews, mapReportReview(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coaching_logs' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ coachingLogs: get().coachingLogs.filter((l) => l.id !== (payload.old as any).id) });
      } else {
        set({ coachingLogs: upsertById(get().coachingLogs, mapCoachingLog(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'targets' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ targets: get().targets.filter((t) => t.id !== (payload.old as any).id) });
      } else {
        set({ targets: upsertById(get().targets, mapTarget(payload.new)) });
      }
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

  const [
    profilesRes,
    teamsRes,
    storesRes,
    visitsRes,
    attendancesRes,
    productsRes,
    stockTakingRes,
    offtakeRes,
    consumersRes,
    ntgGwpRes,
    shareOfShelfRes,
    paidVisibilityRes,
    priceMonitoringRes,
    surveysRes,
    surveyResponsesRes,
    reportReviewsRes,
    coachingLogsRes,
    targetsRes,
  ] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('teams').select('*'),
    supabase.from('stores').select('*'),
    supabase.from('visits').select('*'),
    supabase.from('attendances').select('*'),
    supabase.from('products').select('*'),
    supabase.from('stock_taking').select('*'),
    supabase.from('offtake').select('*'),
    supabase.from('consumers').select('*'),
    supabase.from('ntg_gwp').select('*'),
    supabase.from('share_of_shelf').select('*'),
    supabase.from('paid_visibility').select('*'),
    supabase.from('price_monitoring').select('*'),
    supabase.from('surveys').select('*'),
    supabase.from('survey_responses').select('*'),
    supabase.from('report_reviews').select('*'),
    supabase.from('coaching_logs').select('*'),
    supabase.from('targets').select('*'),
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
    products: (productsRes.data ?? []).map(mapProduct),
    stockTakingRows: (stockTakingRes.data ?? []).map(mapStockTaking),
    offtakeRows: (offtakeRes.data ?? []).map(mapOfftake),
    consumers: (consumersRes.data ?? []).map(mapConsumer),
    ntgGwps: (ntgGwpRes.data ?? []).map(mapNtgGwp),
    shareOfShelfRows: (shareOfShelfRes.data ?? []).map(mapShareOfShelf),
    paidVisibilityRows: (paidVisibilityRes.data ?? []).map(mapPaidVisibility),
    priceMonitoringRows: (priceMonitoringRes.data ?? []).map(mapPriceMonitoring),
    surveys: (surveysRes.data ?? []).map(mapSurvey),
    surveyResponses: (surveyResponsesRes.data ?? []).map(mapSurveyResponse),
    reportReviews: (reportReviewsRes.data ?? []).map(mapReportReview),
    coachingLogs: (coachingLogsRes.data ?? []).map(mapCoachingLog),
    targets: (targetsRes.data ?? []).map(mapTarget),
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
  products: [],
  stockTakingRows: [],
  offtakeRows: [],
  consumers: [],
  ntgGwps: [],
  shareOfShelfRows: [],
  paidVisibilityRows: [],
  priceMonitoringRows: [],
  surveys: [],
  surveyResponses: [],
  reportReviews: [],
  coachingLogs: [],
  targets: [],
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
          set({
            sessionUserId: null,
            users: [],
            teams: [],
            stores: [],
            visits: [],
            attendances: [],
            products: [],
            stockTakingRows: [],
            offtakeRows: [],
            consumers: [],
            ntgGwps: [],
            shareOfShelfRows: [],
            paidVisibilityRows: [],
            priceMonitoringRows: [],
            surveys: [],
            surveyResponses: [],
            reportReviews: [],
            coachingLogs: [],
            targets: [],
          });
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
    set({
            sessionUserId: null,
            users: [],
            teams: [],
            stores: [],
            visits: [],
            attendances: [],
            products: [],
            stockTakingRows: [],
            offtakeRows: [],
            consumers: [],
            ntgGwps: [],
            shareOfShelfRows: [],
            paidVisibilityRows: [],
            priceMonitoringRows: [],
            surveys: [],
            surveyResponses: [],
            reportReviews: [],
            coachingLogs: [],
            targets: [],
          });
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

  // --- Phase 2: product master ------------------------------------------

  upsertProduct: async (p) => {
    const list = get().products;
    const exists = list.some((x) => x.id === p.id);
    set({ products: exists ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list] });
    const { error } = await supabase.from('products').upsert({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      active: p.active,
      created_at: new Date(p.createdAt).toISOString(),
    });
    if (error) {
      set({ products: list });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan produk ke server. Periksa koneksi internet dan coba lagi.');
    }
  },

  addProductsBulk: async (rows) => {
    const seenSkus = new Set(get().products.map((p) => p.sku.toLowerCase()));
    const errors: string[] = [];
    const toInsert: Product[] = [];
    rows.forEach((r, i) => {
      const sku = r.sku.trim();
      const name = r.name.trim();
      if (!sku) {
        errors.push(`Baris ${i + 1}: SKU kosong`);
        return;
      }
      if (!name) {
        errors.push(`Baris ${i + 1}: nama kosong`);
        return;
      }
      if (seenSkus.has(sku.toLowerCase())) {
        errors.push(`Baris ${i + 1}: SKU "${sku}" sudah ada`);
        return;
      }
      seenSkus.add(sku.toLowerCase());
      toInsert.push({ id: uid('p_'), sku, name, category: r.category?.trim() || undefined, active: true, createdAt: Date.now() });
    });

    if (!toInsert.length) return { created: 0, errors };

    set({ products: [...toInsert, ...get().products] });
    const { error } = await supabase.from('products').insert(
      toInsert.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        active: p.active,
        created_at: new Date(p.createdAt).toISOString(),
      })),
    );
    if (error) {
      set({ products: get().products.filter((p) => !toInsert.some((t) => t.id === p.id)) });
      errors.push(`Gagal menyimpan ke server: ${error.message}`);
      return { created: 0, errors };
    }
    return { created: toInsert.length, errors };
  },

  // --- Phase 2: Stock Taking / Offtake (PRD §5.1, §5.3) -------------------
  // Offline-queued like clock/check ops — text-primary daily-critical reports,
  // no required photo evidence (see offlineQueue.ts's QueuedOp comment).

  submitStockTaking: async (visitId, storeId, rows, photoUri) => {
    const clean = rows
      .map((r) => ({ sku: r.sku.trim(), qtyOnHand: r.qtyOnHand, outOfStock: r.outOfStock }))
      .filter((r) => r.sku && r.qtyOnHand >= 0);
    if (!clean.length) throw new Error('Isi minimal satu SKU dengan jumlah valid (>= 0).');

    const online = await isOnline();
    let photoUrl: string | undefined;
    if (photoUri) {
      if (online) {
        try {
          photoUrl = await uploadReportMedia(visitId, photoUri, extFromUri(photoUri));
        } catch {
          showDialog('Foto Gagal Diupload', 'Laporan tetap disimpan tanpa foto. Coba lampirkan foto lagi nanti.');
        }
      } else {
        showDialog(
          'Offline',
          'Foto tidak disertakan karena tidak ada koneksi. Laporan tetap tersimpan; lampirkan foto saat online jika perlu.',
        );
      }
    }

    const now = Date.now();
    const newRows: StockTakingRow[] = clean.map((r) => ({
      id: uid('stk_'),
      visitId,
      storeId,
      sku: r.sku,
      qtyOnHand: r.qtyOnHand,
      outOfStock: r.outOfStock,
      photoUrl,
      createdAt: now,
    }));

    set({ stockTakingRows: [...newRows, ...get().stockTakingRows] });

    if (!online) {
      await enqueueOp(set, get, { id: uid('op_'), type: 'submitStockTaking', rows: newRows });
      showDialog('Tersimpan Offline', 'Stock Taking tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.');
      return { queued: true };
    }

    const { error } = await supabase.from('stock_taking').insert(newRows.map(stockTakingRow));
    if (error) {
      set({ stockTakingRows: get().stockTakingRows.filter((x) => !newRows.some((n) => n.id === x.id)) });
      throw new Error(error.message);
    }
    return { queued: false };
  },

  submitOfftake: async (visitId, storeId, rows) => {
    const clean = rows
      .map((r) => ({ sku: r.sku.trim(), unitsSold: r.unitsSold, revenue: r.revenue }))
      .filter((r) => r.sku && r.unitsSold >= 0);
    if (!clean.length) throw new Error('Isi minimal satu SKU dengan unit terjual valid (>= 0).');

    const now = Date.now();
    const newRows: OfftakeRow[] = clean.map((r) => ({
      id: uid('otk_'),
      visitId,
      storeId,
      sku: r.sku,
      unitsSold: r.unitsSold,
      revenue: r.revenue,
      isOutlier: false, // server trigger (0003 migration) sets the real value on insert
      createdAt: now,
    }));

    set({ offtakeRows: [...newRows, ...get().offtakeRows] });

    if (!(await isOnline())) {
      await enqueueOp(set, get, { id: uid('op_'), type: 'submitOfftake', rows: newRows });
      showDialog(
        'Tersimpan Offline',
        'Offtake tersimpan di HP dan akan otomatis disinkron saat koneksi kembali. Deteksi outlier dihitung saat data tersinkron ke server.',
      );
      return { queued: true, outlierSkus: [] };
    }

    const { data, error } = await supabase.from('offtake').insert(newRows.map(offtakeRow)).select('sku, is_outlier');
    if (error) {
      set({ offtakeRows: get().offtakeRows.filter((x) => !newRows.some((n) => n.id === x.id)) });
      throw new Error(error.message);
    }
    const outlierSkus = (data ?? []).filter((r: any) => r.is_outlier).map((r: any) => r.sku as string);
    if (outlierSkus.length) {
      set({
        offtakeRows: get().offtakeRows.map((x) =>
          newRows.some((n) => n.id === x.id) && outlierSkus.includes(x.sku) ? { ...x, isOutlier: true } : x,
        ),
      });
    }
    return { queued: false, outlierSkus };
  },

  // --- Phase 2: NTG & GWP consumer funnel (PRD §5.4) -----------------------
  // Online-required, like upsertStore — richer/less frequent than clock/check
  // writes, so not worth extending the offline queue to (see PRD review note).

  upsertConsumer: async (c) => {
    const list = get().consumers;
    const exists = list.some((x) => x.id === c.id);
    set({ consumers: exists ? list.map((x) => (x.id === c.id ? c : x)) : [c, ...list] });
    const { error } = await supabase.from('consumers').upsert({
      id: c.id,
      name: c.name,
      wa_contact: c.waContact,
      consent: c.consent,
      child_age_bracket: c.childAgeBracket,
      current_brand: c.currentBrand,
      quiz_result: c.quizResult,
      created_by_nc_id: c.createdByNcId,
      created_at: new Date(c.createdAt).toISOString(),
    });
    if (error) {
      set({ consumers: list });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan data konsumen ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  upsertNtgGwp: async (n) => {
    const list = get().ntgGwps;
    const exists = list.some((x) => x.id === n.id);
    set({ ntgGwps: exists ? list.map((x) => (x.id === n.id ? n : x)) : [n, ...list] });
    const { error } = await supabase.from('ntg_gwp').upsert({
      id: n.id,
      consumer_id: n.consumerId,
      visit_id: n.visitId,
      stage: n.stage,
      gwp_item: n.gwpItem,
      gwp_qty: n.gwpQty,
      offtake_id: n.offtakeId,
      created_at: new Date(n.createdAt).toISOString(),
    });
    if (error) {
      set({ ntgGwps: list });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan data NTG & GWP ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  // --- Phase 3: Share of Shelf / Paid Visibility (PRD §5.2, §5.5) ---------
  // Required-photo modules — no offline queue for these (see offlineQueue.ts
  // comment): fail outright rather than partially save a required-evidence
  // report without its photo.

  submitShareOfShelf: async (visitId, storeId, input, photoUri) => {
    if (input.ownFacingCount < 0 || input.totalFacingCount < 0) {
      throw new Error('Jumlah facing tidak boleh negatif.');
    }
    if (input.ownFacingCount > input.totalFacingCount) {
      throw new Error('Own facing tidak boleh melebihi total facing.');
    }
    if (!(await isOnline())) {
      showDialog('Offline', 'Share of Shelf butuh foto sebagai bukti wajib — tidak dapat disimpan tanpa koneksi internet. Coba lagi saat online.');
      throw new Error('Tidak ada koneksi internet.');
    }
    let photoUrl: string;
    try {
      photoUrl = await uploadReportMedia(visitId, photoUri, extFromUri(photoUri));
    } catch {
      showDialog('Gagal Upload Foto', 'Foto wajib untuk Share of Shelf tidak berhasil diupload. Laporan tidak disimpan — coba lagi.');
      throw new Error('Upload foto gagal.');
    }
    const row: ShareOfShelfRow = {
      id: uid('sos_'),
      visitId,
      storeId,
      channel: input.channel,
      category: input.category,
      ownFacingCount: input.ownFacingCount,
      totalFacingCount: input.totalFacingCount,
      photoUrl,
      createdAt: Date.now(),
    };
    set({ shareOfShelfRows: [row, ...get().shareOfShelfRows] });
    const { error } = await supabase.from('share_of_shelf').insert({
      id: row.id,
      visit_id: row.visitId,
      store_id: row.storeId,
      channel: row.channel,
      category: row.category,
      own_facing_count: row.ownFacingCount,
      total_facing_count: row.totalFacingCount,
      photo_url: row.photoUrl,
      created_at: new Date(row.createdAt).toISOString(),
    });
    if (error) {
      set({ shareOfShelfRows: get().shareOfShelfRows.filter((x) => x.id !== row.id) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan Share of Shelf ke server. Periksa koneksi internet dan coba lagi.');
      throw new Error(error.message);
    }
  },

  submitPaidVisibility: async (visitId, storeId, input, photoUri) => {
    if (!input.visibilityType) throw new Error('Pilih jenis visibility.');
    if (!(await isOnline())) {
      showDialog('Offline', 'Paid Visibility butuh foto sebagai bukti wajib — tidak dapat disimpan tanpa koneksi internet. Coba lagi saat online.');
      throw new Error('Tidak ada koneksi internet.');
    }
    let photoUrl: string;
    try {
      photoUrl = await uploadReportMedia(visitId, photoUri, extFromUri(photoUri));
    } catch {
      showDialog('Gagal Upload Foto', 'Foto wajib untuk Paid Visibility tidak berhasil diupload. Laporan tidak disimpan — coba lagi.');
      throw new Error('Upload foto gagal.');
    }
    const row: PaidVisibilityRow = {
      id: uid('pv_'),
      visitId,
      storeId,
      visibilityType: input.visibilityType,
      complianceChecklist: input.complianceChecklist,
      photoUrl,
      createdAt: Date.now(),
    };
    set({ paidVisibilityRows: [row, ...get().paidVisibilityRows] });
    const { error } = await supabase.from('paid_visibility').insert({
      id: row.id,
      visit_id: row.visitId,
      store_id: row.storeId,
      visibility_type: row.visibilityType,
      compliance_checklist: row.complianceChecklist,
      photo_url: row.photoUrl,
      created_at: new Date(row.createdAt).toISOString(),
    });
    if (error) {
      set({ paidVisibilityRows: get().paidVisibilityRows.filter((x) => x.id !== row.id) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan Paid Visibility ke server. Periksa koneksi internet dan coba lagi.');
      throw new Error(error.message);
    }
  },

  // --- Phase 3: Price Monitoring (PRD §5.6) — optional photo -------------

  submitPriceMonitoring: async (visitId, storeId, rows, photoUri) => {
    const clean = rows
      .map((r) => ({
        sku: r.sku.trim(),
        ownPrice: r.ownPrice,
        competitorPrices: r.competitorPrices.filter((p) => p >= 0).slice(0, 3),
      }))
      .filter((r) => r.sku && r.ownPrice >= 0);
    if (!clean.length) throw new Error('Isi minimal satu SKU dengan harga sendiri yang valid (>= 0).');
    if (!(await isOnline())) {
      showDialog('Offline', 'Price Monitoring butuh koneksi internet untuk disimpan (tidak masuk antrian offline). Coba lagi saat online.');
      throw new Error('Tidak ada koneksi internet.');
    }

    let photoUrl: string | undefined;
    if (photoUri) {
      try {
        photoUrl = await uploadReportMedia(visitId, photoUri, extFromUri(photoUri));
      } catch {
        showDialog('Foto Gagal Diupload', 'Laporan tetap disimpan tanpa foto (foto bersifat opsional). Coba lampirkan foto lagi nanti.');
      }
    }

    const now = Date.now();
    const newRows: PriceMonitoringRow[] = clean.map((r) => ({
      id: uid('pm_'),
      visitId,
      storeId,
      sku: r.sku,
      ownPrice: r.ownPrice,
      competitorPrices: r.competitorPrices,
      photoUrl,
      createdAt: now,
    }));
    set({ priceMonitoringRows: [...newRows, ...get().priceMonitoringRows] });
    const { error } = await supabase.from('price_monitoring').insert(
      newRows.map((r) => ({
        id: r.id,
        visit_id: r.visitId,
        store_id: r.storeId,
        sku: r.sku,
        own_price: r.ownPrice,
        competitor_prices: r.competitorPrices,
        photo_url: r.photoUrl ?? null,
        created_at: new Date(r.createdAt).toISOString(),
      })),
    );
    if (error) {
      set({ priceMonitoringRows: get().priceMonitoringRows.filter((x) => !newRows.some((n) => n.id === x.id)) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan Price Monitoring ke server. Periksa koneksi internet dan coba lagi.');
      throw new Error(error.message);
    }
  },

  // --- Phase 3: Survey (PRD §5.7) + Nutrition Quiz (PRD §6, via NutritionQuizScreen) ---

  upsertSurvey: async (s) => {
    const list = get().surveys;
    const exists = list.some((x) => x.id === s.id);
    set({ surveys: exists ? list.map((x) => (x.id === s.id ? s : x)) : [s, ...list] });
    const { error } = await supabase.from('surveys').upsert({
      id: s.id,
      title: s.title,
      questions: s.questions,
      campaign_tag: s.campaignTag,
      created_by: s.createdBy,
      created_at: new Date(s.createdAt).toISOString(),
    });
    if (error) {
      set({ surveys: list });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan survey ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  submitSurveyResponse: async (r) => {
    const list = get().surveyResponses;
    set({ surveyResponses: [r, ...list] });
    const { error } = await supabase.from('survey_responses').insert({
      id: r.id,
      survey_id: r.surveyId,
      visit_id: r.visitId,
      consumer_id: r.consumerId,
      answers: r.answers,
      created_at: new Date(r.createdAt).toISOString(),
    });
    if (error) {
      set({ surveyResponses: get().surveyResponses.filter((x) => x.id !== r.id) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan jawaban survey ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  // --- Phase 4a: TL/ARCO validation console (PRD §8) ----------------------
  // Plain online writes, optimistic + rollback like upsertStore — these are
  // TL/ARCO desk-review actions, not field-critical writes, so no offline queue.

  reviewReport: async (reportType, reportId, status, note) => {
    const me = get().users.find((u) => u.id === get().sessionUserId);
    if (!me) return 'Sesi tidak ditemukan.';
    const existing = get().reportReviews.find((r) => r.reportType === reportType && r.reportId === reportId);
    const now = Date.now();
    const row: ReportReview = {
      id: existing?.id ?? uid('rr_'),
      reportType,
      reportId,
      status,
      reviewedBy: me.id,
      reviewedAt: now,
      note: note?.trim() || undefined,
    };
    const before = get().reportReviews;
    set({ reportReviews: upsertById(before, row) });
    const { error } = await supabase.from('report_reviews').upsert({
      id: row.id,
      report_type: row.reportType,
      report_id: row.reportId,
      status: row.status,
      reviewed_by: row.reviewedBy,
      reviewed_at: new Date(row.reviewedAt!).toISOString(),
      note: row.note,
    });
    if (error) {
      set({ reportReviews: before });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan status review. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  upsertCoachingLog: async (log) => {
    const list = get().coachingLogs;
    const exists = list.some((x) => x.id === log.id);
    set({ coachingLogs: exists ? list.map((x) => (x.id === log.id ? log : x)) : [log, ...list] });
    const { error } = await supabase.from('coaching_logs').upsert({
      id: log.id,
      tl_id: log.tlId,
      nc_id: log.ncId,
      date: new Date(log.date).toISOString(),
      note: log.note,
      created_at: new Date(log.createdAt).toISOString(),
    });
    if (error) {
      set({ coachingLogs: list });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan catatan coaching ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  upsertTarget: async (t) => {
    const list = get().targets;
    const exists = list.some((x) => x.id === t.id);
    set({ targets: exists ? list.map((x) => (x.id === t.id ? t : x)) : [t, ...list] });
    const { error } = await supabase.from('targets').upsert({
      id: t.id,
      store_id: t.storeId,
      nc_id: t.ncId,
      period_key: t.periodKey,
      offtake_target: t.offtakeTarget,
      gwp_allocation: t.gwpAllocation,
      set_by: t.setBy,
    });
    if (error) {
      set({ targets: list });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan target ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
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
