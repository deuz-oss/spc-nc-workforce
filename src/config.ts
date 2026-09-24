import { NtgGwpStage, Role } from './types';

export const APP_NAME = 'SPC NC Workforce';

/** Jarak maksimum titik check-in ke pin toko agar kunjungan dianggap valid — PRD §5 (default 300 m, configurable). */
export const VISIT_VALID_RADIUS_M = 300;

/** Riwayat data lapangan (kunjungan, absensi, laporan, pesan) yang dimuat saat login.
 * 62 hari = bulan berjalan + bulan sebelumnya pada tanggal berapa pun — cukup untuk
 * semua dashboard/KPI periode harian/mingguan/bulanan. Riwayat lebih lama dimuat
 * sesuai permintaan (useStore.loadFullHistory). */
export const HISTORY_DAYS = 62;

/** Abaikan titik rute jika bergerak kurang dari jarak ini (m) untuk hemat storage */
export const TRACK_MIN_STEP_M = 8;

/** Interval minimum update GPS saat tracking (ms) */
export const TRACK_INTERVAL_MS = 15000;

/** Radius pengelompokan titik rute jadi satu "titik berhenti" (m) */
export const STOP_CLUSTER_RADIUS_M = 40;
/** Durasi minimum di satu titik agar dihitung sebagai "berhenti" (ms) — di bawah ini dianggap lampu merah/macet */
export const STOP_MIN_DURATION_MS = 10 * 60 * 1000;
/** Durasi berhenti di luar lokasi toko yang ditandai "perlu ditinjau" (ms) */
export const STOP_FLAG_DURATION_MS = 30 * 60 * 1000;

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin',
  reckitt_client: 'Reckitt (Client, Read-only)',
  pm: 'Project Manager',
  arco: 'Area Coordinator',
  tl: 'Team Leader',
  nc: 'Nutrition Consultant',
  lead_trainer: 'Lead Trainer',
  trainer: 'Trainer',
  data_analyst: 'Data Analyst',
  admin_data_entry: 'Admin Data Entry',
};

/** Posisi yang boleh memantau seluruh program (semua tim/kota) */
export const MONITOR_ROLES: Role[] = ['super_admin', 'pm', 'reckitt_client', 'data_analyst'];
/** Posisi yang boleh mengelola toko (tambah/impor/assign) */
export const STORE_MANAGER_ROLES: Role[] = ['super_admin', 'admin_data_entry', 'tl', 'arco'];
/** Posisi yang boleh melakukan bulk account provisioning (PRD §13) */
export const USER_MANAGER_ROLES: Role[] = ['super_admin'];
/** Posisi yang boleh mengelola product master (SKU) — matches products RLS write policy, 0003 migration */
export const PRODUCT_MANAGER_ROLES: Role[] = ['super_admin', 'admin_data_entry', 'data_analyst'];

export const CHANNEL_LABEL_NOTE =
  'Definisi channel DMS/LMT/MTI masih menunggu konfirmasi client (PRD §15) — kode disimpan apa adanya.';

export const CATEGORY_LABEL: Record<string, string> = {
  premium: 'Premium',
  super_premium: 'Super Premium',
};

/** NTG & GWP funnel stages, in forward-progression order (PRD §5.4). */
export const NTG_GWP_STAGES: NtgGwpStage[] = [
  'approached',
  'quiz_completed',
  'consultation_delivered',
  'ntg_confirmed',
  'gwp_given',
  'wa_followup_scheduled',
];

export const NTG_GWP_STAGE_LABEL: Record<NtgGwpStage, string> = {
  approached: 'Didekati',
  quiz_completed: 'Nutrition Quiz Selesai',
  consultation_delivered: 'Konsultasi Diberikan',
  ntg_confirmed: 'NTG Terkonfirmasi',
  gwp_given: 'GWP Diberikan',
  wa_followup_scheduled: 'Follow-up WA Terjadwal',
};

// --- Phase 3 (PRD §16): Share of Shelf / Paid Visibility / Price Monitoring / Survey ---

/** Visibility placement types for Paid Visibility (PRD §5.5 "from a config list") — not specified by the
 * client brief; this is a reasonable default set of common in-store paid placements. */
export const VISIBILITY_TYPES: Array<{ key: string; label: string }> = [
  { key: 'shelf_talker', label: 'Shelf Talker' },
  { key: 'endcap', label: 'Endcap Display' },
  { key: 'banner', label: 'Banner / Standing Banner' },
  { key: 'wobbler', label: 'Wobbler' },
  { key: 'floor_display', label: 'Floor Display' },
  { key: 'poster', label: 'Poster / Signage Toko' },
];

/** Compliance checklist items for Paid Visibility (PRD §5.5) — also not specified by the client brief;
 * a reasonable default set. Stored as PaidVisibilityRow.complianceChecklist (key -> checked). */
export const COMPLIANCE_CHECKLIST_ITEMS: Array<{ key: string; label: string }> = [
  { key: 'terpasang_benar', label: 'Terpasang dengan benar' },
  { key: 'kondisi_baik', label: 'Kondisi baik (tidak rusak/kotor)' },
  { key: 'lokasi_sesuai', label: 'Lokasi sesuai kontrak/brief' },
  { key: 'periode_berlaku', label: 'Berlaku dalam periode kampanye' },
];

/** Posisi yang boleh mengatur target offtake/alokasi GWP per NC (matches targets RLS write policy, 0001 migration). */
export const TARGET_MANAGER_ROLES: Role[] = ['data_analyst', 'super_admin'];

/** Posisi yang boleh membuat/mengelola Survey (matches surveys RLS write policy, 0001 migration). */
export const SURVEY_BUILDER_ROLES: Role[] = ['data_analyst', 'super_admin'];

/** Fixed id/campaign tag for the seeded "Quick Nutrition Check" Survey row that backs the Nutrition
 * Quiz (PRD §6). The quiz's question branching logic lives in NutritionQuizScreen (code, not this
 * config) — this Survey row exists so responses have somewhere to attach via survey_responses.survey_id,
 * and so the quiz shows up alongside other surveys in listings/exports later. Seeded once via
 * scripts/seed-supabase.ts; NutritionQuizScreen shows a setup-pending message if it's missing. */
export const NUTRITION_QUIZ_SURVEY_ID = 'sv_nutrition_quiz_v1';
export const NUTRITION_QUIZ_CAMPAIGN_TAG = 'nutrition_quiz_v1';

/** Child age brackets (PRD §6 — bracket only, never a DOB). `under1` drives the Nutrition Quiz's
 * mandatory ASI/MPASI-only branch (no product recommendation, no NC follow-up trigger). */
export interface ChildAgeBracketOption {
  key: string;
  label: string;
  under1: boolean;
}
export const CHILD_AGE_BRACKETS: ChildAgeBracketOption[] = [
  { key: '0-6bulan', label: '0-6 bulan', under1: true },
  { key: '6-12bulan', label: '6-12 bulan', under1: true },
  { key: '1-2tahun', label: '1-2 tahun', under1: false },
  { key: '2-3tahun', label: '2-3 tahun', under1: false },
  { key: '3tahun+', label: '3+ tahun', under1: false },
];

// --- Phase 4a (PRD §16): TL/ARCO validation console + PM/Reckitt dashboards ---

/** Posisi yang boleh melakukan review/approve/flag laporan (matches report_reviews RLS write policy, 0005 migration). */
export const REPORT_REVIEWER_ROLES: Role[] = ['tl', 'arco', 'super_admin'];

export const REPORT_TYPE_LABEL: Record<string, string> = {
  stock_taking: 'Stock Taking',
  share_of_shelf: 'Share of Shelf',
  offtake: 'Offtake',
  paid_visibility: 'Paid Visibility',
  price_monitoring: 'Price Monitoring',
};

/** Roles that see the PM/Reckitt-style management dashboard (PRD §10, §11) — same widgets,
 * Reckitt gets its PII hidden structurally (see ManagementDashboard's hidePii prop). */
export const MANAGEMENT_DASHBOARD_ROLES: Role[] = ['pm', 'reckitt_client', 'data_analyst'];

// --- Phase 4b (PRD §16): scorecard computation + in-app messaging ---

/** Roles the scorecard engine actually scores (PRD §9's KPI table) — `trainer`
 * (non-lead) has no KPI row in the PRD, and super_admin/reckitt_client are
 * explicitly not scored (PRD §2). Matches the role loops in
 * supabase/migrations/0006_phase4_scorecards.sql's compute_scorecards(). */
export const SCORECARD_ROLES: Role[] = ['nc', 'tl', 'arco', 'pm', 'lead_trainer', 'data_analyst', 'admin_data_entry'];

/** Human labels for every kpi_key the compute_scorecards() function can produce
 * (computed or explicitly skipped) — see that migration for which KPIs are
 * genuinely computable per role vs. documented-skip. */
export const SCORECARD_KPI_LABEL: Record<string, string> = {
  offtake_achievement: 'Pencapaian Offtake',
  new_user_recruitment: 'Rekrutmen Pengguna Baru',
  competitor_conversion: 'Konversi dari Kompetitor',
  reporting_compliance: 'Kepatuhan Pelaporan',
  attendance: 'Kehadiran',
  team_offtake: 'Offtake Tim',
  team_new_users_conversion: 'Pengguna Baru/Konversi Tim',
  same_day_validation: 'Validasi Same-Day',
  coaching_visits: 'Kunjungan Coaching',
  team_retention: 'Retensi Tim',
  regional_offtake: 'Offtake Regional',
  regional_new_users_conversion: 'Pengguna Baru/Konversi Regional',
  activation_execution: 'Eksekusi Aktivasi',
  fulfilment_sla_retention: 'Fulfilment SLA/Retensi',
  reporting_accuracy: 'Akurasi Pelaporan',
  program_offtake_new_users: 'Offtake/Pengguna Baru Program',
  fulfilment_sla: 'Fulfilment SLA',
  attrition_vs_target: 'Attrisi vs Target',
  client_review_score: 'Skor Review Klien',
  training_schedule_adherence: 'Kepatuhan Jadwal Training',
  certification_pass_rate: 'Tingkat Lulus Sertifikasi',
  kpi_uplift_post_training: 'Peningkatan KPI Pasca-Training',
  mystery_shopper: 'Mystery Shopper',
  tl_coach_certification: 'Sertifikasi TL-Coach',
  monthly_report_timeliness: 'Ketepatan Waktu Laporan Bulanan',
  data_error_rate: 'Tingkat Error Data',
  target_gwp_allocation_timeliness: 'Ketepatan Waktu Alokasi Target/GWP',
  adopted_recommendations: 'Rekomendasi yang Diadopsi',
  ad_hoc_turnaround: 'Turnaround Ad Hoc',
  daily_consolidation_timeliness: 'Ketepatan Waktu Konsolidasi Harian',
  payroll_incentive_accuracy: 'Akurasi Payroll/Insentif',
  pjp_schedule_updates: 'Update PJP/Jadwal',
  gwp_absorption_reporting: 'Pelaporan Absorpsi GWP',
  competitor_activity_reports: 'Laporan Aktivitas Kompetitor',
};
