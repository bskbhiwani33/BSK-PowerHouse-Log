# BSK Migration Audit — 2026-11-11

Status: source audit in progress. This document is not a production release and does not authorize publishing Firestore Rules, merging the preparation PR, changing live Firebase data, or disabling Netlify.

## Source baseline reviewed

Branch: `bsk-complete-update-prep`

Reviewed:
- `app.js`
- `index.html`
- `netlify/functions/login.mjs`
- `netlify/functions/admin.mjs`
- `netlify/functions/create-admin.mjs`
- `netlify/functions/records.mjs`
- `firestore.rules`
- `firestore.indexes.json`
- `firebase.json`
- `netlify.toml`
- `sw.js`
- `STANDALONE_ANDROID_PLAN.md`

## Current backend surface

### Authentication
- User ID + four-digit PIN is checked server-side using salted scrypt hashes.
- Successful login issues a Firebase custom token with role and house claims.
- The preparation branch adds login throttling, validates the role, and checks the active Power House assignment for Staff.
- Service-account credentials are read from the server environment; they must never be embedded in Android or browser assets.

### Admin API
- Dashboard data, Power House and Feeder create/update/deactivate/restore, and Staff creation are handled by `admin.mjs`.
- Preparation branch adds audited house/feeder corrections and transactional Staff assignment/unique-ID claims.
- Admin actions verify the Firebase ID token and the active Admin profile in Firestore.

### Records API
The preparation branch exposes these actions:
- `createBreakdown`, `createShutdown`
- `resolveBreakdown`, `resolveShutdown`
- `createDailyReport`
- `createTripping`, `createConsumption`, `createSupplyPosition`
- `updateRecord`
- `getRecords`, `exportBackupPage`, `markNotificationRead`

Operational records, audit history, feeder status, and notifications are written using Firebase Admin SDK transactions. The API checks the caller's role and Staff house assignment.

## Important migration findings

1. The default `main` branch does not contain `netlify/functions/records.mjs`, while the preparation branch does. The production branch and preparation branch are therefore not interchangeable. Any future cutover must use a single, reviewed, tested source baseline.
2. The app currently calls three Netlify endpoints: `/.netlify/functions/login`, `/.netlify/functions/admin`, and `/.netlify/functions/records`. The current Android wrapper also loads the Netlify website URL. Netlify is still a runtime dependency today.
3. `firebase.json` currently configures Firestore rules/indexes and the Firestore emulator only. It does not yet configure Firebase Hosting or Cloud Functions.
4. Firestore Rules deliberately deny client writes to operational collections. The existing server functions use the Admin SDK and bypass those client rules. A migration must preserve this server-side authorization boundary; putting privileged writes directly in the Android client or loosening rules is not an acceptable shortcut.
5. `supply_positions` has no explicit match block in `firestore.rules`; it is consequently denied by the default Firestore rule behavior. The current Records API accesses it through the Admin SDK. If direct client reads are ever introduced, they require a deliberate, tested rule rather than an accidental broad allow.
6. The existing PWA service worker is not a replacement for an Android update system. The current WebView Activity loads the Netlify URL and clears WebView cache on startup; that is not a local, integrity-checked remote-bundle architecture.
7. The repository snapshot does not contain the Android Studio project source. Native Android work must be completed against the user's existing Android project files; it cannot be built or device-tested from this repository alone.

## Validation correction made on this branch

- The Breakdown form marks PTW Taken on Time as required and sends `ptwTakenOnTime`, but the Records API previously accepted a missing PTW time if a caller bypassed browser form validation.
- Updated `netlify/functions/records.mjs` so a Breakdown create request must contain a valid PTW time at the server boundary too. This keeps backend validation aligned with the current form.
- Shutdown form currently has no PTW field; no new requirement was added to that separate form. The Daily Supply Position flow separately validates Breakdown time + PTW time and Shutdown PTW time + reason.
- This is a source-level correction only. The GitHub Actions status for this new commit has not yet been returned; do not treat it as tested or production-ready.

## Required migration design

- Keep Firebase as the system of record and preserve existing collection names/document shapes.
- Port the three privileged Netlify endpoints to Firebase-managed HTTPS functions (or an equivalently secure server runtime) before changing the Android app's API base.
- Keep service-account credentials server-side only.
- Implement versioned remote web assets with a signed/verified manifest, SHA-256 verification, app-private staging, atomic activation, last-known-good rollback, and offline startup.
- Keep offline queued records intact across asset updates.
- Treat native code/permission/SDK changes separately: these still require an APK update and an approved distribution channel.
- Do not turn off Netlify until the Firebase backend and Android client have passed cutover tests.

## Test gates before any production cutover

- Existing Admin and Staff accounts can log in; invalid PIN, inactive user, inactive house, wrong role, and rate-limit cases behave correctly.
- Staff cannot access another Power House's feeders or records, cannot perform Admin actions, and cannot see another Staff member's audit history.
- Breakdown/Shutdown create, ongoing state, resolve, feeder-status update, and duplicate offline retry are consistent.
- Supply Position, Tripping, Consumption, Daily Report, edit history, notifications, paginated history, and complete backup export preserve their data formats.
- Existing Firestore Rules remain restrictive; all required composite indexes are deployed and verified.
- Android fresh install, offline launch, interrupted update, invalid checksum, rollback, app restart, and queued-record sync are tested on a physical device.
- Routine UI/business-logic asset update is demonstrated without an APK reinstall.
- A native Android change is correctly identified as requiring a new APK.
- Compare record counts and sample documents before/after migration; no live data is deleted or rewritten as part of cutover.

## Release status

No production deploy, Firestore Rules publication, live database migration, Netlify shutdown, or APK build has been performed as part of this audit.
