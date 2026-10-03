import { DEFAULT_TEAM_BASE_RADIUS_M } from '../config';
import type {
  Attendance,
  Certification,
  CoachingLog,
  Consumer,
  Conversation,
  ConversationType,
  Message,
  NtgGwp,
  NtgGwpStage,
  OfftakeRow,
  PaidVisibilityRow,
  PriceMonitoringRow,
  Product,
  ReportReview,
  ReportReviewStatus,
  ReportType,
  Role,
  RoutePoint,
  Schedule,
  Scorecard,
  ScorecardStatus,
  ShareOfShelfRow,
  StockTakingRow,
  Store,
  StoreCategory,
  Survey,
  SurveyQuestion,
  SurveyResponse,
  Target,
  Team,
  User,
  Visit,
} from '../types';
import type { Tables as DbRow } from '../lib/database.types';

/**
 * Supabase row <-> app type mapping, in both directions: `map*` turn a
 * PostgREST/realtime row (snake_case, ISO strings) into the app's type;
 * rows are typed from the generated schema (src/lib/database.types.ts —
 * `npm run gen:types`). Enum-like columns are text + check constraints in
 * the DB, so they come back as `string` and are narrowed here;
 * `*Row` build the column object written back. Pure — no React Native /
 * Supabase imports — so it's unit-testable (mappers.test.ts).
 */

export const optTime = (v: string | null | undefined) => (v ? new Date(v).getTime() : undefined);

export function upsertById<T extends { id: string | number }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  return i === -1 ? [row, ...list] : list.map((x, idx) => (idx === i ? row : x));
}

// --- Supabase row <-> app type mapping -------------------------------------

export function mapProfile(p: DbRow<'profiles'>): User {
  return {
    id: p.id,
    name: p.name,
    username: p.username,
    role: p.role as Role,
    teamId: p.team_id,
    city: p.city ?? undefined,
    phone: p.phone ?? undefined,
    active: p.active,
    createdAt: new Date(p.created_at).getTime(),
  };
}

export function mapTeam(t: DbRow<'teams'>): Team {
  return {
    id: t.id,
    name: t.name,
    city: t.city,
    tlId: t.tl_id,
    arcoId: t.arco_id,
    baseLat: t.base_lat ?? null,
    baseLng: t.base_lng ?? null,
    baseRadiusM: t.base_radius_m ?? DEFAULT_TEAM_BASE_RADIUS_M,
  };
}

export function mapStore(m: DbRow<'stores'>): Store {
  return {
    id: m.id,
    name: m.name,
    address: m.address,
    city: m.city,
    channel: m.channel,
    account: m.account ?? undefined,
    category: m.category as StoreCategory,
    lat: m.lat,
    lng: m.lng,
    assignedNcId: m.assigned_nc_id,
    teamId: m.team_id,
    source: m.source as Store['source'],
    createdAt: new Date(m.created_at).getTime(),
  };
}

export function mapVisit(v: DbRow<'visits'>): Visit {
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
    locationMocked: v.location_mocked ?? false,
    autoClosed: v.auto_closed ?? false,
  };
}

export function mapAttendance(a: DbRow<'attendances'>, route: RoutePoint[]): Attendance {
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
    locationMocked: a.location_mocked ?? false,
    autoClosed: a.auto_closed ?? false,
    nonMarketMs: a.non_market_ms ?? undefined,
  };
}

export function mapProduct(p: DbRow<'products'>): Product {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category ?? undefined,
    active: p.active,
    createdAt: new Date(p.created_at).getTime(),
  };
}

export function mapStockTaking(r: DbRow<'stock_taking'>): StockTakingRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    sku: r.sku,
    qtyOnHand: r.qty_on_hand,
    outOfStock: r.out_of_stock,
    photoUrl: r.photo_url ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
    receivedAt: optTime(r.received_at),
  };
}

export function mapOfftake(r: DbRow<'offtake'>): OfftakeRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    sku: r.sku,
    unitsSold: r.units_sold,
    revenue: r.revenue ?? undefined,
    isOutlier: r.is_outlier,
    createdAt: new Date(r.created_at).getTime(),
    receivedAt: optTime(r.received_at),
  };
}

export function mapConsumer(c: DbRow<'consumers'>): Consumer {
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
    consentAt: optTime(c.consent_at),
    consentVersion: c.consent_version ?? undefined,
    erasedAt: optTime(c.erased_at),
    currentStage: (c.current_stage as NtgGwpStage | null) ?? undefined,
    currentStageAt: optTime(c.current_stage_at),
  };
}

export function mapNtgGwp(g: DbRow<'ntg_gwp'>): NtgGwp {
  return {
    id: g.id,
    consumerId: g.consumer_id,
    visitId: g.visit_id,
    stage: g.stage as NtgGwpStage,
    gwpItem: g.gwp_item ?? undefined,
    gwpQty: g.gwp_qty ?? undefined,
    offtakeId: g.offtake_id ?? undefined,
    createdAt: new Date(g.created_at).getTime(),
    receivedAt: optTime(g.received_at),
  };
}

export function mapShareOfShelf(r: DbRow<'share_of_shelf'>): ShareOfShelfRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    channel: r.channel,
    category: r.category as StoreCategory,
    ownFacingCount: r.own_facing_count,
    totalFacingCount: r.total_facing_count,
    photoUrl: r.photo_url,
    createdAt: new Date(r.created_at).getTime(),
    receivedAt: optTime(r.received_at),
  };
}

export function mapPaidVisibility(r: DbRow<'paid_visibility'>): PaidVisibilityRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    visibilityType: r.visibility_type,
    complianceChecklist: (r.compliance_checklist ?? {}) as Record<string, boolean>,
    photoUrl: r.photo_url,
    createdAt: new Date(r.created_at).getTime(),
    receivedAt: optTime(r.received_at),
  };
}

export function mapPriceMonitoring(r: DbRow<'price_monitoring'>): PriceMonitoringRow {
  return {
    id: r.id,
    visitId: r.visit_id,
    storeId: r.store_id,
    sku: r.sku,
    ownPrice: r.own_price,
    competitorPrices: r.competitor_prices ?? [],
    photoUrl: r.photo_url ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
    receivedAt: optTime(r.received_at),
  };
}

export function mapSurvey(s: DbRow<'surveys'>): Survey {
  return {
    id: s.id,
    title: s.title,
    questions: (s.questions ?? []) as unknown as SurveyQuestion[],
    campaignTag: s.campaign_tag ?? undefined,
    createdBy: s.created_by,
    createdAt: new Date(s.created_at).getTime(),
  };
}

export function mapSurveyResponse(r: DbRow<'survey_responses'>): SurveyResponse {
  return {
    id: r.id,
    surveyId: r.survey_id,
    visitId: r.visit_id ?? null,
    consumerId: r.consumer_id ?? null,
    answers: (r.answers ?? {}) as Record<string, string>,
    createdAt: new Date(r.created_at).getTime(),
  };
}

export function mapTarget(t: DbRow<'targets'>): Target {
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

export function mapReportReview(r: DbRow<'report_reviews'>): ReportReview {
  return {
    id: r.id,
    reportType: r.report_type as ReportType,
    reportId: r.report_id,
    status: r.status as ReportReviewStatus,
    reviewedBy: r.reviewed_by ?? undefined,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).getTime() : undefined,
    note: r.note ?? undefined,
  };
}

export function mapCoachingLog(l: DbRow<'coaching_logs'>): CoachingLog {
  return {
    id: l.id,
    tlId: l.tl_id,
    ncId: l.nc_id,
    date: new Date(l.date).getTime(),
    note: l.note,
    createdAt: new Date(l.created_at).getTime(),
  };
}

export function mapScorecard(s: DbRow<'scorecards'>): Scorecard {
  return {
    id: s.id,
    subjectId: s.subject_id,
    role: s.role as Role,
    periodKey: s.period_key,
    score: s.score,
    status: s.status as ScorecardStatus,
    breakdown: (s.breakdown ?? {}) as Record<string, number>,
    computedAt: new Date(s.computed_at).getTime(),
  };
}

export function mapSchedule(s: DbRow<'schedules'>): Schedule {
  return {
    id: s.id,
    ncId: s.nc_id,
    storeId: s.store_id,
    plannedDate: new Date(s.planned_date).getTime(),
    actualVisitId: s.actual_visit_id ?? undefined,
  };
}

/** actual_visit_id is server-owned (schedules_server_checks, 0020) — never written. */
export function scheduleRow(s: Schedule) {
  return {
    id: s.id,
    nc_id: s.ncId,
    store_id: s.storeId,
    planned_date: new Date(s.plannedDate).toISOString(),
  };
}

export function mapCertification(c: DbRow<'certifications'>): Certification {
  return {
    id: c.id,
    userId: c.user_id,
    certType: c.cert_type,
    date: new Date(c.date).getTime(),
    passed: c.passed,
  };
}

export function mapConversation(c: DbRow<'conversations'>): Conversation {
  return {
    id: c.id,
    type: c.type as ConversationType,
    participantA: c.participant_a,
    participantB: c.participant_b,
    createdAt: new Date(c.created_at).getTime(),
  };
}

export function mapMessage(m: DbRow<'messages'>): Message {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: new Date(m.created_at).getTime(),
    readAt: m.read_at ? new Date(m.read_at).getTime() : null,
  };
}

export function targetRow(t: Target) {
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
export function storeRow(m: Store) {
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

export function teamRow(t: Team) {
  return {
    name: t.name,
    city: t.city,
    tl_id: t.tlId,
    arco_id: t.arcoId,
    base_lat: t.baseLat,
    base_lng: t.baseLng,
    base_radius_m: t.baseRadiusM,
  };
}

export function visitRow(v: Visit) {
  return {
    lat: v.lat,
    lng: v.lng,
    // Recomputed server-side (visits_server_checks, 0014) — sent only for older backends.
    store_distance_m: v.storeDistanceM,
    geo_valid: v.geoValid,
    location_mocked: v.locationMocked ?? false,
  };
}

export function stockTakingRow(r: StockTakingRow) {
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
export function offtakeRow(r: OfftakeRow) {
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

export function shareOfShelfRow(r: ShareOfShelfRow) {
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

export function paidVisibilityRow(r: PaidVisibilityRow) {
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

export function priceMonitoringRow(r: PriceMonitoringRow) {
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
