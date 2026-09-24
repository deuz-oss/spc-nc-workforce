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

1. Create a project at [supabase.com](https://supabase.com) and run every file in `supabase/migrations/` in
   the SQL Editor, in filename order (`0001` … `0009`). Existing projects: run only the ones not yet applied —
   `0008_audit_hardening.sql` (security fixes) and `0009_targets_uniqueness.sql` (Targets screen) are required.
   Then in **Authentication → Providers → Email**, turn **off** "Allow new users to sign up" — accounts are only
   ever provisioned by the `admin-users` edge function.
2. Copy `.env.example` → `.env`, fill in `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` (from Project Settings → API). **Never commit `.env`.**
3. `npm run seed:supabase` — one-time, creates 10 demo accounts (one per role) + 2 demo stores (see
   `src/store/seed.ts`). This is demo data only — real 47-city store master data and the real 215-account
   roster come in via the CSV bulk-import flow (Import screen), not this script.
4. Deploy both edge functions (redeploy after pulling `0008` — they changed with it):
   `npx supabase functions deploy admin-users --project-ref <ref>` (account creation incl. bulk, password reset) and
   `npx supabase functions deploy send-push --project-ref <ref>` (chat push notifications).
   New auth users start **inactive** with no trusted role (`handle_new_auth_user`, 0008); `admin-users` and the
   seed script are what grant the role/team and activate them.

The login screen's demo-account shortcuts only appear in dev builds, or when `EXPO_PUBLIC_SHOW_DEMO_ACCOUNTS=true`
is set (e.g. a UAT build against the demo project) — never enable that against real data.

Login uses a plain username in the UI, mapped under the hood to a synthetic email `{username}@internal.spc`
through Supabase Auth (`src/store/useStore.ts`).

## Status & Gaps (Phase 5 — Hardening, per PRD §16)

All 5 phases from the PRD's phasing plan (§16) are implemented:

- **Phase 1 (Foundation):** auth, 10-role RBAC, role-scoped access (`scopeUsers`/`storeScope` in
  `src/store/useStore.ts`, mirrored by Postgres RLS), attendance + geofenced check-in, product master, bulk
  account provisioning (`addUsersBulk` + `ImportScreen`'s "Akun Pengguna" mode), full Postgres schema for the
  entire PRD §12 data model, navy/gold design tokens.
- **Phase 2 (Core daily loop):** Stock Taking, Offtake (server-side outlier trigger), NTG & GWP consumer funnel.
- **Phase 3 (Bi-weekly modules):** Share of Shelf, Paid Visibility, Price Monitoring, Survey builder/response
  flow, and the Nutrition Quiz (consent-gated, age-branched — the under-1-year branch never advances the funnel).
- **Phase 4 (Dashboards and scorecards):** TL/ARCO exception-based validation queue + live team map + coaching
  log, PM/Reckitt/Data Analyst management dashboard (Reckitt's view is structurally PII-free, not just
  role-gated), a server-computed scorecard engine (`compute_scorecards` RPC, config-driven weights, honest about
  which KPIs have no supporting data model yet — see `0006_phase4_scorecards.sql`), and in-app messaging
  (NC↔TL, TL↔ARCO) with push-notification infrastructure that is wired but unverified end-to-end (no real EAS
  project or physical device to test against).

**Phase 5 (Hardening) — status:**
- ✅ **Live database validated.** All 7 migrations (`0001`–`0007`) apply cleanly to a real Supabase project;
  seed script, RLS role-scoping, and the `compute_scorecards` RPC have all been smoke-tested against it
  successfully — this was the first time any of the above SQL had touched a live Postgres instance.
- ✅ **Offline queue extended to every photo-based report module.** Stock Taking's optional photo, Share of
  Shelf/Paid Visibility's required photo, and Price Monitoring's optional photo now all queue on native when
  offline (`persistPhotoLocally`/`discardLocalPhoto`/`localPhotoExists` in `src/utils/storage.ts`). The photo
  upload itself is deferred to replay time and never baked into a row before it's confirmed uploaded — a
  required-photo row can structurally never reach Supabase without its photo (replay withholds the insert until
  the upload succeeds), and if the local file is gone by the time the device reconnects (app reinstalled, cache
  cleared), the op is dropped with a clear "please resubmit" dialog rather than retried forever. **Web is
  deliberately excluded**: browser-picked file/blob URIs don't reliably survive a page reload the way a native
  file copy does, so web keeps the original online-required behavior for these four modules' photo handling.
- ⬜ **iOS background location + build validation** — still open. Config in `app.json` looks complete but is
  **unvalidated on a physical device**; needs a Mac, real iOS hardware, and an Apple Developer account, none of
  which exist in this environment.
- ⬜ EAS `preview`/`production` build profiles exist in `eas.json` but have never been run; both need Supabase
  env vars configured via EAS (`eas env:create`), and `production` has no `eas submit` (signing/Play Store
  service account) configured yet.
- ⬜ Real 47-city store master data and the real 215-person account roster (seed script is demo data only).
- 🟨 `assets/` holds **placeholder** icons (gold "NC" badge on navy, generated from the app's own theme and
  font) so builds can run. Replace them with real brand artwork before any store submission — same filenames and
  sizes: `icon.png` 1024² opaque, `android-icon-foreground.png` 1024² transparent with content inside the centre
  ~66%, `android-icon-background.png` 1024², `android-icon-monochrome.png` 1024² single-colour silhouette,
  `notification-icon.png` 96² white-on-transparent, `favicon.png` 48².

- ✅ **Login loads a bounded history.** Field-activity tables (visits, attendance, the report modules, reviews,
  coaching logs, messages) load only the last `HISTORY_DAYS` (62, `src/config.ts`) at login — enough for every
  daily/weekly/monthly view — plus anything still open (not clocked/checked out). Screens that can reach further
  back (dashboard "Semua", store/NC visit history) offer **Muat Riwayat Lengkap** (`loadFullHistory`). Reference
  data and the NTG & GWP funnel (whose latest row is the consumer's current stage) always load in full.

**Known open dependencies** (from the PRD's own open-questions list, §15 — not something this codebase can
resolve on its own):
- NTG definition, and DMS/LMT/MTI channel definitions — `stores.channel` is free text pending this
- MWH (Market Working Hours) definition — `attendances.non_market_ms` column exists but is unused; MWH = Working
  Hours until decided
- Payroll export process/format
- Whether Reckitt requires LIS integration (would change §11 from a role addition to a data-sync requirement)
- No certifications data-entry UI exists yet, so 2 of Lead Trainer's scorecard KPIs can never compute in practice

## iOS Validation Checklist (manual — needs a Mac + physical device + Apple Developer account)

Nothing here can be executed from this environment (no Mac, no iOS hardware, no Apple ID). This is the exact
sequence to run yourselves before iOS is considered launch-ready.

**0. Brand assets:** `assets/` currently holds placeholder icons (see Status & Gaps) — enough to build and test,
but replace them with real brand artwork before any App Store / Play Store submission.

**1. Real EAS project (also unblocks push notifications, PRD §17):**
```
npm i -g eas-cli        # or use `npx eas-cli` for every command below
eas login               # your Expo/EAS account
eas init                # creates a real project, writes owner + extra.eas.projectId into app.json
```
Commit the resulting `app.json` change. `registerPushToken()` in `src/store/useStore.ts` skips push registration
while there's no project id — this is what turns it on.

**2. Apple Developer Program:** required for *any* build that targets a **physical device or the App Store**
(not required for a simulator-only build). Enroll at developer.apple.com if not already done ($99/year).

**3. First pass — simulator build (no paid account needed if you skip step 2 for now):**
Add an `ios` block to the `preview` profile in `eas.json` (`"ios": { "simulator": true }`), then:
```
eas build --platform ios --profile preview
```
This validates the build pipeline itself (dependencies, native config, `expo-task-manager`/`expo-location`
plugin config) without needing a device yet. **Caveat:** background location cannot be meaningfully tested on
a simulator — it doesn't suspend/resume apps realistically — so this step only proves "it builds," not
"background tracking works."

**4. Real device build:**
```
eas build --platform ios --profile development   # dev client, for iterating
eas build --platform ios --profile preview        # ad-hoc, for stakeholder/UAT testing
```
EAS can auto-manage signing credentials (provisioning profile + certificate) if you let it during the
interactive build setup — accept that unless your org has its own credentials process.

**5. On-device validation checklist** (mirrors what was already proven on Android per the original
`spc-field-force` foundation — PRD §3):
- [ ] Location permission prompts show the correct Bahasa Indonesia copy (`NSLocationWhenInUseUsageDescription`
  / `NSLocationAlwaysAndWhenInUseUsageDescription` in `app.json`)
- [ ] Clock-in starts route recording; **lock the screen and background the app** for several minutes; confirm
  route points keep appending (`route_points` table) once foregrounded again — this is the actual point of the
  whole exercise, iOS background location has categorically different OS behavior than Android's
- [ ] Store check-in geofence blocking (300m radius) works correctly on-device (GPS accuracy differs from
  simulator/Android)
- [ ] Camera + photo library permissions prompt correctly for report photo capture
- [ ] Push notification permission prompt appears and a test chat message (§17) actually arrives as a native
  push while the app is backgrounded
- [ ] `expo-intent-launcher`'s battery-optimization prompt is Android-only — confirm it's simply absent/no-op on
  iOS, not crashing

**6. Before App Store submission** (separate from internal testing, do this last):
`eas.json`'s `production` profile has no `eas submit` configuration (signing/App Store Connect API key) yet —
add one once you're ready to actually ship, not before internal validation above passes.

## Checks

- **CI** (`.github/workflows/ci.yml`, runs on push/PR once the repo is on GitHub): `tsc`, `expo-doctor`
  (SDK version drift, missing assets), a web bundle via `expo export`, and a Deno type check of the edge functions.
- **Backend smoke test** (manual, writes to a real project — staging/demo only):
  `npm run smoke -- --project <project-ref>` — 22 RLS/RPC/edge-function checks as each demo role; see
  `scripts/smoke-rls.ts`. Run it after every migration or edge-function change.

## Reused vs New (PRD §3)

| Area | Status |
|---|---|
| Auth, RBAC, role-scoped access | Reused (pattern), re-modeled for 10 NC-program roles |
| Attendance / geofencing / background location | Reused near-verbatim |
| Offline queue (4 critical actions) | Reused near-verbatim; extended (Phase 5, new) to defer photo uploads for Stock Taking/Share of Shelf/Paid Visibility/Price Monitoring |
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
