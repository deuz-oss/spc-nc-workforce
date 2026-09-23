// Domain model — SPC NC Workforce. See PRD §12 (data model) plus the two
// entities added during PRD review (`certifications`, `schedules`) and the
// in-app messaging entities added for §17. Full schema lives in
// supabase/migrations/0001_init.sql; this file is the TypeScript mirror the
// app code works against.

export type Role =
  | 'super_admin'
  | 'reckitt_client' // read-only, program-wide — PRD §11
  | 'pm'
  | 'arco'
  | 'tl'
  | 'nc'
  | 'lead_trainer'
  | 'trainer'
  | 'data_analyst'
  | 'admin_data_entry';

export interface User {
  id: string;
  name: string;
  username: string;
  role: Role;
  teamId: string | null;
  city?: string;
  phone?: string;
  active: boolean;
  createdAt: number;
}

/** A TL's team of NCs. ARCO scopes to multiple teams (via Team.arcoId), not multiple TLs. */
export interface Team {
  id: string;
  name: string;
  city: string;
  tlId: string | null;
  arcoId: string | null;
}

// PRD §15: channel definitions (DMS/LMT/MTI) are still pending client
// clarification — kept as free text rather than a hard enum until confirmed.
export type StoreChannel = string;
export type StoreCategory = 'premium' | 'super_premium';

export interface Store {
  id: string;
  name: string;
  address: string;
  city: string;
  channel: StoreChannel;
  account?: string;
  category: StoreCategory;
  lat: number | null;
  lng: number | null;
  assignedNcId: string | null;
  teamId: string | null;
  source: 'imported' | 'manual';
  createdAt: number;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  t: number;
}

export interface Attendance {
  id: string;
  userId: string;
  clockInAt: number;
  clockInLat: number;
  clockInLng: number;
  clockOutAt: number | null;
  clockOutLat?: number;
  clockOutLng?: number;
  route: RoutePoint[];
  geoFenceOk: boolean;
  /**
   * MWH (Market Working Hours) definition is still open per PRD §7/§15 — if it
   * ends up needing excluded non-market blocks, this is where they'll be
   * recorded. Left null/unused for v1 (MWH = Working Hours until decided).
   */
  nonMarketMs?: number;
}

/** Store check-in/out. Photo/document evidence lives on the individual report
 * tables (stock_taking, share_of_shelf, ...), not on the visit itself — PRD §5. */
export interface Visit {
  id: string;
  storeId: string;
  ncId: string;
  checkInAt: number;
  checkOutAt: number | null;
  lat: number;
  lng: number;
  storeDistanceM: number | null;
  geoValid: boolean;
}

// --- 7 report modules (PRD §5) — Phase 1 defines the shape; screens are stubs ---

export interface StockTakingRow {
  id: string;
  visitId: string;
  storeId: string;
  sku: string;
  qtyOnHand: number;
  outOfStock: boolean;
  photoUrl?: string;
  createdAt: number;
}

export interface ShareOfShelfRow {
  id: string;
  visitId: string;
  storeId: string;
  channel: StoreChannel;
  category: StoreCategory;
  ownFacingCount: number;
  totalFacingCount: number;
  photoUrl: string; // required per PRD §5.2
  createdAt: number;
}

export interface OfftakeRow {
  id: string;
  visitId: string;
  storeId: string;
  sku: string;
  unitsSold: number;
  revenue?: number;
  isOutlier: boolean; // >3x trailing 7-day avg — PRD §5.3
  createdAt: number;
}

export type VisibilityType = string; // config list — shelf talker, endcap, banner, ...

export interface PaidVisibilityRow {
  id: string;
  visitId: string;
  storeId: string;
  visibilityType: VisibilityType;
  complianceChecklist: Record<string, boolean>;
  photoUrl: string; // required per PRD §5.5
  createdAt: number;
}

export interface PriceMonitoringRow {
  id: string;
  visitId: string;
  storeId: string;
  sku: string;
  ownPrice: number;
  competitorPrices: number[]; // up to 3
  photoUrl?: string;
  createdAt: number;
}

export interface Survey {
  id: string;
  title: string;
  questions: SurveyQuestion[];
  campaignTag?: string;
  createdBy: string; // data_analyst
  createdAt: number;
}

export interface SurveyQuestion {
  id: string;
  text: string;
  type: 'multiple_choice' | 'free_text';
  options?: string[];
}

export interface SurveyResponse {
  id: string;
  surveyId: string;
  visitId: string | null; // Nutrition Quiz responses may not be tied to a visit — PRD §5.7/§6
  consumerId: string | null;
  answers: Record<string, string>;
  createdAt: number;
}

// --- Consumer / NTG & GWP (PRD §5.4, §6) ---

export type NtgGwpStage =
  | 'approached'
  | 'quiz_completed'
  | 'consultation_delivered'
  | 'ntg_confirmed'
  | 'gwp_given'
  | 'wa_followup_scheduled';

export interface Consumer {
  id: string;
  name: string;
  waContact: string;
  consent: boolean;
  childAgeBracket: string;
  currentBrand?: string;
  quizResult?: string; // segment tag, not a medical assessment — PRD §6
  /** Added in Phase 2 (0003 migration) to fix an RLS gap that let any NC edit
   * any other NC's consumer rows — see the migration's comment. */
  createdByNcId: string;
  createdAt: number;
}

// --- Product master (Phase 2) — SKU picklist source for Stock Taking /
// Offtake / Price Monitoring (PRD §5.1 "SKU list from product master").
// Deliberately not FK-enforced from the report tables' `sku` columns — see
// supabase/migrations/0003_products_and_reports.sql. ---

export interface Product {
  id: string;
  sku: string;
  name: string;
  category?: string;
  active: boolean;
  createdAt: number;
}

export interface NtgGwp {
  id: string;
  consumerId: string;
  visitId: string;
  stage: NtgGwpStage;
  gwpItem?: string;
  gwpQty?: number;
  /** Explicit link added during PRD review so "GWP spike without matching
   * offtake" anomaly detection (PRD §5.4) is actually computable. */
  offtakeId?: string;
  createdAt: number;
}

// --- Scorecards / targets (PRD §9) ---

export type ScorecardStatus = 'on_track' | 'needs_attention' | 'below_target';

export interface Scorecard {
  id: string;
  subjectId: string; // user id
  role: Role;
  periodKey: string; // e.g. "2026-09"
  score: number;
  status: ScorecardStatus;
  breakdown: Record<string, number>;
  computedAt: number;
}

/** Editable per PRD review recommendation — weights should not be hardcoded,
 * since NTG/channel/MWH definitions are still open and will likely need
 * post-pilot tuning. */
export interface ScorecardWeightConfig {
  role: Role;
  kpiKey: string;
  weightPct: number;
}

export interface Target {
  id: string;
  storeId: string | null;
  ncId: string | null;
  periodKey: string;
  offtakeTarget?: number;
  gwpAllocation?: number;
  setBy: string; // data_analyst user id
}

// --- Added during PRD review: certifications, schedules (§12) ---

export interface Certification {
  id: string;
  userId: string; // NC or TL
  certType: string;
  date: number;
  passed: boolean;
}

export interface Schedule {
  id: string;
  ncId: string;
  storeId: string;
  plannedDate: number;
  actualVisitId?: string; // filled once the planned visit happens
}

// --- In-app messaging (PRD §17) ---

export type ConversationType = 'nc_tl' | 'tl_arco';

export interface Conversation {
  id: string;
  type: ConversationType;
  participantA: string; // user id
  participantB: string; // user id
  createdAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}
