import { create } from 'zustand';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { showDialog } from '../components/dialog';
import { TRACK_MIN_STEP_M } from '../config';
import {
  Attendance,
  CoachingLog,
  Consumer,
  Conversation,
  ConversationType,
  Message,
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
  Scorecard,
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
import { discardLocalPhoto, extFromUri, localPhotoExists, persistPhotoLocally, uploadReportMedia } from '../utils/storage';
import { fmtDate } from '../utils/format';
import { uid } from '../utils/uuid';

/** Thrown by actions that have already explained the failure to the user via
 * showDialog — screens must not show a second dialog for it. */
export class ShownError extends Error {}

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

/** Must match MIN_PASSWORD in supabase/functions/admin-users/index.ts. */
export const MIN_PASSWORD = 6;

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
  /** Phase 4b (PRD §16) — server-computed scorecards (PRD §9). RLS already scopes
   * `select *` to what the viewer may see (own + TL/ARCO's scope + monitor roles) —
   * no realtime subscription for this one (see subscribeRealtime's comment): a
   * single compute run can upsert 200+ rows at once, which would flood realtime
   * events for no benefit; computeScorecards() refetches explicitly instead. */
  scorecards: Scorecard[];
  /** Phase 4b (PRD §16) — in-app messaging (PRD §17). */
  conversations: Conversation[];
  messages: Message[];
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
  /** super_admin only, via the admin-users edge function. */
  setUserPassword(id: string, password: string): Promise<string | null>;
  addTeam(p: { name: string; city: string; tlId: string | null; arcoId: string | null }): Promise<void>;

  upsertStore(s: Store): Promise<void>;
  /** CSV import path — batched inserts, awaited, with a real per-chunk result
   * (instead of N concurrent fire-and-forget upsertStore calls). */
  addStoresBulk(stores: Store[]): Promise<{ created: number; errors: string[] }>;
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
  /** Appends one funnel-stage row (history is append-only). */
  addNtgGwp(n: NtgGwp): Promise<string | null>;

  // --- Phase 3/5: bi-weekly/periodic modules (PRD §5.2, §5.5, §5.6, §5.7/§6) ---
  // Share of Shelf/Paid Visibility (required photo) and Price Monitoring
  // (optional photo) are offline-queued on native as of Phase 5 — see
  // offlineQueue.ts's QueuedOp comment. Web stays online-required for photo
  // handling (deliberate scope boundary, see the same comment).

  /** Share of Shelf (PRD §5.2) — required photo. Native: queues locally when offline (upload deferred to replay). Web: fails outright if offline or the upload fails. */
  submitShareOfShelf(
    visitId: string,
    storeId: string,
    input: { channel: string; category: StoreCategory; ownFacingCount: number; totalFacingCount: number },
    photoUri: string,
  ): Promise<{ queued: boolean }>;
  /** Paid Visibility (PRD §5.5) — required photo, same online/offline contract as Share of Shelf. */
  submitPaidVisibility(
    visitId: string,
    storeId: string,
    input: { visibilityType: string; complianceChecklist: Record<string, boolean> },
    photoUri: string,
  ): Promise<{ queued: boolean }>;
  /** Price Monitoring (PRD §5.6) — optional photo; a failed optional-photo upload/persist is a soft-fail (row still saves). Offline-queued on native. */
  submitPriceMonitoring(
    visitId: string,
    storeId: string,
    rows: Array<{ sku: string; ownPrice: number; competitorPrices: number[] }>,
    photoUri?: string,
  ): Promise<{ queued: boolean }>;

  /** Survey (PRD §5.7) — generic question sets; also backs the Nutrition Quiz (§6) via NutritionQuizScreen. */
  upsertSurvey(s: Survey): Promise<string | null>;
  submitSurveyResponse(r: SurveyResponse): Promise<string | null>;

  // --- Phase 4a: TL/ARCO validation console (PRD §8) ---
  /** Approve or flag a report row (exception-based queue — PRD §8 review note). Plain online write, no offline queue (desk-review action, not field-critical). */
  reviewReport(reportType: ReportType, reportId: string, status: ReportReviewStatus, note?: string): Promise<string | null>;
  upsertCoachingLog(log: CoachingLog): Promise<string | null>;
  /** Data Analyst/super_admin only (matches targets RLS write policy, 0001 migration). */
  upsertTarget(t: Target): Promise<string | null>;
  /** TargetsScreen's batch save: upserts `rows` and deletes `deleteIds` (a
   * target cleared back to empty). All-or-nothing locally — rolls back on error. */
  saveTargets(rows: Target[], deleteIds: string[]): Promise<string | null>;

  // --- Phase 4b: scorecard computation (PRD §9) + in-app messaging (PRD §17) ---

  /** Data Analyst/PM/super_admin only (matches compute_scorecards()'s internal role
   * check, 0006 migration). Runs the server-side RPC then refetches `scorecards`
   * directly (not via realtime — see the state field's comment). */
  computeScorecards(periodKey: string): Promise<string | null>;

  /** Finds or creates the single conversation for this (type, counterpart) pair.
   * Never eagerly creates conversations for every possible counterpart — only
   * when a chat thread is actually opened (see ChatListScreen). */
  ensureConversation(type: ConversationType, otherUserId: string): Promise<string>;
  /** Online-required (no offline queue — an intentionally new, unscoped-for-now
   * queue class per the PRD §17 review note). Fires a best-effort push via the
   * send-push edge function after a successful insert; never blocks on that. */
  sendMessage(conversationId: string, body: string): Promise<void>;
  /** Marks the other participant's unread messages in this conversation as read. Best-effort. */
  markMessagesRead(conversationId: string): Promise<void>;

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

function mapScorecard(s: any): Scorecard {
  return {
    id: s.id,
    subjectId: s.subject_id,
    role: s.role,
    periodKey: s.period_key,
    score: s.score,
    status: s.status,
    breakdown: s.breakdown ?? {},
    computedAt: new Date(s.computed_at).getTime(),
  };
}

function mapConversation(c: any): Conversation {
  return {
    id: c.id,
    type: c.type,
    participantA: c.participant_a,
    participantB: c.participant_b,
    createdAt: new Date(c.created_at).getTime(),
  };
}

function mapMessage(m: any): Message {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: new Date(m.created_at).getTime(),
    readAt: m.read_at ? new Date(m.read_at).getTime() : null,
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
      // Display the pending local photo (if any) even though it isn't baked into
      // the queued op's rows (see replayOp — the row must not carry a local path
      // as its DB-bound photoUrl). Purely cosmetic; replay patches this to the
      // real remote URL once uploaded.
      const fresh = op.rows
        .filter((r) => !existing.some((x) => x.id === r.id))
        .map((r) => (op.localPhotoUri ? { ...r, photoUrl: op.localPhotoUri } : r));
      if (fresh.length) set({ stockTakingRows: [...fresh, ...existing] });
      break;
    }
    case 'submitOfftake': {
      const existing = get().offtakeRows;
      const fresh = op.rows.filter((r) => !existing.some((x) => x.id === r.id));
      if (fresh.length) set({ offtakeRows: [...fresh, ...existing] });
      break;
    }
    case 'submitPriceMonitoring': {
      const existing = get().priceMonitoringRows;
      const fresh = op.rows
        .filter((r) => !existing.some((x) => x.id === r.id))
        .map((r) => (op.localPhotoUri ? { ...r, photoUrl: op.localPhotoUri } : r));
      if (fresh.length) set({ priceMonitoringRows: [...fresh, ...existing] });
      break;
    }
    case 'submitShareOfShelf': {
      const existing = get().shareOfShelfRows;
      if (!existing.some((x) => x.id === op.row.id)) {
        set({ shareOfShelfRows: [{ ...op.row, photoUrl: op.localPhotoUri }, ...existing] });
      }
      break;
    }
    case 'submitPaidVisibility': {
      const existing = get().paidVisibilityRows;
      if (!existing.some((x) => x.id === op.row.id)) {
        set({ paidVisibilityRows: [{ ...op.row, photoUrl: op.localPhotoUri }, ...existing] });
      }
      break;
    }
  }
}

function targetRow(t: Target) {
  return {
    id: t.id,
    store_id: t.storeId,
    nc_id: t.ncId,
    period_key: t.periodKey,
    offtake_target: t.offtakeTarget ?? null,
    gwp_allocation: t.gwpAllocation ?? null,
    set_by: t.setBy,
  };
}

/** Mutable store columns (id/created_at are set once on insert). */
function storeRow(m: Store) {
  return {
    name: m.name,
    address: m.address,
    city: m.city,
    channel: m.channel,
    account: m.account ?? null,
    category: m.category,
    lat: m.lat,
    lng: m.lng,
    assigned_nc_id: m.assignedNcId,
    team_id: m.teamId,
    source: m.source,
  };
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

function shareOfShelfRow(r: ShareOfShelfRow) {
  return {
    id: r.id,
    visit_id: r.visitId,
    store_id: r.storeId,
    channel: r.channel,
    category: r.category,
    own_facing_count: r.ownFacingCount,
    total_facing_count: r.totalFacingCount,
    photo_url: r.photoUrl,
    created_at: new Date(r.createdAt).toISOString(),
  };
}

function paidVisibilityRow(r: PaidVisibilityRow) {
  return {
    id: r.id,
    visit_id: r.visitId,
    store_id: r.storeId,
    visibility_type: r.visibilityType,
    compliance_checklist: r.complianceChecklist,
    photo_url: r.photoUrl,
    created_at: new Date(r.createdAt).toISOString(),
  };
}

function priceMonitoringRow(r: PriceMonitoringRow) {
  return {
    id: r.id,
    visit_id: r.visitId,
    store_id: r.storeId,
    sku: r.sku,
    own_price: r.ownPrice,
    competitor_prices: r.competitorPrices,
    photo_url: r.photoUrl ?? null,
    created_at: new Date(r.createdAt).toISOString(),
  };
}

/**
 * Outcome of replaying one queued op:
 * - `done`: landed server-side (or already had — a duplicate-key insert means a
 *   previous attempt succeeded but its response was lost), drop it.
 * - `retry`: transient (network/5xx/upload) failure, keep it and stop replaying
 *   later ops so their order is preserved (clock-out never lands before clock-in).
 * - `failed`: the server rejected it deterministically (constraint, RLS, missing
 *   parent row) — retrying would fail forever and block every op behind it, so
 *   it's dropped and reported to the user.
 * - `dropped`: unrecoverable and already explained to the user by the handler.
 */
type ReplayResult = 'done' | 'retry' | 'failed' | 'dropped';

/** Postgres error classes that fail identically on every retry: 22 data
 * exception, 23 integrity constraint, 42 syntax/privilege (incl. 42501 RLS),
 * P0 raised by a function (e.g. finish_visit's "not found"). */
function settle(error: { code?: string } | null): ReplayResult {
  if (!error || error.code === '23505') return 'done';
  return error.code && /^(22|23|42|P0)/.test(error.code) ? 'failed' : 'retry';
}

const OP_LABEL: Record<QueuedOp['type'], string> = {
  clockIn: 'Clock-in',
  clockOut: 'Clock-out',
  startVisit: 'Check-in toko',
  finishVisit: 'Check-out toko',
  submitStockTaking: 'Stock Taking',
  submitOfftake: 'Offtake',
  submitPriceMonitoring: 'Price Monitoring',
  submitShareOfShelf: 'Share of Shelf',
  submitPaidVisibility: 'Paid Visibility',
};

/** Replays one queued op against Supabase. */
async function replayOp(set: (p: Partial<StoreState>) => void, get: () => StoreState, op: QueuedOp): Promise<ReplayResult> {
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
    if (!error) {
      // The clock-in position is the route's first point — the online path
      // inserts it too; without this an offline clock-in's route starts late.
      const { error: rpErr } = await supabase.from('route_points').insert({
        attendance_id: a.id,
        user_id: a.userId,
        lat: a.clockInLat,
        lng: a.clockInLng,
        recorded_at: new Date(a.clockInAt).toISOString(),
      });
      if (rpErr) console.warn('replay clockIn route point failed:', rpErr.message);
    }
    return settle(error);
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
    return settle(error);
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
    return settle(error);
  }
  if (op.type === 'submitStockTaking') {
    return replayOptionalPhotoBatch(set, get, 'stockTakingRows', 'stock_taking', op.rows, stockTakingRow, op.localPhotoUri, 'Stock Taking');
  }
  if (op.type === 'submitOfftake') {
    // Replayed inserts don't read back is_outlier — the row's flag stays as last
    // known (false) locally until the next hydrateAll/realtime update corrects
    // it; the server-side value (set by the trigger) is authoritative regardless.
    const { error } = await supabase.from('offtake').insert(op.rows.map(offtakeRow));
    return settle(error);
  }
  if (op.type === 'submitPriceMonitoring') {
    return replayOptionalPhotoBatch(
      set,
      get,
      'priceMonitoringRows',
      'price_monitoring',
      op.rows,
      priceMonitoringRow,
      op.localPhotoUri,
      'Price Monitoring',
    );
  }
  if (op.type === 'submitShareOfShelf') {
    return replayRequiredPhotoRow(set, get, 'shareOfShelfRows', 'share_of_shelf', op.row, shareOfShelfRow, op.localPhotoUri, 'Share of Shelf');
  }
  if (op.type === 'submitPaidVisibility') {
    return replayRequiredPhotoRow(
      set,
      get,
      'paidVisibilityRows',
      'paid_visibility',
      op.row,
      paidVisibilityRow,
      op.localPhotoUri,
      'Paid Visibility',
    );
  }
  // finishVisit — pass the real (offline) check-out time, not the replay time.
  const { error } = await supabase.rpc('finish_visit', {
    p_visit_id: op.visitId,
    p_check_out_at: new Date(op.checkOutAt).toISOString(),
  });
  return settle(error);
}

/** Shared replay logic for optional-photo batch reports (Stock Taking, Price
 * Monitoring): uploads the deferred local photo if present, inserts the
 * batch's rows, and patches local state's photoUrl from the local file path to
 * the real remote URL (or clears it if the local file is gone by the time the
 * device reconnects — the report itself still saves, per the PRD review's
 * missing-local-file handling). */
async function replayOptionalPhotoBatch<K extends 'stockTakingRows' | 'priceMonitoringRows', R extends { id: string; visitId: string; photoUrl?: string }>(
  set: (p: Partial<StoreState>) => void,
  get: () => StoreState,
  stateKey: K,
  table: string,
  rows: R[],
  toDbRow: (r: R) => Record<string, unknown>,
  localPhotoUri: string | undefined,
  label: string,
): Promise<ReplayResult> {
  let photoUrl: string | undefined;
  let photoLost = false;
  if (localPhotoUri) {
    if (await localPhotoExists(localPhotoUri)) {
      try {
        photoUrl = await uploadReportMedia(rows[0]?.visitId ?? uid(), localPhotoUri, extFromUri(localPhotoUri));
      } catch {
        return 'retry'; // transient upload failure — keep retrying, don't drop the row
      }
    } else {
      photoLost = true;
    }
  }

  const rowsWithPhoto = rows.map((r) => ({ ...r, photoUrl }));
  const { error } = await supabase.from(table).insert(rowsWithPhoto.map(toDbRow));
  const result = settle(error);
  if (result !== 'done') return result;

  if (photoUrl) {
    await discardLocalPhoto(localPhotoUri!);
  }
  // Patch local state's photoUrl from the (possibly-dead) local path to the
  // real remote URL, or clear it if the photo never made it — never leave a
  // row pointing at a local file that may no longer exist.
  set({
    [stateKey]: (get()[stateKey] as unknown as R[]).map((r) => (rows.some((n) => n.id === r.id) ? { ...r, photoUrl } : r)),
  } as unknown as Partial<StoreState>);

  if (photoLost) {
    showDialog(
      'Foto Hilang',
      `Foto ${label} yang tersimpan offline sudah tidak ada di perangkat (mungkin cache terhapus). Laporan tetap disimpan tanpa foto.`,
    );
  }
  return 'done';
}

/** Shared replay logic for required-photo single-row reports (Share of Shelf,
 * Paid Visibility): the row can never be inserted without its photo (DB `not
 * null` constraint), so if the deferred local file is gone by replay time, the
 * op is dropped and the NC is told to resubmit — it can never succeed. */
async function replayRequiredPhotoRow<K extends 'shareOfShelfRows' | 'paidVisibilityRows', R extends { id: string; visitId: string; storeId: string; createdAt: number }>(
  set: (p: Partial<StoreState>) => void,
  get: () => StoreState,
  stateKey: K,
  table: string,
  row: Omit<R, 'photoUrl'>,
  toDbRow: (r: R) => Record<string, unknown>,
  localPhotoUri: string,
  label: string,
): Promise<ReplayResult> {
  if (!(await localPhotoExists(localPhotoUri))) {
    // Unrecoverable — drop from the queue rather than retry forever, and
    // remove the optimistic local row since it will never reach the server.
    set({ [stateKey]: (get()[stateKey] as unknown as R[]).filter((r) => r.id !== row.id) } as unknown as Partial<StoreState>);
    const storeName = get().stores.find((s) => s.id === row.storeId)?.name ?? row.storeId;
    showDialog(
      'Laporan Tidak Tersinkron',
      `Foto ${label} untuk toko "${storeName}" (${fmtDate(row.createdAt)}) hilang dari perangkat sebelum sempat disinkron. Laporan ini tidak tersimpan — silakan isi ulang.`,
    );
    return 'dropped'; // it can never succeed, and the user has been told
  }

  let photoUrl: string;
  try {
    photoUrl = await uploadReportMedia(row.visitId, localPhotoUri, extFromUri(localPhotoUri));
  } catch {
    return 'retry'; // transient upload failure — keep retrying
  }

  const fullRow = { ...row, photoUrl } as unknown as R;
  const { error } = await supabase.from(table).insert(toDbRow(fullRow));
  const result = settle(error);
  if (result !== 'done') return result;

  await discardLocalPhoto(localPhotoUri);
  set({
    [stateKey]: (get()[stateKey] as unknown as R[]).map((r) => (r.id === row.id ? { ...r, photoUrl } : r)),
  } as unknown as Partial<StoreState>);
  return 'done';
}

async function enqueueOp(set: (p: Partial<StoreState>) => void, get: () => StoreState, op: QueuedOp) {
  const next = [...get().pendingOps, op];
  set({ pendingOps: next });
  const userId = get().sessionUserId;
  if (userId) await saveQueue(userId, next);
}

/** Loads the signed-in user's persisted queue and re-applies each op's
 * optimistic effect — queued writes don't exist server-side yet, so
 * hydrateAll() alone would make them vanish from the UI after a restart. */
async function restoreQueue(set: (p: Partial<StoreState>) => void, get: () => StoreState, userId: string) {
  const queue = await loadQueue(userId);
  for (const op of queue) applyQueuedOpLocally(set, get, op);
  set({ pendingOps: queue });
  if (queue.length) get().processPendingOps();
}

// --- module-scope (non-reactive) helpers: realtime channel + debounce ------

let channel: RealtimeChannel | null = null;
let authListenerBound = false;
let netInfoListenerBound = false;
/** Guards processPendingOps against overlapping runs (init + NetInfo + AppState
 * can all fire at once), which would replay the same op twice. */
let replayingQueue = false;

function teardownRealtime() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

function subscribeRealtime(set: (partial: Partial<StoreState>) => void, get: () => StoreState, userId: string) {
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
    // Own points only — see hydrateAll's route_points comment. Unfiltered, a
    // monitor role would receive every NC's GPS ping (~13 events/s program-wide).
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'route_points', filter: `user_id=eq.${userId}` }, (payload) => {
      const p = payload.new as any;
      const t = new Date(p.recorded_at).getTime();
      set({
        attendances: get().attendances.map((a) =>
          // addRoutePoint already appended this point optimistically — skip the echo.
          a.id === p.attendance_id && !a.route.some((r) => r.t === t)
            ? { ...a, route: [...a.route, { lat: p.lat, lng: p.lng, t }].sort((x, y) => x.t - y.t) }
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        set({ conversations: get().conversations.filter((c) => c.id !== (payload.old as any).id) });
      } else {
        set({ conversations: upsertById(get().conversations, mapConversation(payload.new)) });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
      // This is the live-update path for ChatThreadScreen: new incoming
      // messages and read_at updates both arrive here.
      if (payload.eventType === 'DELETE') {
        set({ messages: get().messages.filter((m) => m.id !== (payload.old as any).id) });
      } else {
        set({ messages: upsertById(get().messages, mapMessage(payload.new)) });
      }
    })
    .subscribe();
}

/** PostgREST caps every response at `max_rows` (1000 on Supabase by default)
 * and truncates silently — a plain select('*') on visits/offtake/etc. would
 * quietly drop everything past the first 1000 rows once the program has a few
 * days of data. Pages through with a stable order (every table's `id` is its PK). */
const PAGE_SIZE = 1000;

async function fetchAll(table: string): Promise<{ data: any[]; error: { message: string } | null }> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { data: out, error: null };
  }
}

/** Route points are by far the largest table (a ping every ~15s per clocked-in
 * user). Only the viewer's OWN recent route is used anywhere in the app
 * (Absensi km, NC monthly stats, clock-out), so only that is loaded. */
const ROUTE_HISTORY_DAYS = 35;
const ROUTE_ID_CHUNK = 100; // keeps the `in (...)` filter well under URL length limits

async function fetchOwnRoutePoints(userId: string, attendanceRows: any[]): Promise<any[]> {
  const since = Date.now() - ROUTE_HISTORY_DAYS * 86400000;
  const ids = attendanceRows
    .filter((a) => a.user_id === userId && new Date(a.clock_in_at).getTime() >= since)
    .map((a) => a.id as string);
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += ROUTE_ID_CHUNK) {
    const chunk = ids.slice(i, i + ROUTE_ID_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('route_points')
        .select('*')
        .in('attendance_id', chunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.warn('route_points hydrate failed:', error.message);
        break;
      }
      out.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return out;
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
    scorecardsRes,
    conversationsRes,
    messagesRes,
  ] = await Promise.all(
    [
      'profiles',
      'teams',
      'stores',
      'visits',
      'attendances',
      'products',
      'stock_taking',
      'offtake',
      'consumers',
      'ntg_gwp',
      'share_of_shelf',
      'paid_visibility',
      'price_monitoring',
      'surveys',
      'survey_responses',
      'report_reviews',
      'coaching_logs',
      'targets',
      'scorecards',
      'conversations',
      'messages',
    ].map(fetchAll),
  );

  const attendanceRows = attendancesRes.data;
  const routePoints = await fetchOwnRoutePoints(userId, attendanceRows);

  const routesByAttendance = new Map<string, RoutePoint[]>();
  for (const p of routePoints) {
    const arr = routesByAttendance.get(p.attendance_id) ?? [];
    arr.push({ lat: p.lat, lng: p.lng, t: new Date(p.recorded_at).getTime() });
    routesByAttendance.set(p.attendance_id, arr);
  }
  for (const arr of routesByAttendance.values()) arr.sort((a, b) => a.t - b.t);

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
    scorecards: (scorecardsRes.data ?? []).map(mapScorecard),
    conversations: (conversationsRes.data ?? []).map(mapConversation),
    messages: (messagesRes.data ?? []).map(mapMessage),
  });

  subscribeRealtime(set, get, userId);
  return true;
}

async function callAdminUsers(body: Record<string, unknown>): Promise<{ data?: any; error?: string }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) return { error: error.message ?? 'Gagal menghubungi server.' };
  if (data?.error) return { error: data.error };
  return { data };
}

/** Requests notification permission and syncs the Expo push token to the
 * caller's own profile (PRD §17) — best-effort, fire-and-forget, never blocks
 * login/init. No real EAS project is provisioned yet (app.json's
 * extra.eas.projectId is still the placeholder "REPLACE_WITH_EAS_PROJECT_ID"),
 * so getExpoPushTokenAsync() can't succeed until one exists; that's caught and
 * logged, not surfaced to the user — push is additive to in-app chat, never a
 * requirement to use it. */
async function registerPushToken(): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
    if (!projectId || projectId === 'REPLACE_WITH_EAS_PROJECT_ID') {
      console.warn('registerPushToken: no real EAS project id configured yet — skipping.');
      return;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('set_my_push_token', { p_token: token });
    if (error) console.warn('registerPushToken: failed to save token:', error.message);
  } catch (err) {
    console.warn('registerPushToken failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

/** Everything scoped to a session — reset on logout / SIGNED_OUT. */
const SIGNED_OUT_STATE: Partial<StoreState> = {
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
  scorecards: [],
  conversations: [],
  messages: [],
  pendingOps: [],
};

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
  scorecards: [],
  conversations: [],
  messages: [],
  pendingOps: [],

  init: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      const ok = await hydrateAll(set, get, session.user.id);
      if (!ok) await supabase.auth.signOut();
      else {
        await restoreQueue(set, get, session.user.id);
        registerPushToken(); // fire-and-forget, PRD §17
      }
    }
    set({ ready: true });

    if (!authListenerBound) {
      authListenerBound = true;
      supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          teardownRealtime();
          set(SIGNED_OUT_STATE);
        }
      });
    }
    if (!netInfoListenerBound) {
      netInfoListenerBound = true;
      NetInfo.addEventListener((state) => {
        if (state.isConnected && get().pendingOps.length) get().processPendingOps();
      });
      // NetInfo only fires on connectivity *changes* — a replay that failed
      // transiently while online would otherwise wait for the next drop/reconnect.
      AppState.addEventListener('change', (s) => {
        if (s === 'active' && get().pendingOps.length) get().processPendingOps();
      });
    }
  },

  processPendingOps: async () => {
    const userId = get().sessionUserId;
    if (replayingQueue || !userId || !get().pendingOps.length) return;
    replayingQueue = true;
    const failed: string[] = [];
    let synced = 0;
    try {
      // Head-first, one op at a time, re-reading pendingOps each iteration so
      // ops enqueued mid-replay are neither lost nor replayed out of order.
      for (;;) {
        const op = get().pendingOps[0];
        if (!op || get().sessionUserId !== userId) break;
        const result = await replayOp(set, get, op);
        if (result === 'retry') break; // keep this op and everything after it
        if (result === 'failed') failed.push(OP_LABEL[op.type]);
        if (result === 'done') synced++;
        const next = get().pendingOps.filter((o) => o.id !== op.id);
        set({ pendingOps: next });
        await saveQueue(userId, next);
      }
    } finally {
      replayingQueue = false;
    }
    if (failed.length) {
      showDialog(
        'Sebagian Data Offline Ditolak Server',
        `Data berikut tidak bisa disimpan dan perlu diisi ulang: ${failed.join(', ')}. Hubungi TL/admin bila berulang.`,
      );
    } else if (synced && !get().pendingOps.length) {
      showDialog('Tersinkron', 'Data yang tersimpan offline berhasil dikirim ke server.');
    }
  },

  login: async (username, password) => {
    const email = `${username.trim().toLowerCase()}@internal.spc`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // AuthApiError (4xx) = bad credentials; anything else is connectivity.
      return error.status && error.status >= 400 && error.status < 500
        ? 'Username atau password salah.'
        : 'Tidak dapat terhubung ke server. Periksa koneksi internet dan coba lagi.';
    }
    const ok = await hydrateAll(set, get, data.user.id);
    if (!ok) {
      await supabase.auth.signOut();
      return 'Akun dinonaktifkan atau tidak ditemukan. Hubungi admin.';
    }
    // init() only restores a queue when a session already existed at cold
    // start — a queue persisted before the session expired must load here.
    await restoreQueue(set, get, data.user.id);
    registerPushToken(); // fire-and-forget, PRD §17
    return null;
  },

  logout: async () => {
    teardownRealtime();
    await supabase.auth.signOut();
    // The persisted queue stays on disk under this user's key and resumes on
    // their next login; only the in-memory copy is cleared.
    set(SIGNED_OUT_STATE);
  },

  addUser: async ({ name, username, password, role, teamId, city, phone }) => {
    const uname = username.trim().toLowerCase();
    if (!name.trim()) return 'Nama wajib diisi.';
    if (!uname) return 'Username wajib diisi.';
    if (get().users.some((u) => u.username.toLowerCase() === uname)) return 'Username sudah dipakai.';
    if (password.length < MIN_PASSWORD) return `Password minimal ${MIN_PASSWORD} karakter.`;
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
      if (r.password.length < MIN_PASSWORD) {
        errors.push(`Baris ${i + 1}: password minimal ${MIN_PASSWORD} karakter`);
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

  setUserPassword: async (id, password) => {
    if (password.length < MIN_PASSWORD) return `Password minimal ${MIN_PASSWORD} karakter.`;
    const { error } = await callAdminUsers({ action: 'setPassword', userId: id, password });
    return error ?? null;
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
    const before = get().stores.find((x) => x.id === m.id);
    set({ stores: upsertById(get().stores, m) });
    // Explicit insert vs update rather than PostgREST upsert: INSERT ... ON
    // CONFLICT DO UPDATE also requires the *new* row to pass the SELECT policy,
    // which fails for rows the writer can create but not read back.
    const { error } = before
      ? await supabase.from('stores').update(storeRow(m)).eq('id', m.id)
      : await supabase.from('stores').insert({ id: m.id, ...storeRow(m), created_at: new Date(m.createdAt).toISOString() });
    if (error) {
      // Roll back only this store — restoring a whole-list snapshot would also
      // wipe any other store written concurrently.
      set({
        stores: before ? get().stores.map((x) => (x.id === m.id ? before : x)) : get().stores.filter((x) => x.id !== m.id),
      });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan data toko ke server. Periksa koneksi internet dan coba lagi.');
    }
  },

  addStoresBulk: async (stores) => {
    const errors: string[] = [];
    let created = 0;
    const CHUNK = 500;
    for (let i = 0; i < stores.length; i += CHUNK) {
      const chunk = stores.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('stores')
        .insert(chunk.map((m) => ({ id: m.id, ...storeRow(m), created_at: new Date(m.createdAt).toISOString() })));
      if (error) {
        errors.push(`Baris ${i + 1}-${i + chunk.length}: ${error.message}`);
        continue;
      }
      created += chunk.length;
      let list = get().stores;
      for (const m of chunk) list = upsertById(list, m);
      set({ stores: list });
    }
    return { created, errors };
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

    const { error } = await supabase.rpc('finish_visit', {
      p_visit_id: id,
      p_check_out_at: new Date(checkOutAt).toISOString(),
    });
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
    const now = Date.now();
    const baseRows: StockTakingRow[] = clean.map((r) => ({
      id: uid('stk_'),
      visitId,
      storeId,
      sku: r.sku,
      qtyOnHand: r.qtyOnHand,
      outOfStock: r.outOfStock,
      photoUrl: undefined,
      createdAt: now,
    }));

    if (!online) {
      // Phase 5: native persists the photo locally and defers its upload to
      // replay time; web keeps the pre-Phase-5 "photo dropped" behavior (see
      // offlineQueue.ts's QueuedOp comment on the web scope boundary).
      let localPhotoUri: string | undefined;
      if (photoUri && Platform.OS !== 'web') {
        try {
          localPhotoUri = await persistPhotoLocally(photoUri);
        } catch {
          showDialog('Foto Gagal Disimpan', 'Laporan tetap disimpan tanpa foto. Coba lampirkan foto lagi nanti.');
        }
      } else if (photoUri) {
        showDialog(
          'Offline',
          'Foto tidak disertakan karena tidak ada koneksi. Laporan tetap tersimpan; lampirkan foto saat online jika perlu.',
        );
      }
      const displayRows = localPhotoUri ? baseRows.map((r) => ({ ...r, photoUrl: localPhotoUri })) : baseRows;
      set({ stockTakingRows: [...displayRows, ...get().stockTakingRows] });
      await enqueueOp(set, get, { id: uid('op_'), type: 'submitStockTaking', rows: baseRows, localPhotoUri });
      showDialog('Tersimpan Offline', 'Stock Taking tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.');
      return { queued: true };
    }

    let photoUrl: string | undefined;
    if (photoUri) {
      try {
        photoUrl = await uploadReportMedia(visitId, photoUri, extFromUri(photoUri));
      } catch {
        showDialog('Foto Gagal Diupload', 'Laporan tetap disimpan tanpa foto. Coba lampirkan foto lagi nanti.');
      }
    }
    const newRows = baseRows.map((r) => ({ ...r, photoUrl }));
    set({ stockTakingRows: [...newRows, ...get().stockTakingRows] });

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
    const before = get().consumers.find((x) => x.id === c.id);
    set({ consumers: upsertById(get().consumers, c) });
    const fields = {
      name: c.name,
      wa_contact: c.waContact,
      consent: c.consent,
      child_age_bracket: c.childAgeBracket,
      current_brand: c.currentBrand ?? null,
      quiz_result: c.quizResult ?? null,
    };
    // Insert vs update explicitly — see upsertStore. Ownership/creation time
    // are write-once.
    const { error } = before
      ? await supabase.from('consumers').update(fields).eq('id', c.id)
      : await supabase.from('consumers').insert({
          id: c.id,
          ...fields,
          created_by_nc_id: c.createdByNcId,
          created_at: new Date(c.createdAt).toISOString(),
        });
    if (error) {
      set({
        consumers: before
          ? get().consumers.map((x) => (x.id === c.id ? before : x))
          : get().consumers.filter((x) => x.id !== c.id),
      });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan data konsumen ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  addNtgGwp: async (n) => {
    set({ ntgGwps: [n, ...get().ntgGwps] });
    // Funnel history is append-only (ntg_gwp_insert policy, 0008 migration).
    const { error } = await supabase.from('ntg_gwp').insert({
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
      set({ ntgGwps: get().ntgGwps.filter((x) => x.id !== n.id) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan data NTG & GWP ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  // --- Phase 3: Share of Shelf / Paid Visibility (PRD §5.2, §5.5) ---------
  // Required-photo modules: offline-queued on native with the photo persisted
  // locally (see offlineQueue.ts); online they fail outright rather than save
  // a required-evidence report without its photo.

  submitShareOfShelf: async (visitId, storeId, input, photoUri) => {
    if (input.ownFacingCount < 0 || input.totalFacingCount < 0) {
      throw new Error('Jumlah facing tidak boleh negatif.');
    }
    if (input.ownFacingCount > input.totalFacingCount) {
      throw new Error('Own facing tidak boleh melebihi total facing.');
    }

    const baseRow: Omit<ShareOfShelfRow, 'photoUrl'> = {
      id: uid('sos_'),
      visitId,
      storeId,
      channel: input.channel,
      category: input.category,
      ownFacingCount: input.ownFacingCount,
      totalFacingCount: input.totalFacingCount,
      createdAt: Date.now(),
    };

    if (!(await isOnline())) {
      // Phase 5: native persists the required photo locally and defers upload
      // to replay — the row can never be inserted without it (DB not-null
      // constraint), so replay itself withholds the insert until the upload
      // succeeds (see replayRequiredPhotoRow). Web keeps the pre-Phase-5
      // online-required behavior (see offlineQueue.ts's QueuedOp comment).
      if (Platform.OS === 'web') {
        showDialog('Offline', 'Share of Shelf butuh foto sebagai bukti wajib — tidak dapat disimpan tanpa koneksi internet. Coba lagi saat online.');
        throw new ShownError('Tidak ada koneksi internet.');
      }
      let localPhotoUri: string;
      try {
        localPhotoUri = await persistPhotoLocally(photoUri);
      } catch {
        showDialog('Gagal Menyimpan Foto', 'Tidak dapat menyimpan foto di perangkat. Laporan tidak disimpan — coba lagi.');
        throw new ShownError('Gagal menyimpan foto secara lokal.');
      }
      set({ shareOfShelfRows: [{ ...baseRow, photoUrl: localPhotoUri }, ...get().shareOfShelfRows] });
      await enqueueOp(set, get, { id: uid('op_'), type: 'submitShareOfShelf', row: baseRow, localPhotoUri });
      showDialog('Tersimpan Offline', 'Share of Shelf tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.');
      return { queued: true };
    }

    let photoUrl: string;
    try {
      photoUrl = await uploadReportMedia(visitId, photoUri, extFromUri(photoUri));
    } catch {
      showDialog('Gagal Upload Foto', 'Foto wajib untuk Share of Shelf tidak berhasil diupload. Laporan tidak disimpan — coba lagi.');
      throw new ShownError('Upload foto gagal.');
    }
    const row: ShareOfShelfRow = { ...baseRow, photoUrl };
    set({ shareOfShelfRows: [row, ...get().shareOfShelfRows] });
    const { error } = await supabase.from('share_of_shelf').insert(shareOfShelfRow(row));
    if (error) {
      set({ shareOfShelfRows: get().shareOfShelfRows.filter((x) => x.id !== row.id) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan Share of Shelf ke server. Periksa koneksi internet dan coba lagi.');
      throw new ShownError(error.message);
    }
    return { queued: false };
  },

  submitPaidVisibility: async (visitId, storeId, input, photoUri) => {
    if (!input.visibilityType) throw new Error('Pilih jenis visibility.');

    const baseRow: Omit<PaidVisibilityRow, 'photoUrl'> = {
      id: uid('pv_'),
      visitId,
      storeId,
      visibilityType: input.visibilityType,
      complianceChecklist: input.complianceChecklist,
      createdAt: Date.now(),
    };

    if (!(await isOnline())) {
      if (Platform.OS === 'web') {
        showDialog('Offline', 'Paid Visibility butuh foto sebagai bukti wajib — tidak dapat disimpan tanpa koneksi internet. Coba lagi saat online.');
        throw new ShownError('Tidak ada koneksi internet.');
      }
      let localPhotoUri: string;
      try {
        localPhotoUri = await persistPhotoLocally(photoUri);
      } catch {
        showDialog('Gagal Menyimpan Foto', 'Tidak dapat menyimpan foto di perangkat. Laporan tidak disimpan — coba lagi.');
        throw new ShownError('Gagal menyimpan foto secara lokal.');
      }
      set({ paidVisibilityRows: [{ ...baseRow, photoUrl: localPhotoUri }, ...get().paidVisibilityRows] });
      await enqueueOp(set, get, { id: uid('op_'), type: 'submitPaidVisibility', row: baseRow, localPhotoUri });
      showDialog('Tersimpan Offline', 'Paid Visibility tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.');
      return { queued: true };
    }

    let photoUrl: string;
    try {
      photoUrl = await uploadReportMedia(visitId, photoUri, extFromUri(photoUri));
    } catch {
      showDialog('Gagal Upload Foto', 'Foto wajib untuk Paid Visibility tidak berhasil diupload. Laporan tidak disimpan — coba lagi.');
      throw new ShownError('Upload foto gagal.');
    }
    const row: PaidVisibilityRow = { ...baseRow, photoUrl };
    set({ paidVisibilityRows: [row, ...get().paidVisibilityRows] });
    const { error } = await supabase.from('paid_visibility').insert(paidVisibilityRow(row));
    if (error) {
      set({ paidVisibilityRows: get().paidVisibilityRows.filter((x) => x.id !== row.id) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan Paid Visibility ke server. Periksa koneksi internet dan coba lagi.');
      throw new ShownError(error.message);
    }
    return { queued: false };
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

    const online = await isOnline();
    const now = Date.now();
    const baseRows: PriceMonitoringRow[] = clean.map((r) => ({
      id: uid('pm_'),
      visitId,
      storeId,
      sku: r.sku,
      ownPrice: r.ownPrice,
      competitorPrices: r.competitorPrices,
      photoUrl: undefined,
      createdAt: now,
    }));

    if (!online) {
      let localPhotoUri: string | undefined;
      if (photoUri && Platform.OS !== 'web') {
        try {
          localPhotoUri = await persistPhotoLocally(photoUri);
        } catch {
          showDialog('Foto Gagal Disimpan', 'Laporan tetap disimpan tanpa foto (foto bersifat opsional). Coba lampirkan foto lagi nanti.');
        }
      } else if (photoUri) {
        showDialog(
          'Offline',
          'Foto tidak disertakan karena tidak ada koneksi. Laporan tetap tersimpan; lampirkan foto saat online jika perlu.',
        );
      }
      const displayRows = localPhotoUri ? baseRows.map((r) => ({ ...r, photoUrl: localPhotoUri })) : baseRows;
      set({ priceMonitoringRows: [...displayRows, ...get().priceMonitoringRows] });
      await enqueueOp(set, get, { id: uid('op_'), type: 'submitPriceMonitoring', rows: baseRows, localPhotoUri });
      showDialog('Tersimpan Offline', 'Price Monitoring tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.');
      return { queued: true };
    }

    let photoUrl: string | undefined;
    if (photoUri) {
      try {
        photoUrl = await uploadReportMedia(visitId, photoUri, extFromUri(photoUri));
      } catch {
        showDialog('Foto Gagal Diupload', 'Laporan tetap disimpan tanpa foto (foto bersifat opsional). Coba lampirkan foto lagi nanti.');
      }
    }
    const newRows = baseRows.map((r) => ({ ...r, photoUrl }));
    set({ priceMonitoringRows: [...newRows, ...get().priceMonitoringRows] });
    const { error } = await supabase.from('price_monitoring').insert(newRows.map(priceMonitoringRow));
    if (error) {
      set({ priceMonitoringRows: get().priceMonitoringRows.filter((x) => !newRows.some((n) => n.id === x.id)) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan Price Monitoring ke server. Periksa koneksi internet dan coba lagi.');
      throw new ShownError(error.message);
    }
    return { queued: false };
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
    const { error } = await supabase.from('targets').upsert(targetRow(t));
    if (error) {
      set({ targets: list });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan target ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  saveTargets: async (rows, deleteIds) => {
    const before = get().targets;
    let next = before.filter((t) => !deleteIds.includes(t.id));
    for (const r of rows) next = upsertById(next, r);
    set({ targets: next });

    // targets_select is `using (true)`, so a plain upsert is safe here (no
    // read-back RLS trap like stores/consumers — see upsertStore).
    const { error: upErr } = rows.length ? await supabase.from('targets').upsert(rows.map(targetRow)) : { error: null };
    const { error: delErr } =
      !upErr && deleteIds.length ? await supabase.from('targets').delete().in('id', deleteIds) : { error: null };
    const error = upErr ?? delErr;
    if (error) {
      set({ targets: before });
      showDialog(
        'Gagal Menyimpan',
        error.code === '23505'
          ? 'Target untuk salah satu NC di periode ini baru saja disimpan oleh pengguna lain. Muat ulang aplikasi lalu coba lagi.'
          : 'Tidak dapat menyimpan target ke server. Periksa koneksi internet dan coba lagi.',
      );
      return error.message;
    }
    return null;
  },

  // --- Phase 4b: scorecard computation (PRD §9) ---------------------------

  computeScorecards: async (periodKey) => {
    const { error } = await supabase.rpc('compute_scorecards', { p_period_key: periodKey });
    if (error) {
      showDialog('Gagal Menghitung Skorkartu', error.message);
      return error.message;
    }
    // Deliberate explicit refetch instead of relying on realtime — a single
    // compute run can upsert 200+ rows, which isn't worth subscribing to live
    // (see the `scorecards` state field's comment).
    const { data, error: fetchErr } = await supabase.from('scorecards').select('*');
    if (!fetchErr) set({ scorecards: (data ?? []).map(mapScorecard) });
    return null;
  },

  // --- Phase 4b: in-app messaging (PRD §17) --------------------------------

  ensureConversation: async (type, otherUserId) => {
    const me = get().sessionUserId!;
    const existing = get().conversations.find(
      (c) =>
        c.type === type &&
        ((c.participantA === me && c.participantB === otherUserId) ||
          (c.participantA === otherUserId && c.participantB === me)),
    );
    if (existing) return existing.id;

    const c: Conversation = {
      id: uid('cv_'),
      type,
      participantA: me,
      participantB: otherUserId,
      createdAt: Date.now(),
    };
    set({ conversations: [c, ...get().conversations] });
    const { error } = await supabase.from('conversations').insert({
      id: c.id,
      type: c.type,
      participant_a: c.participantA,
      participant_b: c.participantB,
      created_at: new Date(c.createdAt).toISOString(),
    });
    if (error) {
      set({ conversations: get().conversations.filter((x) => x.id !== c.id) });
      throw new Error(error.message);
    }
    return c.id;
  },

  sendMessage: async (conversationId, body) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const me = get().sessionUserId!;
    if (!(await isOnline())) {
      showDialog('Offline', 'Pesan tidak dapat dikirim tanpa koneksi internet. Coba lagi saat online.');
      throw new ShownError('Tidak ada koneksi internet.');
    }
    const m: Message = {
      id: uid('msg_'),
      conversationId,
      senderId: me,
      body: trimmed,
      createdAt: Date.now(),
      readAt: null,
    };
    set({ messages: [...get().messages, m] });
    const { error } = await supabase.from('messages').insert({
      id: m.id,
      conversation_id: m.conversationId,
      sender_id: m.senderId,
      body: m.body,
      created_at: new Date(m.createdAt).toISOString(),
      read_at: null,
    });
    if (error) {
      set({ messages: get().messages.filter((x) => x.id !== m.id) });
      showDialog('Gagal Mengirim', 'Tidak dapat mengirim pesan. Periksa koneksi internet dan coba lagi.');
      throw new ShownError(error.message);
    }

    // Fire-and-forget push (PRD §17) — never blocks the send UI on delivery.
    const convo = get().conversations.find((c) => c.id === conversationId);
    const recipientId = convo ? (convo.participantA === me ? convo.participantB : convo.participantA) : null;
    const sender = get().users.find((u) => u.id === me);
    if (recipientId) {
      supabase.functions
        .invoke('send-push', { body: { recipientUserId: recipientId, title: sender?.name ?? 'Pesan baru', body: trimmed } })
        .catch(() => {
          // Best-effort only — push delivery failing must never affect the chat itself.
        });
    }
  },

  markMessagesRead: async (conversationId) => {
    const me = get().sessionUserId!;
    const before = get().messages;
    const now = Date.now();
    const toMark = before.filter((m) => m.conversationId === conversationId && m.senderId !== me && m.readAt == null);
    if (!toMark.length) return;
    set({
      messages: before.map((m) =>
        toMark.some((t) => t.id === m.id) ? { ...m, readAt: now } : m,
      ),
    });
    // RPC, not a direct UPDATE: messages has no UPDATE policy (a row-level
    // policy would let the recipient edit the body too) — see 0008 migration.
    const { error } = await supabase.rpc('mark_messages_read', { p_conversation_id: conversationId });
    if (error) console.warn('markMessagesRead failed (non-fatal):', error.message);
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
