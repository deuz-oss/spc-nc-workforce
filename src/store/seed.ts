import { NUTRITION_QUIZ_CAMPAIGN_TAG, NUTRITION_QUIZ_SURVEY_ID } from '../config';
import { Role, Store, Team } from '../types';

/**
 * Demo seed for Phase 1 — a handful of accounts (one per role, matching the
 * quick-login list in LoginScreen.tsx) and 2-3 demo stores. This is NOT the
 * real 47-city store master data (PRD §13) — that lands via the CSV bulk
 * import flow (Import screen / addUsersBulk) once real data is available.
 * Used ONLY by scripts/seed-supabase.ts, never imported into the running app.
 */

export interface SeedUser {
  id: string; // local id, remapped to the real auth uuid by the seed script
  name: string;
  username: string;
  password: string;
  role: Role;
  teamId: string | null;
  city?: string;
  phone?: string;
}

export interface SeedSurvey {
  id: string;
  title: string;
  campaignTag?: string;
  createdByUsername: string; // remapped to a real auth uuid by the seed script, like assignedNcUsername
  createdAt: number;
}

export interface SeedResult {
  teams: Team[];
  users: SeedUser[];
  stores: Array<Omit<Store, 'assignedNcId'> & { assignedNcUsername: string | null }>;
  surveys: SeedSurvey[];
}

export function buildSeed(): SeedResult {
  const teams: Team[] = [
    { id: 't_jaksel', name: 'Tim Jakarta Selatan', city: 'Jakarta Selatan', tlId: null, arcoId: null },
  ];

  const users: SeedUser[] = [
    { id: 'u_superadmin', name: 'Super Admin', username: 'superadmin', password: 'super123', role: 'super_admin', teamId: null },
    { id: 'u_reckitt', name: 'Reckitt Monitoring', username: 'reckitt', password: 'reckitt123', role: 'reckitt_client', teamId: null },
    { id: 'u_pm', name: 'PM SPC', username: 'pm', password: 'pm12345', role: 'pm', teamId: null },
    { id: 'u_analyst', name: 'Data Analyst SPC', username: 'analyst', password: 'analyst123', role: 'data_analyst', teamId: null },
    { id: 'u_leadtrainer', name: 'Lead Trainer SPC', username: 'leadtrainer', password: 'train1234', role: 'lead_trainer', teamId: null },
    { id: 'u_trainer', name: 'Trainer SPC', username: 'trainer', password: 'train1234', role: 'trainer', teamId: null },
    { id: 'u_admindata', name: 'Admin Data Entry', username: 'admindata', password: 'admin1234', role: 'admin_data_entry', teamId: null },
    { id: 'u_arco', name: 'ARCO Jakarta', username: 'arco.jkt', password: 'arco1234', role: 'arco', teamId: null, city: 'Jakarta' },
    { id: 'u_tl', name: 'TL Jakarta Selatan', username: 'tl.jaksel', password: 'tl123456', role: 'tl', teamId: 't_jaksel', city: 'Jakarta Selatan' },
    { id: 'u_nc', name: 'Budi (NC)', username: 'nc.budi', password: 'nc123456', role: 'nc', teamId: 't_jaksel', city: 'Jakarta Selatan' },
  ];

  const stores: SeedResult['stores'] = [
    {
      id: 'st_demo1',
      name: 'Apotek Kimia Farma Sudirman',
      address: 'Jl. Jend. Sudirman No.1',
      city: 'Jakarta Selatan',
      channel: 'DMS',
      account: 'Kimia Farma',
      category: 'premium',
      lat: -6.208763,
      lng: 106.845599,
      teamId: 't_jaksel',
      source: 'manual',
      createdAt: Date.now(),
      assignedNcUsername: 'nc.budi',
    },
    {
      id: 'st_demo2',
      name: 'Baby Shop Mother Care',
      address: 'Jl. Fatmawati No.20',
      city: 'Jakarta Selatan',
      channel: 'LMT',
      account: 'Mother Care',
      category: 'super_premium',
      lat: -6.29127,
      lng: 106.79852,
      teamId: 't_jaksel',
      source: 'manual',
      createdAt: Date.now(),
      assignedNcUsername: 'nc.budi',
    },
  ];

  // Backs the Nutrition Quiz (PRD §6, NutritionQuizScreen) — `questions` is
  // deliberately empty: the quiz's branching logic lives in code, not the
  // generic Survey question-list renderer, so this row exists only so
  // survey_responses has something to attach to (and so it appears in
  // survey listings/exports later), not as the source of the quiz content.
  const surveys: SeedSurvey[] = [
    {
      id: NUTRITION_QUIZ_SURVEY_ID,
      title: 'Quick Nutrition Check',
      campaignTag: NUTRITION_QUIZ_CAMPAIGN_TAG,
      createdByUsername: 'analyst',
      createdAt: Date.now(),
    },
  ];

  return { teams, users, stores, surveys };
}
