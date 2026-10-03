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
   the SQL Editor, in filename order (`0001` … `0021`). Existing projects: run only the ones not yet applied —
   `0008_audit_hardening.sql` (security fixes), `0009_targets_uniqueness.sql` (Targets screen) and
   `0010_scheduled_scorecards.sql` (nightly scorecards via `pg_cron`, locks down `compute_scorecards`) and
   `0011_private_report_media.sql` (evidence photos private, opened via signed URLs) and
   `0012_live_positions.sql` (TL/ARCO live team map) and
   `0013_route_buffer_and_report_dedup.sql` (late/offline GPS points accepted, one report per visit per SKU) and
   `0014_server_side_field_checks.sql` (server-computed geofence, timestamp bounds, under-1 rule) and
   `0015_consumer_privacy_and_funnel.sql` (forward-only funnel, unique WhatsApp, consent record + erasure, Reckitt
   PII limits, private push tokens — **redeploy `send-push` with it**) and
   `0016_audit_log_outlier_autoclose.sql` (admin audit log, offtake outlier window, hourly auto-close of forgotten
   sessions — **redeploy `admin-users` with it**) and
   `0017_scorecard_fairness_atomic_consumer.sql` (attendance KPI on working days, no score without computable KPIs,
   consumer + funnel step saved atomically) and
   `0018_client_errors_dashboard_summary.sql` (client crash log, server-side management dashboard figures) and
   `0019_consumer_current_stage.sql` (consumer's funnel stage kept on the consumer row) and
   `0020_pjp_schedules.sql` (PJP visit plans: scoped writes, server-linked visits) and
   `0021_fix_duplicate_report_message.sql` (duplicate-report rejection returns its message, not a column error) are required.
   Also in **Authentication → Providers → Email**, set the minimum password length to **8** (matches `MIN_PASSWORD`,
   `src/utils/password.ts` — the self-service password change goes straight to Supabase Auth).
   Then in **Authentication → Providers → Email**, turn **off** "Allow new users to sign up" — accounts are only
   ever provisioned by the `admin-users` edge function.
2. Copy `.env.example` → `.env`, fill in `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` (from Project Settings → API). **Never commit `.env`.**
3. `npm run seed:supabase` — one-time, creates 10 demo accounts (one per role) + 2 demo stores (see
   `src/store/seed.ts`). This is demo data only — real 47-city store master data and the real 215-account
   roster come in via the CSV bulk-import flow (Import screen), not this script.
4. Deploy both edge functions (redeploy after pulling `0008`, `send-push` again with `0015` and `admin-users` again with `0016` — they changed with them):
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

- ✅ **Opens without signal.** A cold start that can't reach the server no longer signs the user out: the app
  opens from an on-device snapshot (`src/utils/offlineCache.ts` — reference data plus the user's own last 2 days
  of field activity, saved as it changes) with a "Mode offline" strip, and completes the session by itself once
  the server is reachable. Network errors never count as "account deactivated". Every queueable write
  (clock, store check-in/out, the report modules) takes one path, `runOrQueue` in `useStore.ts`: it is sent now
  only when the device actually reaches the internet (`isInternetReachable`, not just "connected") **and** nothing
  is queued ahead of it — otherwise it queues behind earlier ops so they reach the server in order; a request
  that fails at the network level is queued rather than lost. The tab header shows how many writes still wait.
- ✅ **GPS route survives no signal and a killed app.** Location fixes go to an on-device buffer
  (`src/utils/routeBuffer.ts`) with their real fix time — every fix of a batch, not just the last — and are
  uploaded by `src/utils/routeSync.ts` whenever possible (idempotent, migration 0013). The background task reads
  whose session to record from a persisted tracking context, not the app store, so it keeps recording when
  Android restarts it headless. Points of a clock-in still in the offline queue wait for it to sync.
- ✅ **One report per visit per SKU** (category for Share of Shelf, type for Paid Visibility): already-reported
  items are listed and can't be submitted again — enforced in the app and by a server trigger (0013), so a
  repeated Offtake submission can no longer double units sold. *Correcting* a submitted report is still not
  possible (reports are insert-only by design) — needs a decision on who may correct and how it's audited.
- ✅ **Field data is checked by the server, not trusted from the phone** (migration 0014). Visit
  `geo_valid`/distance are recomputed from the store pin and the clock-in geofence from the team's home-base pin
  (Pengguna → Kelola Tim; a team without one isn't checked). Positions an Android phone reports as mocked (fake
  GPS) block clock-in/check-in in the app and are never geo-valid server-side. Client timestamps are bounded:
  nothing in the future or older than 7 days offline, a store check-in must fall inside an attendance, and a report
  or NTG step inside its visit (so nothing can be added after check-out). Reports carry a server `received_at`;
  the Validasi queue flags late syncs (>12 h), non-geo-valid visits and offtake outliers.
- ✅ **Evidence photos come from the camera** on the phone app (no gallery); the web app keeps a file picker.
- ✅ **Under-1 rule enforced everywhere** (PRD §6): a consumer with a child under one year never advances past
  "approached" — in the app and by a server trigger. The child's age is a bracket picker (no free text).
- ✅ **Consumer data (UU PDP) and funnel integrity** (migration 0015). Funnel stages only move forward and GWP /
  WA follow-up need a confirmed NTG. WhatsApp numbers are normalized, validated and unique across NCs, so one
  mother can't be counted as a new user twice. Consent is server-stamped (time, NC, consent-text version —
  `CONSENT_VERSION` in `src/config.ts`; bump it whenever `CONSENT_TEXT` changes). "Hapus Data Pribadi" on a consumer
  (creator NC, super_admin, PM) erases the personal data and quiz answers on request; funnel counts stay. **Open:**
  an automatic retention period (delete after N months) needs the client's decision.
- ✅ **Reckitt (client) view without staff PII.** Staff phone numbers moved to `profile_contacts` (own, super_admin,
  PM, own TL/ARCO); the client role no longer reads GPS trails, live positions or consumer-linked quiz answers.
  Clock-in/visit coordinates stay visible to it as part of attendance/visit KPIs.
- ✅ **Push tokens are private** (`push_tokens`, no client access); a device token belongs to the last user signed in
  on it and is cleared at logout; dead tokens are removed by `send-push`.
- ✅ **CSV exports are safe to open in Excel** (formula injection neutralized in `src/utils/csv.ts`).
- ✅ **Admin audit log** (migration 0016): account role/team/status changes, account creation and password resets
  (`admin-users`), team edits, store pin/assignment changes, targets, report reviews, scorecard weights and consumer
  erasures, with who did it — Pengguna → Log Aktivitas (super_admin) / dashboard (PM). Passwords: min. 8 characters
  with letters and digits, not containing the username.
- ✅ **Forgotten sessions close themselves** (0016): an hourly job closes visits left open at clock-out or for >12 h
  and attendances open >16 h, at the last recorded activity (marked "Ditutup otomatis"); a real clock-out/check-out
  synced later still replaces it. Clock-out offers to check out of an open store visit first.
- ✅ **Offtake outliers** are judged against the 7 WIB days before the offtake's own date (not the sync time).
- 🟨 **Maps** load Leaflet with Subresource Integrity and show the required attribution. Tiles default to
  OpenStreetMap's community server, which isn't meant for production scale — set `EXPO_PUBLIC_MAP_TILE_URL` /
  `EXPO_PUBLIC_MAP_TILE_ATTRIBUTION` (see `.env.example`) to a keyed provider before go-live.
- ✅ **One program clock: WIB.** Every day/week/month boundary in the app (dashboards, "today's reports",
  attrition signal, targets/scorecard months, history window) is computed in WIB — the zone the server uses for
  scorecards, outliers and report checks — so NCs in WITA/WIT cities (or with a phone set to another zone) land on
  the same day as their scorecard. Displayed clock times stay in the phone's own zone. See `src/utils/period.ts`.
- ✅ **Scores that mean what they say** (0017): the NC attendance KPI divides by working days (Mon–Sat —
  `work_days_between`; change it if the schedule differs), and a role with no computable KPI (Data Analyst; a Lead
  Trainer without certifications that month) gets no scorecard instead of a fabricated 0. The NC dashboard's
  phone-side figure is labelled field *discipline* and shown apart from the official server scorecard. The
  management dashboard has a month picker (any year); the Validasi rollup compares month-to-date offtake with the
  monthly target.
- ✅ **Consumer + funnel step are saved in one transaction** (`save_consumer_with_step`, 0017).
- ✅ **Management dashboard computed on the server** (`management_summary`, 0018) for any period / filter; it
  falls back to on-device rows when offline. Non-field roles therefore load only 14 days of the per-SKU report
  tables at login (`NON_FIELD_REPORT_HISTORY_DAYS`) instead of the program's full 62-day history.
  `consumers` load only for NCs (their own) and `ntg_gwp` only for field roles, for the 62-day window: a
  consumer's current funnel stage is kept on the consumer row by the server (`current_stage`, 0019), and the
  consumer screen fetches one consumer's full history when opened.
- ✅ **Crashes are visible**: an ErrorBoundary shows a recovery screen, and uncaught errors are logged to
  `client_errors` (0018, super_admin-readable, rate-limited). Sentry (`src/sentry.ts`) turns on when
  `EXPO_PUBLIC_SENTRY_DSN` is set in the EAS environment (plus `EXPO_PUBLIC_SENTRY_ENVIRONMENT=staging` for
  preview): native + JS crashes, no PII (user id only, URL query strings stripped). Source maps upload at build time
  once `SENTRY_ORG`, `SENTRY_PROJECT` and the secret `SENTRY_AUTH_TOKEN` are set on EAS (`app.config.js`).
- ✅ Code health: typed navigation (`src/navigation.ts`), shared `SkuPicker`, mappers out of the store, one
  table-driven realtime handler, per-row rollback of failed optimistic writes, forms ask before dropping SKU rows
  left empty.
- ✅ **Validation reviews whole reports, not SKU lines**: the Validasi queue shows one card per module per visit
  (e.g. a 20-SKU Stock Taking is one card) and Approve / Flag applies to all its lines in one write
  (`reviewReports`). The rules live in `src/utils/validation.ts` (tested) and also feed the TL/ARCO dashboard's
  team summary (working today, daily reports complete, exceptions, at-risk NCs, offtake vs target). Long lists
  render in pages (`ShowMore`).
- ✅ Store assignment has a searchable NC picker (own team / city first); the bottom tab bar and form footers clear
  the phone's home indicator (safe-area insets).
- ✅ UI polish: success confirmations are non-blocking toasts (`showToast`) — dialogs are kept for errors,
  decisions and things to read; colours on the navy surfaces are theme tokens (`onDark*`, `dark*`); Share of
  Shelf pre-fills channel/category from the store; no hard-coded "215 akun · 47 kota" figures.
- ✅ **PJP (journey plan)**: TL / ARCO / Super Admin / Admin Data Entry plan which stores each NC visits per day
  (Mon–Sat) on the "Jadwal Kunjungan" screen — per-week view, add/remove stores, copy last week. The server links
  each plan to the NC's check-in that day (`actual_visit_id`, 0020 — not client-settable), so the NC's "Rencana
  Kunjungan Hari Ini", the team PJP compliance and the Admin Data Entry PJP KPI are real. **Not yet:** CSV import
  of plans.
- ✅ **Chat notifications open the chat**: tapping a push (app running, in the background, or not running)
  opens that thread — after sign-in if needed; while the app is open a push shows as a banner unless that thread
  is already on screen (`src/notifications.ts`). Needs the updated `send-push` (it now puts the conversation in
  the payload) and a new app build.
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

## Push notifications (Android)

Chat pushes (PRD §17) go Expo → Firebase Cloud Messaging. One-time setup, per Firebase project:

1. **Firebase project + Android app** — console.firebase.google.com → Add project → Add app → Android, package
   `com.spc.ncworkforce` → download **google-services.json**. Don't commit it (gitignored; this repo is public).
2. **Give it to EAS builds** as a file secret (read by `app.config.js`):
   `npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview --environment production --visibility secret`
3. **FCM V1 key for Expo's push service** — Firebase → Project settings → Service accounts → *Generate new private
   key* (JSON), then `npx eas-cli credentials` → Android → any build profile → *Google Service Account* → *Manage your
   Google Service Account Key for Push Notifications (FCM V1)* → upload it. Delete the local JSON afterwards. The key
   belongs to the application identifier (`com.spc.ncworkforce`), so every profile — preview, production — uses it.
4. Rebuild (`npx eas-cli build -p android --profile preview`). Test: log in on the phone as an NC, allow
   notifications, background the app, send it a chat message from its TL.

## Go-live checklist (production)

The current project is a **demo/staging** project: it has the seeded demo accounts, whose passwords are public in
this repo. Production gets its own Supabase project.

1. **New Supabase project** (region: Singapore, closest to Indonesia). Run `supabase/migrations/0001` … `0021`
   in order — `npx supabase link --project-ref <prod-ref>` then `npx supabase db push --linked`, or the SQL Editor.
   Link the CLI back to staging afterwards (`npm run gen:types` and other `--linked` commands use the link). Authentication → Providers → Email → turn **off** "Allow new users to sign up".
   Database → Extensions: confirm **pg_cron** is enabled (0010 schedules the nightly scorecards).
2. **Do not run `npm run seed:supabase`** against production. Create the first Super Admin with the Supabase
   dashboard (Authentication → Add user, email `<username>@internal.spc`), then in the SQL Editor:
   `update profiles set role = 'super_admin', active = true where username = '<username>';`
3. **Edge functions**: `npx supabase functions deploy admin-users --project-ref <prod-ref> --use-api` and the same
   for `send-push`.
4. **EAS production env**: `npx eas-cli env:create --environment production` for `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` (the production values; plaintext visibility). `GOOGLE_SERVICES_JSON` is
   already set for production; the FCM V1 key is shared with preview (it's per package, not per profile).
5. **Real data**, in this order, as the production Super Admin: teams (Pengguna → Kelola Tim) → accounts (Import →
   Akun Pengguna CSV, then assign teams/TLs) → stores (Import → Toko CSV; set GPS pins via Store Detail → Ubah Data
   Toko) → each team's home-base pin + radius for the clock-in geofence (Pengguna → Kelola Tim) → products (Import → Master Produk) → monthly targets (Target Bulanan, CSV). Rehearse the whole sequence
   on staging first.
6. **Brand assets**: replace the placeholder icons in `assets/` (see Status & Gaps for sizes).
7. **Backups**: enable Point-in-Time Recovery (paid Supabase plan) or at least schedule daily logical backups
   before real field data exists.
8. **Smoke test** the new project: seed demo accounts on a *separate staging* project, not production — the smoke
   test needs them. Keep staging as the place to run `npm run smoke` after every migration.
9. **Build**: `npx eas-cli build -p android --profile production` (Play Store bundle). EAS environments pick the
   backend: `preview` (APK) → staging, `production` and `production-apk` → production. `production-apk`
   (`npm run build:production-apk`) is an installable APK against production, for testing before the store upload.

## Checks

- **Unit tests:** `npm test` (Node's built-in runner via `tsx`, no extra dependencies) — `src/**/*.test.ts` covering
  the offline-queue replay rules (`src/store/replay.ts`), periods/month keys/history window, KPI + attrition
  helpers, geo, and CSV. Keep React Native/Supabase-free logic in plain modules so it stays testable.
- **CI** (`.github/workflows/ci.yml`, runs on push/PR): `tsc`, `npm test`, `expo-doctor`
  (SDK version drift, missing assets), a web bundle via `expo export`, and a Deno type check of the edge functions.
- **Backend smoke test** (manual, writes to a real project — staging/demo only):
  `npm run smoke -- --project <project-ref>` — 47 RLS/RPC/edge-function checks as each demo role; see
  `scripts/smoke-rls.ts`. Run it after every migration or edge-function change. It and `seed:supabase` only run
  against projects listed in `STAGING_PROJECT_REFS` (`.env`) — the demo passwords are public, so never list production.
- **DB types:** `src/lib/database.types.ts` is generated from the live schema and types the Supabase client and
  the row mappers. After a migration, `npx supabase link --project-ref <ref>` (once) then `npm run gen:types`,
  and commit the result — `tsc` then flags code that no longer matches the schema.

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
App.tsx                    # navigation (typed stack) + login gate + tab set per role + ErrorBoundary
index.ts                   # entry point; registers the background location task
src/
  config.ts                # role labels, geofence/tracking/auto-close constants, consent text, brackets
  types.ts                 # domain model (mirrors the Postgres schema)
  navigation.ts            # RootStackParamList — every route + params, typed navigate/useAppRoute
  lib/supabase.ts          # Supabase client
  lib/database.types.ts    # generated schema types (npm run gen:types)
  store/useStore.ts        # zustand store: session/offline boot, realtime mirror, all write actions
  store/mappers.ts         # Postgres row <-> app type mapping (pure, tested)
  store/replay.ts          # offline-queue replay rules + queue/network decisions (pure, tested)
  store/rows.ts            # optimistic-write rollback helper (pure, tested)
  store/seed.ts            # demo data; only used by scripts (seed + smoke), not the running app
  tasks/locationTask.ts    # background GPS task -> routeBuffer (works headless)
  utils/                   # period (WIB program clock), kpi, geo, routeBuffer/routeSync, offlineQueue,
                           # offlineCache, storage (photos), wa, funnel, password, csv, export, errorReport
  components/              # UI kit, dialog host, TrackingWatcher, SkuPicker, EvidencePhotoField,
                           # LeafletMap, LiveTeamMap, ErrorBoundary
  screens/                 # one file per screen (field reports, validation, dashboards, admin)
supabase/
  migrations/0001…0021     # schema, RLS, triggers, RPCs — run in order (see Backend)
  functions/admin-users    # account creation / password reset (service role, audit-logged)
  functions/send-push      # chat push notifications (push_tokens)
scripts/seed-supabase.ts   # seed demo accounts + stores into a demo/staging project
scripts/smoke-rls.ts       # backend smoke test (RLS, RPCs, triggers, edge functions)
eas.json                   # EAS build profiles (development/preview/production)
```
