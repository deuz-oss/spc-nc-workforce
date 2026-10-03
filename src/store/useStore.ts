import { create } from 'zustand';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { isAuthRetryableFetchError, type RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { showDialog, showToast } from '../components/dialog';
import {
  CONSENT_VERSION,
  HISTORY_DAYS,
  NON_FIELD_REPORT_HISTORY_DAYS,
  isUnder1Bracket,
  TRACK_MIN_STEP_M,
  UNDER1_MESSAGE,
  UNDER1_TITLE,
} from '../config';
import {
  Attendance,
  Certification,
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
  LivePosition,
  Schedule,
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
import { clockInGeoFenceOk, haversineM } from '../utils/geo';
import { loadQueue, saveQueue, QueuedOp } from '../utils/offlineQueue';
import { discardLocalPhoto, extFromUri, localPhotoExists, persistPhotoLocally, uploadReportMedia } from '../utils/storage';
import { fmtDate } from '../utils/format';
import { historyWindowStart, programDayKey, programDayStart } from '../utils/period';
import { uid } from '../utils/uuid';
import { deleteSnapshot, getLastUser, loadSnapshot, OfflineSnapshot, saveSnapshot, setLastUser } from '../utils/offlineCache';
import { BufferedPoint, onPointsRecorded, readBufferedPoints } from '../utils/routeBuffer';
import { flushRouteBuffer } from '../utils/routeSync';
import { funnelStepError, highestStage } from '../utils/funnel';
import { isValidWa, normalizeWa } from '../utils/wa';
import { passwordProblem } from '../utils/password';
import {
  mapAttendance,
  mapCertification,
  mapCoachingLog,
  mapConsumer,
  mapConversation,
  mapMessage,
  mapNtgGwp,
  mapOfftake,
  mapPaidVisibility,
  mapPriceMonitoring,
  mapProduct,
  mapProfile,
  mapReportReview,
  mapSchedule,
  mapScorecard,
  mapShareOfShelf,
  mapStockTaking,
  mapStore,
  mapSurvey,
  mapSurveyResponse,
  mapTarget,
  mapTeam,
  mapVisit,
  offtakeRow,
  paidVisibilityRow,
  priceMonitoringRow,
  scheduleRow,
  shareOfShelfRow,
  stockTakingRow,
  storeRow,
  targetRow,
  teamRow,
  upsertById,
  visitRow,
} from './mappers';
import { rollbackRows } from './rows';
import { drainQueue, isNetworkError, OP_LABEL, QueueReason, queueReason, ReplayResult, settle } from './replay';

/** Thrown by actions that have already explained the failure to the user via
 * showDialog — screens must not show a second dialog for it. */
export class ShownError extends Error {}

/** "Connected" is not "online": a phone on Wi-Fi or mobile data with no actual
 * internet (dead hotspot, captive portal, exhausted quota) reports
 * isConnected=true. isInternetReachable is null while NetInfo is still probing
 * — unknown is not treated as offline; a request that then fails at the
 * network level falls back to the offline queue anyway (see runOrQueue). */
function reachable(state: { isConnected: boolean | null; isInternetReachable?: boolean | null }): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

async function isOnline(): Promise<boolean> {
  return reachable(await NetInfo.fetch());
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

export { MIN_PASSWORD } from '../utils/password';

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

/** management_summary() result (migration 0018) — the management dashboard's
 * figures computed server-side. `daily[].day` is a WIB date 'YYYY-MM-DD'. */
export interface ManagementSummary {
  ownFacing: number;
  totalFacing: number;
  offtakeUnits: number;
  gwpGivenQty: number;
  ntgConsumers: number;
  daily: Array<{ day: string; own: number; total: number; units: number }>;
  channels: Array<{ channel: string; category: string; own: number; total: number }>;
}

/** One admin_audit_log row (migration 0016). */
export interface AuditEntry {
  id: number;
  at: number;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
}

/** Editable team fields; the home-base pin drives the clock-in geofence (0014). */
export interface TeamInput {
  name: string;
  city: string;
  tlId: string | null;
  arcoId: string | null;
  baseLat: number | null;
  baseLng: number | null;
  baseRadiusM: number;
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
  /** Training certification results (PRD §9 Lead Trainer KPIs). RLS: monitor
   * roles see all, everyone sees their own. Small table, loaded in full. Not in
   * the realtime publication — writers update local state directly, other
   * viewers pick changes up on next login. */
  certifications: Certification[];
  /** PJP — planned store visits per NC per WIB day (schedules, 0020). Loaded
   * for the roles that plan or follow them, from the history window onward
   * (future plans included). */
  schedules: Schedule[];
  /** Phase 4b (PRD §16) — in-app messaging (PRD §17). */
  conversations: Conversation[];
  messages: Message[];
  /** Clock-in/out, store check-in/out, and Stock Taking/Offtake submissions still waiting for connectivity to reach Supabase. */
  pendingOps: QueuedOp[];
  /** Earliest timestamp of field-activity data loaded (visits, attendance,
   * reports, reviews, coaching logs, messages) — see WINDOWED_TABLES. `null`
   * once loadFullHistory() has pulled everything. Screens showing periods
   * that reach further back use this to offer "load older history". */
  historyFrom: number | null;
  /** Set while the app runs from the on-device snapshot because the server
   * couldn't be reached at cold start (time the snapshot was saved); cleared
   * once a full sync succeeds. Screens show an "offline data" notice. */
  offlineSnapshotAt: number | null;

  /** Restores an existing Supabase session (if any) on cold app start. Call once from App.tsx. */
  init(): Promise<void>;
  /** Retries every queued offline write; called on reconnect and on app start. */
  processPendingOps(): Promise<void>;
  /** Loads the field-activity history older than `historyFrom` (on demand —
   * e.g. the management dashboard's "Semua" period). Returns an error message or null. */
  loadFullHistory(): Promise<string | null>;
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
  /** Any signed-in user: change their own password after re-verifying the current one. */
  changeOwnPassword(current: string, next: string): Promise<string | null>;
  addTeam(p: TeamInput): Promise<void>;
  /** super_admin: edit a team; keeps the TL's profile.team_id in sync (see syncTeamLeader). */
  updateTeam(id: string, p: TeamInput): Promise<string | null>;

  upsertStore(s: Store): Promise<void>;
  /** CSV import path — batched inserts, awaited, with a real per-chunk result
   * (instead of N concurrent fire-and-forget upsertStore calls). */
  addStoresBulk(stores: Store[]): Promise<{ created: number; errors: string[] }>;
  assignStores(ids: string[], ncId: string | null): Promise<void>;

  /** `distM`/`geoValid` are the phone's own view (shown until the server's
   * recomputed values arrive — visits_server_checks, 0014). */
  startVisit(
    storeId: string,
    ncId: string,
    pos: { lat: number; lng: number; mocked?: boolean },
    distM: number | null,
    geoValid: boolean,
  ): Promise<string>;
  finishVisit(id: string): Promise<void>;

  // --- Phase 2: product master + core daily report modules ---
  // Every queueable write below (and startVisit/finishVisit/clockIn/clockOut)
  // goes through runOrQueue: sent now when possible, otherwise queued — see
  // its comment for the `queued` contract. Rejected writes throw.
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
  /** Appends one funnel-stage row (history is append-only, forward-only). */
  addNtgGwp(n: NtgGwp): Promise<string | null>;
  /** Saves a consumer and (optionally) its next funnel step in ONE server
   * transaction (save_consumer_with_step, 0017) — never a consumer without its
   * step or the reverse. Returns an error message (already shown) or null. */
  saveConsumerWithStep(c: Consumer, step: NtgGwp | null): Promise<string | null>;
  /** PJP: plans stores for an NC on WIB days (scoped by schedules_write RLS,
   * 0020). Already-planned store/day pairs are skipped. Returns an error message or null. */
  addSchedules(ncId: string, plans: Array<{ storeId: string; plannedDate: number }>): Promise<string | null>;
  deleteSchedule(id: string): Promise<string | null>;
  /** Loads one consumer's complete funnel history (the store only holds the
   * recent window) and merges it in. Best-effort; returns an error message or null. */
  fetchConsumerHistory(consumerId: string): Promise<string | null>;
  /** Data subject deletion request (UU PDP): blanks the consumer's personal data
   * server-side (erase_consumer RPC, 0015); funnel counts stay. Creator NC,
   * super_admin or PM. Returns an error message or null. */
  eraseConsumer(id: string): Promise<string | null>;

  // --- Phase 3/5: bi-weekly/periodic modules (PRD §5.2, §5.5, §5.6, §5.7/§6) ---
  // Share of Shelf/Paid Visibility (required photo) and Price Monitoring
  // (optional photo) are offline-queued on native as of Phase 5 — see
  // offlineQueue.ts's QueuedOp comment. Web stays online-required for photo
  // handling (deliberate scope boundary, see the same comment).

  /** Share of Shelf (PRD §5.2) — required photo. Native: photo kept on the device and uploaded by replayOp (now or from the queue). Web: online-only — fails (ShownError) if offline or the upload fails. */
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
  /** Reviews several report rows at once (e.g. every SKU line of one Stock Taking) in a single write. */
  reviewReports(
    refs: Array<{ reportType: ReportType; reportId: string }>,
    status: ReportReviewStatus,
    note?: string,
  ): Promise<string | null>;
  upsertCoachingLog(log: CoachingLog): Promise<string | null>;
  /** Data Analyst/super_admin only (matches targets RLS write policy, 0001 migration). */
  upsertTarget(t: Target): Promise<string | null>;
  /** Batch insert of one training session's results (lead_trainer/trainer/super_admin). */
  addCertifications(rows: Certification[]): Promise<string | null>;
  deleteCertification(id: string): Promise<string | null>;
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
  /** Re-fetches conversations + messages (login history window) and merges
   * them in — catches anything realtime missed while the app was backgrounded.
   * Called on app resume and when the chat screens open. Best-effort. */
  refreshChat(): Promise<void>;
  /** Re-fetches every mirrored table (field activity for the login window) and
   * merges it in — realtime events fired while the app was backgrounded are
   * lost, not replayed. Runs on app resume (throttled) and on pull-to-refresh.
   * Returns an error message or null. */
  refreshData(): Promise<string | null>;
  /** Last known position of every clocked-in user the caller may see (RLS-scoped,
   * via the live_positions() RPC, 0012). Fetched on demand by the live map — not
   * kept in global state. Throws on failure. */
  fetchLivePositions(): Promise<LivePosition[]>;
  /** GPS route of one attendance session (RLS-scoped), oldest first. For viewing
   * another user's day — the store only mirrors the viewer's own routes. */
  fetchRoute(attendanceId: string): Promise<RoutePoint[]>;
  /** Management dashboard figures for [from, to) and the given stores (null =
   * all the caller can see), computed in Postgres — the row-level history on
   * the device isn't needed for them. Throws on failure (incl. migration 0018
   * not applied) so the dashboard can fall back to local rows. */
  fetchManagementSummary(range: { from: number; to: number }, storeIds: string[] | null): Promise<ManagementSummary>;
  /** Newest-first page of the admin audit log (super_admin / PM, RLS), older than
   * `before` when given. Fetched on demand, not kept in state. Throws on failure. */
  fetchAuditLog(limit: number, before?: number): Promise<AuditEntry[]>;

  /** Resolves true if it was saved offline only (the user has already been told). */
  clockIn(pos: { lat: number; lng: number; mocked?: boolean }): Promise<boolean>;
  /** Resolves true if it was saved offline only (the user has already been told). */
  clockOut(pos: { lat: number; lng: number }): Promise<boolean>;
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

/** A business rule raised by a server trigger (P0001, e.g. the 0014 checks)
 * carries a message meant for the user; anything else gets the caller's text. */
function serverRuleMessage(error: { code?: string; message: string }): string | null {
  return error.code?.startsWith('P0') ? error.message : null;
}

/** Rolls back a failed optimistic write for exactly the rows it touched — see rollbackRows. */
function restoreRows(
  set: (p: Partial<StoreState>) => void,
  get: () => StoreState,
  key: keyof StoreState,
  ids: string[],
  before: Array<{ id: string }>,
) {
  const current = get()[key] as unknown as Array<{ id: string }>;
  set({ [key]: rollbackRows(current, ids, before) } as unknown as Partial<StoreState>);
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

/** Message of the last server error seen by replayOp — runOrQueue surfaces it
 * when a write sent straight to the server is rejected. */
let lastWriteError: string | null = null;

function settleLogged(error: { code?: string; message?: string } | null): ReplayResult {
  lastWriteError = error?.message ?? null;
  return settle(error);
}

/** Sends one queueable op to Supabase — used both for writes made while online
 * (runOrQueue) and for replaying the offline queue, so the two paths can't drift. */
async function replayOp(set: (p: Partial<StoreState>) => void, get: () => StoreState, op: QueuedOp): Promise<ReplayResult> {
  lastWriteError = null;
  if (op.type === 'clockIn') {
    const a = op.attendance;
    const { error } = await supabase.from('attendances').insert({
      id: a.id,
      user_id: a.userId,
      clock_in_at: new Date(a.clockInAt).toISOString(),
      clock_in_lat: a.clockInLat,
      clock_in_lng: a.clockInLng,
      clock_out_at: null,
      geo_fence_ok: a.geoFenceOk, // recomputed server-side (attendances_server_checks, 0014)
      location_mocked: a.locationMocked ?? false,
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
    return settleLogged(error);
  }
  if (op.type === 'clockOut') {
    // Upload what the phone still holds of this session first (best-effort —
    // since 0013 the server also accepts in-session points after clock-out).
    const userId = get().sessionUserId;
    if (userId) await flushRouteBuffer(userId);
    if (op.addPoint) {
      // Before closing the session: route_points_insert_own only accepts points
      // for an attendance that is still open.
      const { error: rpErr } = await supabase.from('route_points').insert({
        attendance_id: op.attendanceId,
        user_id: get().sessionUserId,
        lat: op.lat,
        lng: op.lng,
        recorded_at: new Date(op.clockOutAt).toISOString(),
      });
      if (rpErr) console.warn('clockOut route point failed:', rpErr.message);
    }
    const { error } = await supabase
      .from('attendances')
      .update({
        clock_out_at: new Date(op.clockOutAt).toISOString(),
        clock_out_lat: op.lat,
        clock_out_lng: op.lng,
      })
      .eq('id', op.attendanceId);
    return settleLogged(error);
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
    return settleLogged(error);
  }
  if (op.type === 'submitStockTaking') {
    return replayOptionalPhotoBatch(set, get, 'stockTakingRows', 'stock_taking', op.rows, stockTakingRow, op.localPhotoUri, 'Stock Taking');
  }
  if (op.type === 'submitOfftake') {
    // is_outlier is set by the server trigger on insert — read it back so the
    // local rows (and submitOfftake's outlier notice) show the real flag.
    const { data, error } = await supabase.from('offtake').insert(op.rows.map(offtakeRow)).select('id, is_outlier');
    const result = settleLogged(error);
    const outlierIds = new Set((data ?? []).filter((r: any) => r.is_outlier).map((r: any) => r.id as string));
    if (outlierIds.size) {
      set({ offtakeRows: get().offtakeRows.map((x) => (outlierIds.has(x.id) ? { ...x, isOutlier: true } : x)) });
    }
    return result;
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
  return settleLogged(error);
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

  // Without a deferred local photo the rows go as-is: either no photo, or (web)
  // one that was already uploaded before the op was built.
  const rowsWithPhoto = localPhotoUri ? rows.map((r) => ({ ...r, photoUrl })) : rows;
  const { error } = await supabase.from(table).insert(rowsWithPhoto.map(toDbRow));
  const result = settleLogged(error);
  if (result !== 'done' || !localPhotoUri) return result;

  if (photoUrl) {
    await discardLocalPhoto(localPhotoUri);
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
  const result = settleLogged(error);
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

let lastOfflineNoticeAt = 0;
const OFFLINE_NOTICE_COALESCE_MS = 5000;

/** Ops queued silently behind a backlog (see runOrQueue) — their sync isn't announced. */
const silentOpIds = new Set<string>();

async function currentQueueReason(get: () => StoreState): Promise<QueueReason> {
  // A session opened from the offline snapshot can't write until resumeSession
  // has confirmed it with the server — queue like offline (that also kicks it).
  if (resumeUserId) return 'offline';
  return queueReason(await isOnline(), get().pendingOps.length);
}

/**
 * The single write path for every queueable action (clock in/out, store
 * check-in/out, the report modules). The optimistic local state must already
 * be applied; `undo` reverts it if the server rejects the write.
 *
 * - offline → queued, user told it's saved on the phone;
 * - earlier ops still queued → queued silently behind them and the queue is
 *   kicked, so writes always reach the server in the order they were made;
 * - otherwise sent now via replayOp; a transient failure (no real internet
 *   despite a connection, timeout, 5xx) is queued instead of lost, and only a
 *   deterministic rejection rolls back and throws.
 *
 * `queued: true` means "saved on the phone only, and the user has been told
 * so" — screens then skip their own success message. An op queued silently
 * behind a backlog syncs within moments and reports `queued: false`.
 */
async function runOrQueue(
  set: (p: Partial<StoreState>) => void,
  get: () => StoreState,
  op: QueuedOp,
  label: string,
  undo: () => void,
): Promise<{ queued: boolean }> {
  const reason = await currentQueueReason(get);
  if (!reason) {
    const result = await replayOp(set, get, op);
    if (result === 'done') return { queued: false };
    if (result === 'dropped') {
      undo();
      throw new ShownError(`${label} tidak tersimpan.`);
    }
    if (result === 'failed') {
      undo();
      throw new Error(`${label} ditolak server${lastWriteError ? `: ${lastWriteError}` : '.'}`);
    }
  }
  await enqueueOp(set, get, op);
  if (reason === 'backlog') {
    silentOpIds.add(op.id);
    void get().processPendingOps();
  } else {
    if (reason === 'offline') {
      if (resumeUserId) void resumeSession(set, get);
    } else {
      scheduleQueueRetry(set, get); // transient failure while "online" — no NetInfo event will come
    }
    // One notice per burst: "check-out & clock out" queues two ops back to back.
    if (Date.now() - lastOfflineNoticeAt > OFFLINE_NOTICE_COALESCE_MS) {
      showDialog(
        'Tersimpan Offline',
        reason === 'offline'
          ? `${label} tersimpan di HP dan akan otomatis disinkron saat koneksi kembali.`
          : `Koneksi internet tidak stabil. ${label} tersimpan di HP dan akan dikirim otomatis.`,
      );
    }
    lastOfflineNoticeAt = Date.now();
  }
  return { queued: reason !== 'backlog' };
}

/**
 * Optional evidence photo (Stock Taking, Price Monitoring). Native: copied to
 * app storage and uploaded by replayOp — immediately when online, later from
 * the queue otherwise, so a dropped connection mid-upload never loses it.
 * Web: browser file URIs don't survive a reload, so the photo is uploaded now
 * or (offline) left out. A photo problem never blocks the report itself.
 */
async function prepareOptionalPhoto(
  visitId: string,
  photoUri: string | undefined,
): Promise<{ localPhotoUri?: string; photoUrl?: string }> {
  if (!photoUri) return {};
  if (Platform.OS !== 'web') {
    try {
      return { localPhotoUri: await persistPhotoLocally(photoUri) };
    } catch {
      showDialog('Foto Gagal Disimpan', 'Laporan tetap disimpan tanpa foto (foto bersifat opsional). Coba lampirkan foto lagi nanti.');
      return {};
    }
  }
  if (!(await isOnline())) {
    showDialog('Offline', 'Foto tidak disertakan karena tidak ada koneksi. Laporan tetap tersimpan; lampirkan foto saat online jika perlu.');
    return {};
  }
  try {
    return { photoUrl: await uploadReportMedia(visitId, photoUri, extFromUri(photoUri)) };
  } catch {
    showDialog('Foto Gagal Diupload', 'Laporan tetap disimpan tanpa foto (foto bersifat opsional). Coba lampirkan foto lagi nanti.');
    return {};
  }
}

/**
 * Required-photo reports (Share of Shelf, Paid Visibility) — the row can never
 * exist without its photo (DB not-null). Native: the photo is copied to app
 * storage and the op goes through runOrQueue; replayRequiredPhotoRow uploads
 * it and only then inserts, now or later from the queue. Web can't keep a
 * picked file across a reload, so it stays online-only: upload, then insert.
 */
async function submitRequiredPhotoReport<K extends 'shareOfShelfRows' | 'paidVisibilityRows', R extends { id: string; visitId: string }>(
  set: (p: Partial<StoreState>) => void,
  get: () => StoreState,
  p: {
    stateKey: K;
    table: string;
    toDbRow: (r: any) => Record<string, unknown>;
    row: R;
    photoUri: string;
    label: string;
    makeOp: (localPhotoUri: string) => QueuedOp;
  },
): Promise<{ queued: boolean }> {
  const rowsOf = () => get()[p.stateKey] as unknown as Array<{ id: string }>;
  const setRows = (rows: Array<{ id: string }>) => set({ [p.stateKey]: rows } as unknown as Partial<StoreState>);

  if (Platform.OS !== 'web') {
    let localPhotoUri: string;
    try {
      localPhotoUri = await persistPhotoLocally(p.photoUri);
    } catch {
      showDialog('Gagal Menyimpan Foto', 'Tidak dapat menyimpan foto di perangkat. Laporan tidak disimpan — coba lagi.');
      throw new ShownError('Gagal menyimpan foto secara lokal.');
    }
    setRows([{ ...p.row, photoUrl: localPhotoUri }, ...rowsOf()]);
    return runOrQueue(set, get, p.makeOp(localPhotoUri), p.label, () => {
      setRows(rowsOf().filter((r) => r.id !== p.row.id));
      void discardLocalPhoto(localPhotoUri);
    });
  }

  const reason = await currentQueueReason(get);
  if (reason) {
    showDialog(
      reason === 'offline' ? 'Offline' : 'Menunggu Sinkronisasi',
      reason === 'offline'
        ? `${p.label} butuh foto sebagai bukti wajib — tidak dapat disimpan tanpa koneksi internet. Coba lagi saat online.`
        : `Masih ada data offline yang sedang dikirim ke server. Coba simpan ${p.label} lagi sebentar lagi.`,
    );
    throw new ShownError('Tidak dapat disimpan sekarang.');
  }
  let photoUrl: string;
  try {
    photoUrl = await uploadReportMedia(p.row.visitId, p.photoUri, extFromUri(p.photoUri));
  } catch {
    showDialog('Gagal Upload Foto', `Foto wajib untuk ${p.label} tidak berhasil diupload. Laporan tidak disimpan — coba lagi.`);
    throw new ShownError('Upload foto gagal.');
  }
  const full = { ...p.row, photoUrl };
  setRows([full, ...rowsOf()]);
  const { error } = await supabase.from(p.table).insert(p.toDbRow(full));
  if (error) {
    setRows(rowsOf().filter((r) => r.id !== p.row.id));
    showDialog('Gagal Menyimpan', `Tidak dapat menyimpan ${p.label} ke server. Periksa koneksi internet dan coba lagi.`);
    throw new ShownError(error.message);
  }
  return { queued: false };
}

/** SKUs (lower-cased) already reported in this visit for a per-SKU module. */
export function reportedSkus(rows: Array<{ visitId: string; sku: string }>, visitId: string): Set<string> {
  return new Set(rows.filter((r) => r.visitId === visitId).map((r) => r.sku.toLowerCase()));
}

/** Reports belong inside their visit — the server refuses one made after
 * check-out (report_server_checks, 0014), so say so before trying. */
function assertVisitOpen(get: () => StoreState, visitId: string) {
  const v = get().visits.find((x) => x.id === visitId);
  if (v?.checkOutAt) throw new Error('Kunjungan ini sudah check-out — laporan tidak bisa ditambahkan lagi.');
}

/** One report per visit per SKU (category / visibility type for SoS / PV) —
 * a second submission would double the numbers. Mirrors the server-side
 * reject_duplicate_report trigger (0013), which also covers other devices. */
function assertNewSkus(rows: Array<{ visitId: string; sku: string }>, visitId: string, skus: string[]) {
  const done = reportedSkus(rows, visitId);
  const dup = skus.filter((sku) => done.has(sku.toLowerCase()));
  if (dup.length) throw new Error(`SKU berikut sudah dilaporkan di kunjungan ini: ${dup.join(', ')}.`);
}

/** Consumer rules checked before any write (same as consumers_server_checks,
 * 0015, which also sees other NCs' consumers). Shows the dialog; returns a reason or null. */
function consumerProblem(get: () => StoreState, c: Consumer): string | null {
  const before = get().consumers.find((x) => x.id === c.id);
  if (c.erasedAt || (before && before.waContact === c.waContact)) return null;
  if (!isValidWa(c.waContact)) {
    showDialog('Nomor WhatsApp Tidak Valid', 'Gunakan nomor HP Indonesia, mis. 0812xxxxxxxx.');
    return 'invalid wa';
  }
  const key = normalizeWa(c.waContact);
  if (get().consumers.some((x) => x.id !== c.id && !x.erasedAt && normalizeWa(x.waContact) === key)) {
    showDialog('Konsumen Sudah Terdaftar', 'Nomor WhatsApp ini sudah terdaftar sebagai konsumen. Buka data konsumen yang ada.');
    return 'duplicate wa';
  }
  return null;
}

/** NTG step rules checked before any write: visit synced, forward-only funnel
 * (0015), under-1 rule (0014). `ageBracket` is the consumer's as it will be
 * saved. Shows the dialog; returns a reason or null. */
function ntgStepProblem(get: () => StoreState, n: NtgGwp, ageBracket: string | undefined): string | null {
  if (visitPendingSync(get, n.visitId)) {
    showVisitPendingDialog();
    return 'visit not synced yet';
  }
  // The loaded rows are only a recent window: the consumer row's current_stage
  // (0019) stands for everything older.
  const known = get().consumers.find((c) => c.id === n.consumerId)?.currentStage;
  const stepErr = funnelStepError(
    [...get().ntgGwps.filter((g) => g.consumerId === n.consumerId).map((g) => g.stage), ...(known ? [known] : [])],
    n.stage,
  );
  if (stepErr) {
    showDialog('Tahap Funnel Tidak Valid', stepErr);
    return stepErr;
  }
  if (n.stage !== 'approached' && isUnder1Bracket(ageBracket)) {
    showDialog(UNDER1_TITLE, UNDER1_MESSAGE);
    return 'under-1 consumer';
  }
  return null;
}

/** Mirrors ntg_gwp_sync_consumer_stage (0019) locally after a step is saved,
 * so the consumer list shows the new stage before the realtime echo arrives. */
function raiseConsumerStage(set: (p: Partial<StoreState>) => void, get: () => StoreState, n: NtgGwp) {
  set({
    consumers: get().consumers.map((c) => {
      if (c.id !== n.consumerId) return c;
      const next = highestStage([c.currentStage, n.stage]);
      return next === c.currentStage ? c : { ...c, currentStage: next, currentStageAt: n.createdAt };
    }),
  });
}

/** True while this visit's own check-in is still in the offline queue — the
 * visits row doesn't exist server-side yet, so online-only writes that
 * reference it (NTG & GWP, survey responses) would fail on the foreign key. */
function visitPendingSync(get: () => StoreState, visitId: string | null | undefined): boolean {
  return !!visitId && get().pendingOps.some((op) => op.type === 'startVisit' && op.visit.id === visitId);
}

function showVisitPendingDialog() {
  showDialog(
    'Kunjungan Belum Tersinkron',
    'Check-in toko ini masih tersimpan offline di HP. Tunggu sampai tersinkron (butuh koneksi internet), lalu simpan lagi.',
  );
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
/** Last full data re-sync (refreshData) — throttles the resume trigger. */
let lastRefreshAt = Date.now();
const RESUME_REFRESH_MIN_INTERVAL_MS = 2 * 60 * 1000;

/** User whose session was opened from the offline snapshot (or couldn't be
 * opened at all) at cold start and still needs a full server sync — set by
 * init(), cleared by resumeSession() once the server answers. */
let resumeUserId: string | null = null;

/** A queue left behind by a transient replay failure while online gets no
 * NetInfo event to retry it — this timer does, until the queue drains. */
let queueRetryTimer: ReturnType<typeof setTimeout> | null = null;
const QUEUE_RETRY_MS = 30 * 1000;

function clearQueueRetry() {
  if (queueRetryTimer) clearTimeout(queueRetryTimer);
  queueRetryTimer = null;
}

function scheduleQueueRetry(set: (p: Partial<StoreState>) => void, get: () => StoreState) {
  if (queueRetryTimer) return;
  queueRetryTimer = setTimeout(() => {
    queueRetryTimer = null;
    onMaybeOnline(set, get);
  }, QUEUE_RETRY_MS);
}

// --- on-device snapshot for offline cold starts (see utils/offlineCache) ---

/** Own field activity kept in the snapshot: the last 2 days, plus anything
 * still open (an attendance/visit started earlier and never closed). */
const OFFLINE_CACHE_DAYS = 2;

/** Slices whose change triggers a snapshot save. */
const SNAPSHOT_KEYS = [
  'users',
  'teams',
  'stores',
  'products',
  'surveys',
  'targets',
  'attendances',
  'visits',
  'stockTakingRows',
  'offtakeRows',
  'shareOfShelfRows',
  'paidVisibilityRows',
  'priceMonitoringRows',
] as const satisfies ReadonlyArray<keyof StoreState>;

function buildOfflineSnapshot(s: StoreState, userId: string): OfflineSnapshot {
  const since = Date.now() - OFFLINE_CACHE_DAYS * 86400000;
  const attendances = s.attendances.filter((a) => a.userId === userId && (!a.clockOutAt || a.clockInAt >= since));
  const visits = s.visits.filter((v) => v.ncId === userId && (!v.checkOutAt || v.checkInAt >= since));
  const visitIds = new Set(visits.map((v) => v.id));
  const ofVisits = <T extends { visitId: string }>(rows: T[]) => rows.filter((r) => visitIds.has(r.visitId));
  return {
    savedAt: Date.now(),
    historyFrom: since,
    data: {
      users: s.users,
      teams: s.teams,
      stores: s.stores,
      products: s.products,
      surveys: s.surveys,
      targets: s.targets,
      attendances,
      visits,
      stockTakingRows: ofVisits(s.stockTakingRows),
      offtakeRows: ofVisits(s.offtakeRows),
      shareOfShelfRows: ofVisits(s.shareOfShelfRows),
      paidVisibilityRows: ofVisits(s.paidVisibilityRows),
      priceMonitoringRows: ofVisits(s.priceMonitoringRows),
    },
  };
}

/** Opens the app for `userId` from the on-device snapshot. False if none exists. */
async function bootFromSnapshot(
  set: (p: Partial<StoreState>) => void,
  get: () => StoreState,
  userId: string,
): Promise<boolean> {
  const snap = await loadSnapshot(userId);
  if (!snap || !(snap.data.users as User[] | undefined)?.some((u) => u.id === userId)) return false;
  set({
    ...(snap.data as Partial<StoreState>),
    sessionUserId: userId,
    historyFrom: snap.historyFrom,
    offlineSnapshotAt: snap.savedAt,
  });
  await restoreQueue(set, get, userId);
  await syncRoutePoints(set, get, false);
  return true;
}

function teardownRealtime() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

function subscribeRealtime(
  set: (partial: Partial<StoreState>) => void,
  get: () => StoreState,
  userId: string,
  role: Role | undefined,
) {
  teardownRealtime();
  let ch = supabase.channel('app-sync');
  // One generic handler per mirrored table (SNAPSHOT_TABLES): INSERT/UPDATE
  // upsert the mapped row, DELETE removes it. Messages arriving here are the
  // live path for ChatThreadScreen (new messages and read_at updates).
  for (const t of SNAPSHOT_TABLES) {
    if (t.realtime === false || !loadsTable(t.table, role)) continue;
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t.table }, (payload) => {
      const list = get()[t.key] as unknown as Array<{ id: string }>;
      if (payload.eventType === 'DELETE') {
        set({ [t.key]: list.filter((r) => r.id !== (payload.old as any).id) } as unknown as Partial<StoreState>);
        return;
      }
      const fresh = t.map(payload.new);
      const row = t.keepLocal ? t.keepLocal(fresh, list.find((r) => r.id === fresh.id)) : fresh;
      set({ [t.key]: upsertById(list, row) } as unknown as Partial<StoreState>);
    });
  }
  channel = ch
    // Own points only — see hydrateAll's route_points comment. Unfiltered, a
    // monitor role would receive every NC's GPS ping (~13 events/s program-wide).
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'route_points', filter: `user_id=eq.${userId}` }, (payload) => {
      const p = payload.new as any;
      const t = new Date(p.recorded_at).getTime();
      set({
        attendances: get().attendances.map((a) =>
          // Recorded locally first (routeBuffer listener) — skip the echo.
          a.id === p.attendance_id && !a.route.some((r) => r.t === t)
            ? { ...a, route: [...a.route, { lat: p.lat, lng: p.lng, t }].sort((x, y) => x.t - y.t) }
            : a,
        ),
      });
    })
    .subscribe();
}

/** PostgREST caps every response at `max_rows` (1000 on Supabase by default)
 * and truncates silently — a plain select('*') on visits/offtake/etc. would
 * quietly drop everything past the first 1000 rows once the program has a few
 * days of data. Pages through with a stable order (every table's `id` is its PK). */
const PAGE_SIZE = 1000;

/** Time filter for a windowed table: `since` = rows on/after, `before` = rows
 * strictly before. `keepNull` also returns rows where that column is null —
 * used so an open attendance/visit (no clock-out/check-out yet) always loads
 * no matter how old, since the UI must know the user is still clocked in. */
interface TimeFilter {
  col: string;
  since?: string;
  before?: string;
  keepNull?: string;
}

async function fetchAll(
  table: string,
  filter?: TimeFilter,
  orderBy = 'id',
): Promise<{ data: any[]; error: { message: string; code?: string } | null }> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase.from(table).select('*');
    if (filter?.since) {
      q = filter.keepNull
        ? q.or(`${filter.col}.gte."${filter.since}",${filter.keepNull}.is.null`)
        : q.gte(filter.col, filter.since);
    }
    if (filter?.before) q = q.lt(filter.col, filter.before);
    const { data, error } = await q.order(orderBy, { ascending: true }).range(from, from + PAGE_SIZE - 1);
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

/**
 * Field-activity tables that grow every day (~195 NCs x visits/reports/pings)
 * and are only loaded for the last HISTORY_DAYS at login — see config.ts.
 * Everything else (profiles, teams, stores, products, consumers, surveys,
 * targets, scorecards, conversations) is small or needs full history and
 * loads completely (for the roles that load it at all — MirroredTable.roles).
 * ntg_gwp is windowed too: a consumer's current funnel stage, which used to
 * need its whole history, is kept on the consumer row (current_stage, 0019);
 * ConsumerDetail fetches one consumer's full history when opened.
 */
const WINDOWED_TABLES: Array<{
  table: string;
  key: keyof StoreState;
  col: string;
  keepNull?: string;
  map: (r: any) => any;
  /** Per-SKU report tables — by far the largest; see historyWindow(). */
  heavy?: true;
}> = [
  { table: 'visits', key: 'visits', col: 'check_in_at', keepNull: 'check_out_at', map: mapVisit },
  { table: 'attendances', key: 'attendances', col: 'clock_in_at', keepNull: 'clock_out_at', map: (a) => mapAttendance(a, []) },
  { table: 'stock_taking', key: 'stockTakingRows', col: 'created_at', map: mapStockTaking, heavy: true },
  { table: 'offtake', key: 'offtakeRows', col: 'created_at', map: mapOfftake, heavy: true },
  { table: 'share_of_shelf', key: 'shareOfShelfRows', col: 'created_at', map: mapShareOfShelf, heavy: true },
  { table: 'paid_visibility', key: 'paidVisibilityRows', col: 'created_at', map: mapPaidVisibility, heavy: true },
  { table: 'price_monitoring', key: 'priceMonitoringRows', col: 'created_at', map: mapPriceMonitoring, heavy: true },
  { table: 'ntg_gwp', key: 'ntgGwps', col: 'created_at', map: mapNtgGwp },
  { table: 'survey_responses', key: 'surveyResponses', col: 'created_at', map: mapSurveyResponse },
  { table: 'report_reviews', key: 'reportReviews', col: 'reviewed_at', keepNull: 'reviewed_at', map: mapReportReview },
  { table: 'coaching_logs', key: 'coachingLogs', col: 'date', map: mapCoachingLog },
  { table: 'messages', key: 'messages', col: 'created_at', map: mapMessage },
  // Plans from the window start on — future days included (no upper bound).
  { table: 'schedules', key: 'schedules', col: 'planned_date', map: mapSchedule },
];


interface HistoryWindow {
  /** Start of the login window for field-activity tables. */
  since: number;
  /** Start for the heavy per-SKU report tables (later than `since` for non-field roles). */
  reportsSince: number;
}

/**
 * Field roles (NC/TL/ARCO) load the full HISTORY_DAYS of everything in their
 * (small) scope. Every other role sees the whole program, and the per-SKU
 * report tables are where the volume is (hundreds of thousands of rows at 195
 * NCs) — their dashboard figures come from management_summary (0018), so the
 * device only keeps NON_FIELD_REPORT_HISTORY_DAYS of those rows for drill-downs.
 */
function historyWindow(role: Role | undefined, now = new Date()): HistoryWindow {
  const since = historyWindowStart(now, HISTORY_DAYS);
  const field = role === 'nc' || role === 'tl' || role === 'arco';
  return { since, reportsSince: field ? since : historyWindowStart(now, NON_FIELD_REPORT_HISTORY_DAYS) };
}

function windowFilter(table: string, w: HistoryWindow): TimeFilter | undefined {
  const t = WINDOWED_TABLES.find((x) => x.table === table);
  return t && { col: t.col, since: new Date(t.heavy ? w.reportsSince : w.since).toISOString(), keepNull: t.keepNull };
}

/**
 * Every table the app mirrors, with its state key and row mapper. Windowed
 * tables (WINDOWED_TABLES) are fetched for the login history window only;
 * the rest in full. Shared by hydrateAll (login) and refreshData (resume /
 * pull-to-refresh) so the two can never drift apart.
 */
interface MirroredTable {
  table: string;
  key: keyof StoreState;
  map: (r: any) => any;
  /** false = not subscribed to realtime (see the table's own comment). */
  realtime?: false;
  /** Merges a realtime row with the locally held one (fields the row lacks). */
  keepLocal?: (fresh: any, local: any) => any;
  /** Only these roles load (and subscribe to) the table; absent = everyone. */
  roles?: Role[];
}

/** Whether `role` mirrors table `t` at all — see SNAPSHOT_TABLES. */
function loadsTable(table: string, role: Role | undefined): boolean {
  const t = SNAPSHOT_TABLES.find((x) => x.table === table);
  return !t?.roles || (!!role && t.roles.includes(role));
}

const SNAPSHOT_TABLES: MirroredTable[] = [
  // profiles no longer carries the phone (profile_contacts, 0015) — keep the known one.
  { table: 'profiles', key: 'users', map: mapProfile, keepLocal: (u: User, l?: User) => ({ ...u, phone: u.phone ?? l?.phone }) },
  { table: 'teams', key: 'teams', map: mapTeam },
  { table: 'stores', key: 'stores', map: mapStore },
  { table: 'visits', key: 'visits', map: mapVisit },
  // The route is mirrored separately (route_points) — keep the local one.
  {
    table: 'attendances',
    key: 'attendances',
    map: (a) => mapAttendance(a, []),
    keepLocal: (a: Attendance, l?: Attendance) => ({ ...a, route: l?.route ?? a.route }),
  },
  { table: 'products', key: 'products', map: mapProduct },
  { table: 'stock_taking', key: 'stockTakingRows', map: mapStockTaking },
  { table: 'offtake', key: 'offtakeRows', map: mapOfftake },
  // Only the NC who registers consumers opens them (Consumers / ConsumerDetail
  // are reached from the NC's own store visit). The current funnel stage is on
  // the consumer row (current_stage, 0019), so the full ntg_gwp history isn't
  // needed to know it.
  { table: 'consumers', key: 'consumers', map: mapConsumer, roles: ['nc'] },
  // Recent window only (WINDOWED_TABLES), for the field roles' daily-report
  // views; dashboards get NTG figures from management_summary (0018).
  { table: 'ntg_gwp', key: 'ntgGwps', map: mapNtgGwp, roles: ['nc', 'tl', 'arco'] },
  { table: 'share_of_shelf', key: 'shareOfShelfRows', map: mapShareOfShelf },
  { table: 'paid_visibility', key: 'paidVisibilityRows', map: mapPaidVisibility },
  { table: 'price_monitoring', key: 'priceMonitoringRows', map: mapPriceMonitoring },
  { table: 'surveys', key: 'surveys', map: mapSurvey },
  { table: 'survey_responses', key: 'surveyResponses', map: mapSurveyResponse },
  { table: 'report_reviews', key: 'reportReviews', map: mapReportReview },
  { table: 'coaching_logs', key: 'coachingLogs', map: mapCoachingLog },
  { table: 'targets', key: 'targets', map: mapTarget },
  // One compute run upserts 200+ rows — refetched explicitly instead (computeScorecards).
  { table: 'scorecards', key: 'scorecards', map: mapScorecard, realtime: false },
  { table: 'conversations', key: 'conversations', map: mapConversation },
  { table: 'messages', key: 'messages', map: mapMessage },
  // Not in the realtime publication; writers update local state directly.
  { table: 'certifications', key: 'certifications', map: mapCertification, realtime: false },
  // PJP: the NC follows their plan; TL/ARCO/admins plan it.
  { table: 'schedules', key: 'schedules', map: mapSchedule, roles: ['nc', 'tl', 'arco', 'super_admin', 'admin_data_entry'] },
];

/** Fetches every SNAPSHOT_TABLES table (windowed ones from `since`). Raw rows, keyed by table. */
async function fetchSnapshot(
  w: HistoryWindow,
  role: Role | undefined,
): Promise<{ rows: Record<string, any[]>; error: { message: string; code?: string } | null }> {
  const results = await Promise.all(
    SNAPSHOT_TABLES.map((t) =>
      loadsTable(t.table, role) ? fetchAll(t.table, windowFilter(t.table, w)) : Promise.resolve({ data: [] as any[], error: null }),
    ),
  );
  const rows: Record<string, any[]> = {};
  SNAPSHOT_TABLES.forEach((t, i) => (rows[t.table] = results[i].data));
  return { rows, error: results.find((r) => r.error)?.error ?? null };
}

/**
 * Staff phone numbers live in profile_contacts (migration 0015), readable only
 * by the person, super_admin/PM and their TL/ARCO — not by the client role.
 * Merged into `users` for display; a failure just leaves phones out.
 */
async function withContacts(users: User[]): Promise<User[]> {
  const { data, error } = await fetchAll('profile_contacts', undefined, 'user_id');
  if (error) {
    console.warn('profile_contacts load failed (non-fatal):', error.message);
    return users;
  }
  const phoneById = new Map(data.map((c: any) => [c.user_id as string, (c.phone as string | null) ?? undefined]));
  return users.map((u) => (phoneById.has(u.id) ? { ...u, phone: phoneById.get(u.id) } : u));
}

/** Fetches the caller's profile + every scoped row (RLS-filtered) and hydrates the store. */
async function hydrateAll(
  set: (partial: Partial<StoreState>) => void,
  get: () => StoreState,
  userId: string,
): Promise<HydrateResult> {
  const { data: me, error: meErr } = await supabase.from('profiles').select('*').eq('id', userId).single();
  // PGRST116 = no row: the profile is gone / not visible. Any other failure
  // (no network, timeout, 5xx) says nothing about the account — never treat
  // it as "deactivated", or a phone without signal signs its user out.
  if (meErr) return meErr.code === 'PGRST116' ? 'inactive' : 'offline';
  if (!me?.active) return 'inactive';

  const w = historyWindow(me.role);
  const { rows, error: snapErr } = await fetchSnapshot(w, me.role);
  if (snapErr) {
    // Connection dropped mid-load: keep whatever the caller already has rather
    // than replacing it with a partial snapshot.
    if (isNetworkError(snapErr)) return 'offline';
    console.warn('hydrateAll: some tables failed to load:', snapErr.message);
  }

  const routePoints = await fetchOwnRoutePoints(userId, rows.attendances);
  const routesByAttendance = new Map<string, RoutePoint[]>();
  for (const p of routePoints) {
    const arr = routesByAttendance.get(p.attendance_id) ?? [];
    arr.push({ lat: p.lat, lng: p.lng, t: new Date(p.recorded_at).getTime() });
    routesByAttendance.set(p.attendance_id, arr);
  }
  for (const arr of routesByAttendance.values()) arr.sort((a, b) => a.t - b.t);

  // historyFrom = the latest window start, so "load older history" covers every table.
  const patch: Partial<StoreState> = { sessionUserId: userId, historyFrom: w.reportsSince, offlineSnapshotAt: null };
  for (const t of SNAPSHOT_TABLES) (patch as any)[t.key] = rows[t.table].map(t.map);
  patch.attendances = rows.attendances.map((a: any) => mapAttendance(a, routesByAttendance.get(a.id) ?? []));
  patch.users = await withContacts(patch.users ?? []);
  set(patch);
  lastRefreshAt = Date.now();
  void setLastUser(userId);

  subscribeRealtime(set, get, userId, me.role);
  return 'ok';
}

/** 'offline' = the server couldn't be reached (state untouched); 'inactive' =
 * the account is deactivated or has no profile. */
type HydrateResult = 'ok' | 'inactive' | 'offline';

/**
 * Completes a session that cold start opened from the offline snapshot (or
 * couldn't open at all): once the server is reachable, does the full load and
 * re-applies still-queued ops on top (the fresh server snapshot doesn't
 * contain them yet). A session that turns out to be truly gone (refresh token
 * revoked/expired) drops back to the login screen.
 */
let resuming = false;

async function resumeSession(set: (p: Partial<StoreState>) => void, get: () => StoreState): Promise<void> {
  if (resuming) return;
  resuming = true;
  try {
    await resumeSessionOnce(set, get);
  } finally {
    resuming = false;
  }
}

async function resumeSessionOnce(set: (p: Partial<StoreState>) => void, get: () => StoreState): Promise<void> {
  const userId = resumeUserId;
  if (!userId || !(await isOnline())) return;
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (resumeUserId !== userId) return; // logged out meanwhile
  if (!session) {
    if (error && isAuthRetryableFetchError(error)) return; // still can't reach auth — try again later
    // The session is really gone (refresh token revoked/expired): back to the
    // login screen. The queue stays on disk and resumes on the next login.
    resumeUserId = null;
    void setLastUser(null);
    void deleteSnapshot(userId);
    teardownRealtime();
    set(SIGNED_OUT_STATE);
    return;
  }
  const result = await hydrateAll(set, get, session.user.id);
  if (result === 'offline') return;
  resumeUserId = null;
  if (result === 'inactive') {
    await get().logout();
    showDialog('Akun Nonaktif', 'Akun dinonaktifkan atau tidak ditemukan. Hubungi admin.');
    return;
  }
  if (session.user.id === userId && get().pendingOps.length) {
    for (const op of get().pendingOps) applyQueuedOpLocally(set, get, op);
  } else {
    await restoreQueue(set, get, session.user.id);
  }
  void get().processPendingOps();
  void syncRoutePoints(set, get);
  registerPushToken();
}

/** Adds GPS points to the local copy of their attendance's route (display
 * only — km, point count, the map). Idempotent: points already there are skipped. */
function applyRoutePoints(set: (p: Partial<StoreState>) => void, get: () => StoreState, points: BufferedPoint[]) {
  if (!points.length) return;
  const byAttendance = new Map<string, BufferedPoint[]>();
  for (const p of points) byAttendance.set(p.attendanceId, [...(byAttendance.get(p.attendanceId) ?? []), p]);
  let changed = false;
  const attendances = get().attendances.map((a) => {
    const add = byAttendance.get(a.id)?.filter((p) => !a.route.some((r) => r.t === p.t));
    if (!add?.length) return a;
    changed = true;
    return { ...a, route: [...a.route, ...add.map(({ lat, lng, t }) => ({ lat, lng, t }))].sort((x, y) => x.t - y.t) };
  });
  if (changed) set({ attendances });
}

/** Shows the points still waiting on this phone (a fresh server load doesn't
 * have them yet), then uploads them. */
async function syncRoutePoints(set: (p: Partial<StoreState>) => void, get: () => StoreState, upload = true) {
  const userId = get().sessionUserId;
  if (!userId) return;
  applyRoutePoints(set, get, await readBufferedPoints(userId));
  if (upload && !resumeUserId) await flushRouteBuffer(userId);
}

/** Connectivity may be back (NetInfo change, app foregrounded, retry timer):
 * finish an offline-opened session first, otherwise flush the queue (which
 * uploads buffered route points when it's done) or just the route points. */
function onMaybeOnline(set: (p: Partial<StoreState>) => void, get: () => StoreState) {
  if (resumeUserId) void resumeSession(set, get);
  else if (get().pendingOps.length) void get().processPendingOps();
  else void syncRoutePoints(set, get);
}

/**
 * A TL's scope (RLS profiles_select/visits_select etc. use the TL's
 * profiles.team_id) must follow teams.tl_id, or a newly assigned TL sees none
 * of the team's NCs while the replaced TL keeps seeing all of them. So: the new
 * TL's profile moves to this team, and the previous TL — if still attached to
 * this team — is detached (team_id null) until reassigned. Runs after the team
 * write itself succeeded; failures are surfaced, not rolled back.
 */
async function syncTeamLeader(
  set: (p: Partial<StoreState>) => void,
  get: () => StoreState,
  teamId: string,
  newTlId: string | null,
  oldTlId: string | null,
) {
  const patch = new Map<string, string | null>();
  if (newTlId) patch.set(newTlId, teamId);
  if (oldTlId && oldTlId !== newTlId && get().users.find((u) => u.id === oldTlId)?.teamId === teamId) {
    patch.set(oldTlId, null);
  }
  for (const [userId, teamIdForUser] of patch) {
    const { error } = await supabase.from('profiles').update({ team_id: teamIdForUser }).eq('id', userId);
    if (error) {
      showDialog('Perlu Dicek', 'Tim tersimpan, tetapi tim pada profil TL gagal diperbarui. Atur manual lewat Pengguna → Ubah.');
      continue;
    }
    set({ users: get().users.map((u) => (u.id === userId ? { ...u, teamId: teamIdForUser } : u)) });
  }
}

async function callAdminUsers(body: Record<string, unknown>): Promise<{ data?: any; error?: string }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) return { error: error.message ?? 'Gagal menghubungi server.' };
  if (data?.error) return { error: data.error };
  return { data };
}

/** Requests notification permission and syncs the Expo push token to the
 * caller's own profile (PRD §17) — best-effort, fire-and-forget, never blocks
 * login/init. Needs app.json's extra.eas.projectId, which `eas init` writes;
 * until then registration is skipped with a warning, not surfaced to the user —
 * push is additive to in-app chat, never a requirement to use it. */
/** This device's Expo push token, once registered — cleared server-side at logout. */
let myPushToken: string | null = null;

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
    if (!projectId) {
      console.warn('registerPushToken: no EAS project id in app.json (run `eas init`) — skipping.');
      return;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    myPushToken = token;
    // Re-assigns this device's token to the signed-in user (push_tokens, 0015).
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
  certifications: [],
  schedules: [],
  pendingOps: [],
  historyFrom: null,
  offlineSnapshotAt: null,
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
  certifications: [],
  schedules: [],
  pendingOps: [],
  historyFrom: null,
  offlineSnapshotAt: null,

  init: async () => {
    const {
      data: { session },
      error: sessionErr,
    } = await supabase.auth.getSession();
    if (session?.user) {
      const result = await hydrateAll(set, get, session.user.id);
      if (result === 'inactive') {
        await supabase.auth.signOut();
      } else if (result === 'ok') {
        await restoreQueue(set, get, session.user.id);
        void syncRoutePoints(set, get);
        registerPushToken(); // fire-and-forget, PRD §17
      } else {
        // No server: open from the on-device snapshot so field work (clock,
        // check-in, reports → offline queue) can continue. Without a snapshot
        // the login screen shows, but the session is kept and resumes by itself
        // once the server is reachable — never sign out over a network error.
        resumeUserId = session.user.id;
        await bootFromSnapshot(set, get, session.user.id);
      }
    } else if (sessionErr && isAuthRetryableFetchError(sessionErr)) {
      // The stored access token expired and couldn't be refreshed offline —
      // auth-js keeps the session in storage, so it's still ours to resume.
      const lastUser = await getLastUser();
      if (lastUser) {
        resumeUserId = lastUser;
        await bootFromSnapshot(set, get, lastUser);
      }
    }
    set({ ready: true });

    if (!authListenerBound) {
      authListenerBound = true;
      supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          const userId = get().sessionUserId ?? resumeUserId;
          resumeUserId = null;
          clearQueueRetry();
          teardownRealtime();
          set(SIGNED_OUT_STATE);
          void setLastUser(null);
          if (userId) void deleteSnapshot(userId);
        }
      });
    }
    if (!netInfoListenerBound) {
      netInfoListenerBound = true;
      NetInfo.addEventListener((state) => {
        if (reachable(state)) onMaybeOnline(set, get);
      });
      // NetInfo only fires on connectivity *changes* — a replay that failed
      // transiently while online would otherwise wait for the next drop/reconnect.
      AppState.addEventListener('change', (s) => {
        if (s !== 'active') return;
        if (resumeUserId) {
          void resumeSession(set, get);
          return;
        }
        if (get().pendingOps.length) get().processPendingOps();
        // Realtime events that fired while the app was backgrounded (socket
        // asleep) are lost, not replayed — e.g. a chat message whose push
        // notification arrived but whose row never reached the phone. Chat is
        // cheap and always re-synced; the full re-sync is throttled because for
        // monitor roles it re-reads the whole 62-day window.
        if (!get().sessionUserId) return;
        void get().refreshChat();
        if (Date.now() - lastRefreshAt >= RESUME_REFRESH_MIN_INTERVAL_MS) void get().refreshData();
      });
    }
    if (resumeUserId) void resumeSession(set, get); // in case the network came back during boot
  },

  processPendingOps: async () => {
    const userId = get().sessionUserId;
    // Not while an offline-opened session is still unconfirmed: without a
    // valid token the requests would go out as anon, RLS would reject them
    // as "failed", and the ops would be dropped. resumeSession() flushes after.
    if (replayingQueue || resumeUserId || !userId || !get().pendingOps.length) return;
    replayingQueue = true;
    clearQueueRetry();
    let synced = 0;
    let silentSynced = 0;
    let failedOps: QueuedOp[] = [];
    try {
      ({ synced, failed: failedOps } = await drainQueue({
        head: () => get().pendingOps[0],
        replay: async (op) => {
          const result = await replayOp(set, get, op);
          // Ops queued only to keep order behind a backlog were never announced
          // as "saved offline" — don't announce their sync either.
          if (result === 'done' && silentOpIds.delete(op.id)) silentSynced++;
          return result;
        },
        remove: async (op) => {
          const next = get().pendingOps.filter((o) => o.id !== op.id);
          set({ pendingOps: next });
          await saveQueue(userId, next);
        },
        stillValid: () => get().sessionUserId === userId,
      }));
    } finally {
      replayingQueue = false;
    }
    if (get().sessionUserId === userId && get().pendingOps.length) scheduleQueueRetry(set, get);
    // Clock-ins that just landed unblock their buffered route points.
    if (get().sessionUserId === userId) void flushRouteBuffer(userId);
    const failed = failedOps.map((op) => OP_LABEL[op.type]);
    if (failed.length) {
      showDialog(
        'Sebagian Data Offline Ditolak Server',
        `Data berikut tidak bisa disimpan dan perlu diisi ulang: ${failed.join(', ')}. Hubungi TL/admin bila berulang.`,
      );
    } else if (synced > silentSynced && !get().pendingOps.length) {
      showToast('Data offline berhasil dikirim ke server');
    }
  },

  loadFullHistory: async () => {
    const before = get().historyFrom;
    if (before == null) return null;
    const role = get().users.find((u) => u.id === get().sessionUserId)?.role;
    const results = await Promise.all(
      WINDOWED_TABLES.map((w) =>
        loadsTable(w.table, role)
          ? fetchAll(w.table, { col: w.col, before: new Date(before).toISOString() })
          : Promise.resolve({ data: [] as any[], error: null }),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed) return failed.error!.message;
    const patch: Partial<StoreState> = { historyFrom: null };
    WINDOWED_TABLES.forEach((w, i) => {
      const current = get()[w.key] as unknown as Array<{ id: string }>;
      const seen = new Set(current.map((r) => r.id));
      const older = results[i].data.map(w.map).filter((r: { id: string }) => !seen.has(r.id));
      (patch as any)[w.key] = [...current, ...older];
    });
    set(patch);
    return null;
  },

  login: async (username, password) => {
    resumeUserId = null; // an explicit login replaces any session still waiting to resume
    const email = `${username.trim().toLowerCase()}@internal.spc`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // AuthApiError (4xx) = bad credentials; anything else is connectivity.
      return error.status && error.status >= 400 && error.status < 500
        ? 'Username atau password salah.'
        : 'Tidak dapat terhubung ke server. Periksa koneksi internet dan coba lagi.';
    }
    const result = await hydrateAll(set, get, data.user.id);
    if (result !== 'ok') {
      await supabase.auth.signOut();
      return result === 'inactive'
        ? 'Akun dinonaktifkan atau tidak ditemukan. Hubungi admin.'
        : 'Koneksi terputus saat memuat data. Periksa koneksi internet dan coba lagi.';
    }
    // init() only restores a queue when a session already existed at cold
    // start — a queue persisted before the session expired must load here.
    await restoreQueue(set, get, data.user.id);
    void syncRoutePoints(set, get);
    registerPushToken(); // fire-and-forget, PRD §17
    return null;
  },

  logout: async () => {
    const userId = get().sessionUserId;
    resumeUserId = null;
    clearQueueRetry();
    teardownRealtime();
    // Stop this phone receiving the user's chat pushes once they've signed out
    // (best-effort: offline, set_my_push_token re-assigns it at the next login).
    if (myPushToken) {
      const token = myPushToken;
      myPushToken = null;
      const { error } = await supabase.rpc('clear_my_push_token', { p_token: token });
      if (error) console.warn('clear_my_push_token failed (non-fatal):', error.message);
    }
    await supabase.auth.signOut();
    // The persisted queue stays on disk under this user's key and resumes on
    // their next login; only the in-memory copy is cleared. The offline
    // snapshot is deleted — it holds this user's data on a possibly shared phone.
    set(SIGNED_OUT_STATE);
    void setLastUser(null);
    if (userId) void deleteSnapshot(userId);
  },

  addUser: async ({ name, username, password, role, teamId, city, phone }) => {
    const uname = username.trim().toLowerCase();
    if (!name.trim()) return 'Nama wajib diisi.';
    if (!uname) return 'Username wajib diisi.';
    if (get().users.some((u) => u.username.toLowerCase() === uname)) return 'Username sudah dipakai.';
    const pwErr = passwordProblem(password, uname);
    if (pwErr) return pwErr;
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
      const pwErr = passwordProblem(r.password, uname);
      if (pwErr) {
        errors.push(`Baris ${i + 1}: ${pwErr}`);
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
    const pwErr = passwordProblem(password, get().users.find((u) => u.id === id)?.username);
    if (pwErr) return pwErr;
    const { error } = await callAdminUsers({ action: 'setPassword', userId: id, password });
    return error ?? null;
  },

  changeOwnPassword: async (current, next) => {
    const me = get().users.find((u) => u.id === get().sessionUserId);
    if (!me) return 'Sesi tidak ditemukan. Silakan login ulang.';
    const pwErr = passwordProblem(next, me.username);
    if (pwErr) return pwErr;
    if (next === current) return 'Password baru harus berbeda dari password lama.';
    // Re-verify the current password: an unlocked phone left unattended must
    // not be enough to take over the account.
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: `${me.username.toLowerCase()}@internal.spc`,
      password: current,
    });
    if (verifyErr) return 'Password lama salah.';
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) return 'Gagal mengubah password. Periksa koneksi internet dan coba lagi.';
    return null;
  },

  addTeam: async (p) => {
    const t: Team = { id: uid('t_'), ...p, name: p.name.trim() || p.city.trim(), city: p.city.trim() };
    set({ teams: [...get().teams, t] });
    const { error } = await supabase.from('teams').insert({ id: t.id, ...teamRow(t) });
    if (error) {
      set({ teams: get().teams.filter((x) => x.id !== t.id) });
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan tim baru. Periksa koneksi internet dan coba lagi.');
      return;
    }
    await syncTeamLeader(set, get, t.id, t.tlId, null);
  },

  updateTeam: async (id, p) => {
    const before = get().teams.find((t) => t.id === id);
    if (!before) return 'Tim tidak ditemukan.';
    const tlId = p.tlId;
    const next: Team = { ...before, ...p, name: p.name.trim() || p.city.trim(), city: p.city.trim() };
    const { error } = await supabase.from('teams').update(teamRow(next)).eq('id', id);
    if (error) {
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan perubahan tim. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    set({ teams: get().teams.map((t) => (t.id === id ? next : t)) });
    if (before.tlId !== tlId) await syncTeamLeader(set, get, id, tlId, before.tlId);
    return null;
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
    const before = get().stores.filter((m) => ids.includes(m.id));
    set({
      stores: get().stores.map((m) =>
        ids.includes(m.id) ? { ...m, assignedNcId: ncId, teamId: ncId ? teamId! : m.teamId } : m,
      ),
    });
    const patch: Record<string, unknown> = { assigned_nc_id: ncId };
    if (ncId) patch.team_id = teamId;
    const { error } = await supabase.from('stores').update(patch).in('id', ids);
    if (error) {
      restoreRows(set, get, 'stores', ids, before);
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
      geoValid: geoValid && !pos.mocked,
      locationMocked: !!pos.mocked,
    };
    set({ visits: [v, ...get().visits] });
    await runOrQueue(set, get, { id: uid('op_'), type: 'startVisit', visit: v }, 'Check-in toko', () =>
      set({ visits: get().visits.filter((x) => x.id !== v.id) }),
    );
    return v.id;
  },

  finishVisit: async (id) => {
    const v = get().visits.find((x) => x.id === id);
    if (!v) return;
    const checkOutAt = Date.now();
    set({ visits: get().visits.map((x) => (x.id === id ? { ...x, checkOutAt } : x)) });
    await runOrQueue(set, get, { id: uid('op_'), type: 'finishVisit', visitId: id, checkOutAt }, 'Check-out toko', () =>
      set({ visits: get().visits.map((x) => (x.id === id ? { ...x, checkOutAt: v.checkOutAt } : x)) }),
    );
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
      restoreRows(set, get, 'products', [p.id], list);
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
    assertVisitOpen(get, visitId);
    assertNewSkus(get().stockTakingRows, visitId, clean.map((r) => r.sku));

    const now = Date.now();
    const { localPhotoUri, photoUrl } = await prepareOptionalPhoto(visitId, photoUri);
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
    const ids = new Set(newRows.map((r) => r.id));
    // A pending local photo is shown from its file until replay swaps in the remote path.
    const display = localPhotoUri ? newRows.map((r) => ({ ...r, photoUrl: localPhotoUri })) : newRows;
    set({ stockTakingRows: [...display, ...get().stockTakingRows] });
    return runOrQueue(set, get, { id: uid('op_'), type: 'submitStockTaking', rows: newRows, localPhotoUri }, 'Stock Taking', () => {
      set({ stockTakingRows: get().stockTakingRows.filter((x) => !ids.has(x.id)) });
      if (localPhotoUri) void discardLocalPhoto(localPhotoUri);
    });
  },

  submitOfftake: async (visitId, storeId, rows) => {
    const clean = rows
      .map((r) => ({ sku: r.sku.trim(), unitsSold: r.unitsSold, revenue: r.revenue }))
      .filter((r) => r.sku && r.unitsSold >= 0);
    if (!clean.length) throw new Error('Isi minimal satu SKU dengan unit terjual valid (>= 0).');
    assertVisitOpen(get, visitId);
    assertNewSkus(get().offtakeRows, visitId, clean.map((r) => r.sku));

    const now = Date.now();
    const newRows: OfftakeRow[] = clean.map((r) => ({
      id: uid('otk_'),
      visitId,
      storeId,
      sku: r.sku,
      unitsSold: r.unitsSold,
      revenue: r.revenue,
      isOutlier: false, // server trigger (0003 migration) sets the real value on insert — replayOp reads it back
      createdAt: now,
    }));
    const ids = new Set(newRows.map((r) => r.id));
    set({ offtakeRows: [...newRows, ...get().offtakeRows] });

    const { queued } = await runOrQueue(set, get, { id: uid('op_'), type: 'submitOfftake', rows: newRows }, 'Offtake', () =>
      set({ offtakeRows: get().offtakeRows.filter((x) => !ids.has(x.id)) }),
    );
    // Queued rows get their outlier flag when they sync (the trigger runs server-side).
    const outlierSkus = queued ? [] : get().offtakeRows.filter((x) => ids.has(x.id) && x.isOutlier).map((x) => x.sku);
    return { queued, outlierSkus };
  },

  // --- Phase 2: NTG & GWP consumer funnel (PRD §5.4) -----------------------
  // Online-required, like upsertStore — richer/less frequent than clock/check
  // writes, so not worth extending the offline queue to (see PRD review note).

  upsertConsumer: async (c) => {
    const before = get().consumers.find((x) => x.id === c.id);
    const problem = consumerProblem(get, c);
    if (problem) return problem;
    set({ consumers: upsertById(get().consumers, c) });
    const fields = {
      name: c.name,
      wa_contact: c.waContact,
      consent: c.consent,
      // Recorded by the server only when consent is newly given (0015).
      consent_version: c.consent ? CONSENT_VERSION : null,
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
      showDialog('Gagal Menyimpan', serverRuleMessage(error) ?? 'Tidak dapat menyimpan data konsumen ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  addNtgGwp: async (n) => {
    const problem = ntgStepProblem(get, n, get().consumers.find((c) => c.id === n.consumerId)?.childAgeBracket);
    if (problem) return problem;
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
      showDialog('Gagal Menyimpan', serverRuleMessage(error) ?? 'Tidak dapat menyimpan data NTG & GWP ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    raiseConsumerStage(set, get, n);
    return null;
  },

  saveConsumerWithStep: async (c, step) => {
    const before = get().consumers.find((x) => x.id === c.id);
    const problem = consumerProblem(get, c) ?? (step ? ntgStepProblem(get, step, c.childAgeBracket) : null);
    if (problem) return problem;

    // current_stage is server-owned (0019) — keep what's known rather than what the form passed.
    const row = { ...c, currentStage: before?.currentStage, currentStageAt: before?.currentStageAt };
    set({ consumers: upsertById(get().consumers, row), ...(step ? { ntgGwps: [step, ...get().ntgGwps] } : {}) });
    const { error } = await supabase.rpc('save_consumer_with_step', {
      p_consumer: {
        id: c.id,
        name: c.name,
        wa_contact: c.waContact,
        consent: c.consent,
        consent_version: c.consent ? CONSENT_VERSION : null,
        child_age_bracket: c.childAgeBracket,
        current_brand: c.currentBrand ?? null,
        quiz_result: c.quizResult ?? null,
        created_at: new Date(c.createdAt).toISOString(),
      },
      p_is_new: !before,
      p_step: step
        ? {
            id: step.id,
            visit_id: step.visitId,
            stage: step.stage,
            gwp_item: step.gwpItem ?? null,
            gwp_qty: step.gwpQty ?? null,
            offtake_id: step.offtakeId ?? null,
            created_at: new Date(step.createdAt).toISOString(),
          }
        : null,
    });
    if (error?.code === 'PGRST202') {
      // Migration 0017 not applied yet: the previous two-step save.
      set({
        consumers: before ? get().consumers.map((x) => (x.id === c.id ? before : x)) : get().consumers.filter((x) => x.id !== c.id),
        ntgGwps: step ? get().ntgGwps.filter((x) => x.id !== step.id) : get().ntgGwps,
      });
      return (await get().upsertConsumer(c)) ?? (step ? get().addNtgGwp(step) : null);
    }
    if (error) {
      set({
        consumers: before ? get().consumers.map((x) => (x.id === c.id ? before : x)) : get().consumers.filter((x) => x.id !== c.id),
        ntgGwps: step ? get().ntgGwps.filter((x) => x.id !== step.id) : get().ntgGwps,
      });
      showDialog('Gagal Menyimpan', serverRuleMessage(error) ?? 'Tidak dapat menyimpan data konsumen. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    if (step) raiseConsumerStage(set, get, step);
    return null;
  },

  addSchedules: async (ncId, plans) => {
    const dayKey = (ts: number) => programDayKey(ts);
    const existing = new Set(get().schedules.filter((x) => x.ncId === ncId).map((x) => `${x.storeId}|${dayKey(x.plannedDate)}`));
    const rows: Schedule[] = [];
    for (const p of plans) {
      const key = `${p.storeId}|${dayKey(p.plannedDate)}`;
      if (existing.has(key)) continue;
      existing.add(key);
      rows.push({ id: uid('pjp_'), ncId, storeId: p.storeId, plannedDate: programDayStart(p.plannedDate) });
    }
    if (!rows.length) return null;
    const ids = rows.map((r) => r.id);
    set({ schedules: [...rows, ...get().schedules] });
    const { error } = await supabase.from('schedules').insert(rows.map(scheduleRow));
    if (error) {
      restoreRows(set, get, 'schedules', ids, []);
      showDialog(
        'Gagal Menyimpan Jadwal',
        error.code === '23505'
          ? 'Sebagian toko sudah dijadwalkan di hari itu (mungkin oleh pengguna lain). Tarik untuk memuat ulang lalu coba lagi.'
          : error.code === '42501'
            ? 'Anda tidak bisa mengatur jadwal NC ini (di luar tim Anda).'
            : 'Tidak dapat menyimpan jadwal. Periksa koneksi internet dan coba lagi.',
      );
      return error.message;
    }
    return null;
  },

  deleteSchedule: async (id) => {
    const before = get().schedules.filter((x) => x.id === id);
    set({ schedules: get().schedules.filter((x) => x.id !== id) });
    // .select() so an RLS-refused delete (no error, 0 rows) isn't mistaken for success.
    const { data, error } = await supabase.from('schedules').delete().eq('id', id).select('id');
    if (error || !data?.length) {
      restoreRows(set, get, 'schedules', [id], before);
      showDialog('Gagal Menghapus Jadwal', 'Tidak dapat menghapus jadwal ini. Periksa koneksi internet dan coba lagi.');
      return error?.message ?? 'not permitted';
    }
    return null;
  },

  fetchConsumerHistory: async (consumerId) => {
    const { data, error } = await supabase.from('ntg_gwp').select('*').eq('consumer_id', consumerId).limit(500);
    if (error) return error.message;
    const known = new Set(get().ntgGwps.map((g) => g.id));
    const older = (data ?? []).map(mapNtgGwp).filter((g) => !known.has(g.id));
    if (older.length) set({ ntgGwps: [...get().ntgGwps, ...older] });
    return null;
  },

  eraseConsumer: async (id) => {
    const { error } = await supabase.rpc('erase_consumer', { p_consumer_id: id });
    if (error) {
      showDialog('Gagal Menghapus', serverRuleMessage(error) ?? 'Tidak dapat menghapus data konsumen. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    const now = Date.now();
    set({
      consumers: get().consumers.map((c) =>
        c.id === id
          ? { ...c, name: '(data dihapus)', waContact: '', currentBrand: undefined, quizResult: undefined, childAgeBracket: '', consent: false, erasedAt: now }
          : c,
      ),
      surveyResponses: get().surveyResponses.map((r) => (r.consumerId === id ? { ...r, answers: {} } : r)),
    });
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
    assertVisitOpen(get, visitId);
    if (get().shareOfShelfRows.some((r) => r.visitId === visitId && r.category === input.category)) {
      throw new Error(`Share of Shelf kategori ${input.category} sudah dilaporkan di kunjungan ini.`);
    }
    const row: Omit<ShareOfShelfRow, 'photoUrl'> = {
      id: uid('sos_'),
      visitId,
      storeId,
      channel: input.channel,
      category: input.category,
      ownFacingCount: input.ownFacingCount,
      totalFacingCount: input.totalFacingCount,
      createdAt: Date.now(),
    };
    return submitRequiredPhotoReport(set, get, {
      stateKey: 'shareOfShelfRows',
      table: 'share_of_shelf',
      toDbRow: shareOfShelfRow,
      row,
      photoUri,
      label: 'Share of Shelf',
      makeOp: (localPhotoUri) => ({ id: uid('op_'), type: 'submitShareOfShelf', row, localPhotoUri }),
    });
  },

  submitPaidVisibility: async (visitId, storeId, input, photoUri) => {
    if (!input.visibilityType) throw new Error('Pilih jenis visibility.');
    assertVisitOpen(get, visitId);
    if (get().paidVisibilityRows.some((r) => r.visitId === visitId && r.visibilityType === input.visibilityType)) {
      throw new Error('Paid Visibility jenis ini sudah dilaporkan di kunjungan ini.');
    }
    const row: Omit<PaidVisibilityRow, 'photoUrl'> = {
      id: uid('pv_'),
      visitId,
      storeId,
      visibilityType: input.visibilityType,
      complianceChecklist: input.complianceChecklist,
      createdAt: Date.now(),
    };
    return submitRequiredPhotoReport(set, get, {
      stateKey: 'paidVisibilityRows',
      table: 'paid_visibility',
      toDbRow: paidVisibilityRow,
      row,
      photoUri,
      label: 'Paid Visibility',
      makeOp: (localPhotoUri) => ({ id: uid('op_'), type: 'submitPaidVisibility', row, localPhotoUri }),
    });
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
    assertVisitOpen(get, visitId);
    assertNewSkus(get().priceMonitoringRows, visitId, clean.map((r) => r.sku));

    const now = Date.now();
    const { localPhotoUri, photoUrl } = await prepareOptionalPhoto(visitId, photoUri);
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
    const ids = new Set(newRows.map((r) => r.id));
    const display = localPhotoUri ? newRows.map((r) => ({ ...r, photoUrl: localPhotoUri })) : newRows;
    set({ priceMonitoringRows: [...display, ...get().priceMonitoringRows] });
    return runOrQueue(
      set,
      get,
      { id: uid('op_'), type: 'submitPriceMonitoring', rows: newRows, localPhotoUri },
      'Price Monitoring',
      () => {
        set({ priceMonitoringRows: get().priceMonitoringRows.filter((x) => !ids.has(x.id)) });
        if (localPhotoUri) void discardLocalPhoto(localPhotoUri);
      },
    );
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
      restoreRows(set, get, 'surveys', [s.id], list);
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan survey ke server. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    return null;
  },

  submitSurveyResponse: async (r) => {
    if (visitPendingSync(get, r.visitId)) {
      showVisitPendingDialog();
      return 'visit not synced yet';
    }
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

  reviewReport: (reportType, reportId, status, note) => get().reviewReports([{ reportType, reportId }], status, note),

  reviewReports: async (refs, status, note) => {
    const me = get().users.find((u) => u.id === get().sessionUserId);
    if (!me) return 'Sesi tidak ditemukan.';
    if (!refs.length) return null;
    const now = Date.now();
    const rows: ReportReview[] = refs.map(({ reportType, reportId }) => ({
      id: get().reportReviews.find((r) => r.reportType === reportType && r.reportId === reportId)?.id ?? uid('rr_'),
      reportType,
      reportId,
      status,
      reviewedBy: me.id,
      reviewedAt: now,
      note: note?.trim() || undefined,
    }));
    const before = get().reportReviews;
    let next = before;
    for (const r of rows) next = upsertById(next, r);
    set({ reportReviews: next });
    // onConflict on the natural key: a review made earlier but outside the
    // loaded history window isn't known locally — update it, don't collide.
    const { error } = await supabase.from('report_reviews').upsert(
      rows.map((r) => ({
        id: r.id,
        report_type: r.reportType,
        report_id: r.reportId,
        status: r.status,
        reviewed_by: r.reviewedBy,
        reviewed_at: new Date(r.reviewedAt!).toISOString(),
        note: r.note ?? null,
      })),
      { onConflict: 'report_type,report_id' },
    );
    if (error) {
      restoreRows(set, get, 'reportReviews', rows.map((r) => r.id), before);
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
      restoreRows(set, get, 'coachingLogs', [log.id], list);
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
      restoreRows(set, get, 'targets', [t.id], list);
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
      restoreRows(set, get, 'targets', [...rows.map((r) => r.id), ...deleteIds], before);
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

  addCertifications: async (rows) => {
    if (!rows.length) return null;
    const { error } = await supabase.from('certifications').insert(
      rows.map((c) => ({
        id: c.id,
        user_id: c.userId,
        cert_type: c.certType,
        date: new Date(c.date).toISOString(),
        passed: c.passed,
      })),
    );
    if (error) {
      showDialog('Gagal Menyimpan', 'Tidak dapat menyimpan hasil sertifikasi. Periksa koneksi internet dan coba lagi.');
      return error.message;
    }
    set({ certifications: [...rows, ...get().certifications] });
    return null;
  },

  deleteCertification: async (id) => {
    // .select() so an RLS-refused delete (no error, 0 rows) isn't mistaken for success.
    const { data, error } = await supabase.from('certifications').delete().eq('id', id).select('id');
    if (error || !data?.length) {
      showDialog('Gagal Menghapus', 'Tidak dapat menghapus hasil sertifikasi. Periksa koneksi internet dan coba lagi.');
      return error?.message ?? 'not permitted';
    }
    set({ certifications: get().certifications.filter((c) => c.id !== id) });
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
    // Paged: one row per subject per month grows past PostgREST's 1000-row cap
    // within months, and a plain select would truncate silently.
    const { data, error: fetchErr } = await fetchAll('scorecards');
    if (fetchErr) console.warn('computeScorecards: refetch failed:', fetchErr.message);
    else set({ scorecards: data.map(mapScorecard) });
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

    // The counterpart may have started this conversation while our realtime
    // socket was asleep — check the server before creating one, or the chat
    // splits into two threads (each side seeing only its own messages).
    const { data: remote } = await supabase
      .from('conversations')
      .select('*')
      .eq('type', type)
      .or(`and(participant_a.eq.${me},participant_b.eq.${otherUserId}),and(participant_a.eq.${otherUserId},participant_b.eq.${me})`)
      .order('created_at', { ascending: true })
      .limit(1);
    if (remote?.length) {
      const found = mapConversation(remote[0]);
      set({ conversations: upsertById(get().conversations, found) });
      void get().refreshChat();
      return found.id;
    }

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

  refreshData: async () => {
    if (!get().sessionUserId) return null;
    if (resumeUserId) {
      // Opened from the offline snapshot: a refresh means "try the full sync now".
      await resumeSession(set, get);
      return resumeUserId ? 'Masih offline.' : null;
    }
    const role = get().users.find((u) => u.id === get().sessionUserId)?.role;
    const { rows, error } = await fetchSnapshot(historyWindow(role), role);
    if (error) return error.message; // partial data would drop rows from the merge below — keep what we have
    const windowed = new Set(WINDOWED_TABLES.map((w) => w.table));
    const patch: Partial<StoreState> = {};
    for (const t of SNAPSHOT_TABLES) {
      const server = rows[t.table].map(t.map) as Array<{ id: string }>;
      if (!windowed.has(t.table)) {
        // Small, fully-loaded tables: server is the whole truth, so deletions
        // and deactivations apply. Their writes are online-only, never queued.
        (patch as any)[t.key] = server;
        continue;
      }
      // Field activity: server rows win; local-only rows are kept — they are
      // either older history (loadFullHistory) or offline ops still queued.
      const local = get()[t.key] as unknown as Array<{ id: string }>;
      const ids = new Set(server.map((r) => r.id));
      (patch as any)[t.key] = [...server, ...local.filter((r) => !ids.has(r.id))];
    }
    // Keep the locally-held GPS route on each attendance (refreshData doesn't refetch route_points).
    const routes = new Map(get().attendances.map((a) => [a.id, a.route]));
    patch.attendances = (patch.attendances ?? []).map((a) => ({ ...a, route: routes.get(a.id) ?? a.route }));
    patch.users = await withContacts(patch.users ?? []);
    set(patch);
    lastRefreshAt = Date.now();
    return null;
  },

  fetchLivePositions: async () => {
    const { data, error } = await supabase.rpc('live_positions');
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      userId: r.user_id,
      attendanceId: r.attendance_id,
      lat: r.lat,
      lng: r.lng,
      at: new Date(r.recorded_at).getTime(),
      clockInAt: new Date(r.clock_in_at).getTime(),
    }));
  },

  fetchRoute: async (attendanceId) => {
    const out: RoutePoint[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('route_points')
        .select('lat, lng, recorded_at')
        .eq('attendance_id', attendanceId)
        .order('recorded_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []).map((p: any) => ({ lat: p.lat, lng: p.lng, t: new Date(p.recorded_at).getTime() })));
      if (!data || data.length < PAGE_SIZE) return out;
    }
  },

  fetchManagementSummary: async (range, storeIds) => {
    const { data, error } = await supabase.rpc('management_summary', {
      p_from: new Date(range.from).toISOString(),
      p_to: new Date(range.to).toISOString(),
      p_store_ids: storeIds,
    });
    if (error) throw new Error(error.message);
    const d = data as any;
    const n = (v: unknown) => Number(v ?? 0);
    return {
      ownFacing: n(d.own_facing),
      totalFacing: n(d.total_facing),
      offtakeUnits: n(d.offtake_units),
      gwpGivenQty: n(d.gwp_given_qty),
      ntgConsumers: n(d.ntg_consumers),
      daily: (d.daily ?? []).map((x: any) => ({ day: String(x.day), own: n(x.own), total: n(x.total), units: n(x.units) })),
      channels: (d.channels ?? []).map((x: any) => ({ channel: x.channel ?? '', category: x.category, own: n(x.own), total: n(x.total) })),
    };
  },

  fetchAuditLog: async (limit, before) => {
    let q = supabase.from('admin_audit_log').select('*').order('at', { ascending: false }).limit(limit);
    if (before != null) q = q.lt('at', new Date(before).toISOString());
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      at: new Date(r.at).getTime(),
      actorId: r.actor_id ?? null,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id ?? null,
      details: r.details ?? {},
    }));
  },

  refreshChat: async () => {
    // Messages use the field-activity window (or everything once full history is loaded).
    const since = get().historyFrom == null ? 0 : historyWindowStart(new Date(), HISTORY_DAYS);
    const [convos, msgs] = await Promise.all([
      fetchAll('conversations'),
      fetchAll('messages', windowFilter('messages', { since, reportsSince: since })),
    ]);
    if (convos.error || msgs.error) {
      console.warn('refreshChat failed (non-fatal):', (convos.error ?? msgs.error)!.message);
      return;
    }
    // Server rows win (e.g. read_at set on another device); local-only rows
    // (a message mid-send) are kept.
    const merge = <T extends { id: string }>(local: T[], server: T[]) => {
      const ids = new Set(server.map((r) => r.id));
      return [...server, ...local.filter((r) => !ids.has(r.id))];
    };
    set({
      conversations: merge(get().conversations, convos.data.map(mapConversation)),
      messages: merge(get().messages, msgs.data.map(mapMessage)),
    });
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

  clockIn: async (pos) => {
    const userId = get().sessionUserId!;
    const t = Date.now();
    const me = get().users.find((u) => u.id === userId);
    const team = get().teams.find((x) => x.id === me?.teamId);
    const a: Attendance = {
      id: uid('a_'),
      userId,
      clockInAt: t,
      clockInLat: pos.lat,
      clockInLng: pos.lng,
      clockOutAt: null,
      route: [{ lat: pos.lat, lng: pos.lng, t }],
      // Shown until the server's own computation (same rule, 0014) comes back.
      geoFenceOk: clockInGeoFenceOk(team, pos, !!pos.mocked),
      locationMocked: !!pos.mocked,
    };
    set({ attendances: [a, ...get().attendances] });
    // A rejected insert means the user isn't clocked in server-side, so the
    // local cache must not claim otherwise.
    const { queued } = await runOrQueue(set, get, { id: uid('op_'), type: 'clockIn', attendance: a }, 'Clock-in', () =>
      set({ attendances: get().attendances.filter((x) => x.id !== a.id) }),
    );
    return queued;
  },

  clockOut: async (pos) => {
    const userId = get().sessionUserId!;
    const a = get().attendances.find((x) => x.userId === userId && !x.clockOutAt);
    if (!a) return false;
    const t = Date.now();
    const addPoint =
      haversineM(a.route[a.route.length - 1] ?? { lat: a.clockInLat, lng: a.clockInLng }, pos) > TRACK_MIN_STEP_M;
    set({
      attendances: get().attendances.map((x) =>
        x.id === a.id
          ? {
              ...x,
              clockOutAt: t,
              clockOutLat: pos.lat,
              clockOutLng: pos.lng,
              route: addPoint ? [...x.route, { ...pos, t }] : x.route,
            }
          : x,
      ),
    });
    const { queued } = await runOrQueue(
      set,
      get,
      { id: uid('op_'), type: 'clockOut', attendanceId: a.id, clockOutAt: t, lat: pos.lat, lng: pos.lng, addPoint },
      'Clock-out',
      () => set({ attendances: get().attendances.map((x) => (x.id === a.id ? a : x)) }),
    );
    return queued;
  },
}));

// Points recorded by the location task while the app is running show up on
// the open attendance right away (headless, there is no session in the store).
onPointsRecorded((userId, points) => {
  if (useStore.getState().sessionUserId !== userId) return;
  applyRoutePoints(useStore.setState, useStore.getState, points);
});

// Keep the offline snapshot current: debounced save whenever a cached slice
// changes (a clock-in made after the last full sync must survive a cold start
// without signal, or the NC would be shown as not clocked in).
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
const SNAPSHOT_SAVE_DEBOUNCE_MS = 2000;

useStore.subscribe((state, prev) => {
  if (!state.sessionUserId) {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = null;
    return;
  }
  if (state.sessionUserId !== prev.sessionUserId && state.offlineSnapshotAt) return; // just loaded from it
  if (!SNAPSHOT_KEYS.some((k) => state[k] !== prev[k])) return;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    const s = useStore.getState();
    if (s.sessionUserId) void saveSnapshot(s.sessionUserId, buildOfflineSnapshot(s, s.sessionUserId));
  }, SNAPSHOT_SAVE_DEBOUNCE_MS);
});

export function useCurrentUser(): User | null {
  return useStore((s) =>
    s.sessionUserId ? (s.users.find((u) => u.id === s.sessionUserId) ?? null) : null,
  );
}
