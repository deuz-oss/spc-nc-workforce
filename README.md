# SPC NC Workforce

**Client program:** Reckitt / Mead Johnson Nutrition — Enfagrow A+ Nutrition Consultant (NC) Service Provider 2027
**Owner:** PT Sinergi Performa Cipta (SPC)

Field-reporting platform for 195 Nutrition Consultants (+ TLs/ARCOs/PM/support) across 47 cities: attendance,
geofenced store check-in/out, 7 report categories, consumer data capture with consent, TL/ARCO validation,
scorecards, and a read-only Reckitt client view — built without depending on Reckitt's own systems.

Full requirements live in the PRD (`prd.md` in this engagement's planning docs, not checked into this repo).
This README tracks build status; the PRD tracks product scope and open questions.

## Foundation

New, standalone repository — **not** a fork of `spc-field-force` and not merged into any other SPC product —
but scaffolded from its proven architecture: Expo (React Native + TypeScript) + Supabase (Postgres + Auth +
Realtime + Storage), single codebase for Android/iOS/Web. `spc-field-force` was built and device-validated for
a prior field-agent program (ByteDance/TikTok ID-SMB merchant onboarding); this repo reuses its domain-agnostic
plumbing — auth, offline queue, geofencing, background location, design-token system, CSV import, realtime
store pattern, admin-provisioning edge function — and replaces the merchant-onboarding business logic with
NC-specific domain logic (see "Reused vs New" below).

## Running

```bash
npm install
npx expo start
```

- Press `w` to open the Web app in a browser
- Press `a` / `i` → **only for features without background location.** Live tracking uses a native GPS task
  (`expo-task-manager`) not supported by Expo Go — on Android/iOS use a custom **dev client** (see below), not
  plain `npx expo start`.

Needs a `.env` (copy from `.env.example`) with Supabase credentials — see "Backend (Supabase)".

### Dev client (Android/iOS, required for background location)

```bash
npx eas-cli login
npx eas-cli build --platform android --profile development   # or --platform ios
```

Install the resulting APK/IPA on a device/emulator, then run the bundler with:

```bash
npx expo start --dev-client            # phone on the same network/USB
npx expo start --dev-client --tunnel   # phone on a different network (needs @expo/ngrok)
```

Production builds (APK/IPA/store) use the matching `eas.json` profile (`eas build -p android --profile production`, etc.).

## Backend (Supabase)

Postgres + Auth + Realtime + Storage. Migrations live in `supabase/migrations/` (`0001_init.sql` = schema/RLS/
triggers/RPC, `0002_visit_media_storage.sql` = report-evidence photo/document bucket).

1. Create a project at [supabase.com](https://supabase.com), run `0001_init.sql` then `0002_visit_media_storage.sql`
   in the SQL Editor, in that order.
2. Copy `.env.example` → `.env`, fill in `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` (from Project Settings → API). **Never commit `.env`.**
3. `npm run seed:supabase` — one-time, creates 10 demo accounts (one per role) + 2 demo stores (see
   `src/store/seed.ts`). This is demo data only — real 47-city store master data and the real 215-account
   roster come in via the CSV bulk-import flow (Import screen), not this script.
4. Deploy the admin edge function (required for account creation, including bulk provisioning):
   `npx supabase functions deploy admin-users --project-ref <ref>` (see `supabase/functions/admin-users/index.ts`).

Login uses a plain username in the UI, mapped under the hood to a synthetic email `{username}@internal.spc`
through Supabase Auth (`src/store/useStore.ts`).

## Status & Gaps (Phase 1 — Foundation, per PRD §16)

**Built and real** (not stubs):
- Auth (username → Supabase Auth), 10-role RBAC, role-scoped data access (`scopeUsers`/`storeScope` in
  `src/store/useStore.ts`, mirrored by Postgres RLS in `0001_init.sql`)
- Attendance: clock in/out, live GPS route recording (foreground + Android background, native task — the exact
  code path already validated on physical devices in `spc-field-force`)
- Store check-in/out with **geofence-blocked entry** (default 300 m radius, `StoreDetailScreen.tsx`)
- Offline queue for the four critical actions (clock in/out, check-in/out) — same scope as `spc-field-force`;
  extending it to the 7 report-module submissions is **not yet sized**, see PRD §13
- CSV bulk import: store master data, and **bulk account provisioning** (new — PRD §13's 215-account scale gap;
  `addUsersBulk` in `useStore.ts` + the "Akun Pengguna" mode in `ImportScreen.tsx`)
- Full Postgres schema for the entire PRD §12 data model (all 7 report tables, consumers/NTG-GWP, surveys,
  scorecards, targets, certifications, schedules, messaging) with RLS — even though no screen reads/writes most
  of it yet. Schema-first so Phase 2+ doesn't need a redesign.
- Design tokens re-themed to navy/gold (`src/theme.ts`) per PRD §3

**Explicitly stubbed** (placeholder screens wired into navigation, no business logic — PRD §16 Phase 2/3/4):
- All 7 report modules (Stock Taking, Share of Shelf, Offtake, NTG & GWP, Paid Visibility, Price Monitoring, Survey)
- Nutrition Quiz consumer flow (PRD §6)
- In-app messaging, NC↔TL / TL↔ARCO (PRD §17) — needs new push-notification infrastructure, not yet built
- TL/ARCO same-day validation console, live team map, coaching log (PRD §8)
- Scorecard engine — all 7 roles' weighted KPIs (PRD §9); `src/utils/kpi.ts` only has the Phase 1 attendance/visit
  discipline metrics (Working Hours, CFT, geofence %, valid-visit %), not the full weighted formulas
- Management dashboard KPI cards/trend charts/channel breakdown (PRD §10)
- Reckitt client dashboard content (role and read-only scoping exist; the views themselves don't yet)

**Known open dependencies** (from the PRD's own open-questions list, §15 — not something this codebase can
resolve on its own):
- NTG definition, and DMS/LMT/MTI channel definitions — `stores.channel` is free text pending this
- MWH (Market Working Hours) definition — `attendances.non_market_ms` column exists but is unused; MWH = Working
  Hours until decided
- Payroll export process/format
- Whether Reckitt requires LIS integration (would change §11 from a role addition to a data-sync requirement)

**Not yet done, called out in PRD §13/§16 as pre-go-live work:**
- iOS background location: config is present (`app.json`) but **unvalidated on a physical device** — needs a Mac
  and real iOS hardware
- EAS `preview`/`production` build profiles exist in `eas.json` but have never been run; both need Supabase env
  vars configured via EAS (`eas env:create`), and `production` has no `eas submit` (signing/Play Store service
  account) configured yet
- Real 47-city store master data and the real 215-person account roster (seed script is demo data only)
- `assets/` (icon.png, android-icon-*.png, favicon.png, notification-icon.png) referenced by `app.json` are
  **not present in this repo** — no image-generation tool was available while scaffolding. Add real brand
  assets before running `expo start` on a device or an EAS build; TypeScript compiles fine without them, but
  Expo will fail to resolve the icons at runtime/build time.

## Reused vs New (PRD §3)

| Area | Status |
|---|---|
| Auth, RBAC, role-scoped access | Reused (pattern), re-modeled for 10 NC-program roles |
| Attendance / geofencing / background location | Reused near-verbatim |
| Offline queue (4 critical actions) | Reused near-verbatim |
| CSV import + bulk assignment | Reused (pattern), extended with bulk account provisioning |
| Design system (tokens, components, Plus Jakarta Sans) | Reused, re-themed navy/gold |
| Backend shape (Supabase: Postgres+Auth+Realtime+Storage) | Reused, single project (not multi-tenant) |
| Merchant-onboarding funnel (pitch→...→cold start) | **Not reused verbatim** — repurposed into NTG & GWP (PRD §5.4) |
| 7 report modules, scorecards, messaging, dashboards | New — Phase 2/3/4 |

## Structure

```
App.tsx                  # navigation + login gate + tab set per role
index.ts                 # entry point; registers background location task
src/
  config.ts               # geofence radius, tracking/stop-detection constants, role labels
  types.ts                 # full PRD §12 domain model (mirrors the Postgres schema)
  lib/supabase.ts          # Supabase client
  store/useStore.ts        # realtime cache over Supabase (zustand) — Phase 1 slices only
  store/seed.ts             # demo data; only used by scripts/seed-supabase.ts, not the running app
  tasks/locationTask.ts     # TaskManager.defineTask — native background GPS recording
  utils/                    # csv, geo (haversine, detectStops), period, export, format, kpi (Phase 1 subset)
  components/                # UI kit, dialog host, TrackingWatcher
  screens/                   # Login, Dashboard, Stores, StoreDetail, StoreVisit, Attendance, Import, Users,
                              # Profile, and the generic ComingSoonScreen used for every Phase 2+ module
supabase/
  migrations/0001_init.sql          # full schema + RLS + triggers + RPC finish_visit
  migrations/0002_visit_media_storage.sql  # report-evidence photo/doc bucket
  functions/admin-users/index.ts    # Edge Function: create-user (incl. bulk) & reset-password, service-role
scripts/seed-supabase.ts             # seed demo accounts + demo stores into Supabase
eas.json                             # EAS build profiles (development/preview/production)
```
