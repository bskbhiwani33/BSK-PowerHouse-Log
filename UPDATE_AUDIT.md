# BSK 30-Update Implementation Audit

Audit basis: source code on branch `bsk-complete-update-prep`, updated after report/history improvements. This remains a source-code review, not a live-system test.
This is a source-code audit only. It does not mean the features have passed end-to-end testing or are live on Netlify.

Status meanings:
- **Present**: a corresponding implementation is visible in the current source; runtime verification is still required.
- **Partial**: some implementation exists, but the requested feature needs completion or stronger verification.
- **Not found**: no corresponding implementation was found in the reviewed source.

Current source-audit count: **32 Present · 0 Partial · 0 Not found** (including the two additional Staff/Breakdown requests added on 2026-11-10). This is not a production sign-off; live Firebase/Netlify and Android device checks remain release gates.

| # | Requested update | Source audit status | Notes / remaining work |
|---|---|---|---|
| 1 | Dashboard: only ongoing Breakdown/Shutdown counts and feeder names | Present | Live outage dashboard renders ongoing counts and lists; Admin refreshes every 60 seconds and immediately when the app becomes visible again. Verify role visibility and multiple feeders on device. |
| 2 | Tripping entry: only number of trippings and number of feeders | Present | Form has exactly the two requested numeric inputs; date is hidden/automatic. |
| 3 | Breakdown/Shutdown entry with feeder, date, start, optional end, reason | Present | Separate forms and resolve workflow exist; verify overnight duration and simultaneous outage constraints. |
| 4 | Five Power House consumption readings, automatic total, history and Excel | Present | Five fields, client/server total calculation, history list and Consumption Excel exist; verify units/rounding and larger datasets. |
| 5 | Feeder status Running/Breakdown/Shutdown | Present | Canonical `feeder_status` records are written on ongoing outage and reset on resolution. Staff pagination filters by Power House and orders by document ID; verify paging against live data. This query does not add a separate composite index definition. |
| 6 | Feeder history | Present | Feeder search applies date range and displays loaded history; Load All History retrieves older pages. Backend rejects malformed/expired cursors and invalid Firestore document IDs. Refresh and paging share a lock; periodic refresh now updates only the newest page and preserves older pages in memory instead of re-downloading all history. Runtime verification remains. |
| 7 | Automatic Breakdown duration | Present | Duration is calculated from start to end/current time for display; verify date/time edge cases. |
| 8 | Repeat-Breakdown report | Present | Repeat counts are grouped by feeder ID and filtered by date/search. The report now warns when only partial history is loaded; complete historical counts require loading all pages first. |
| 9 | Feeder-wise report | Present | A dedicated feeder-wise breakdown/shutdown count summary is present and warns when older history pages remain unloaded. |
| 10 | Daily summary | Present | Daily entry counts show category-separated totals across loaded record types and warn when history is incomplete; full-history verification remains. |
| 11 | Monthly report | Present | Monthly entry counts show category-separated totals and warn when history is incomplete; full-history verification remains. |
| 12 | Date-wise search | Present | From/to filters apply to record history, feeder history, reports, charts, audit history and three dedicated Excel exports. Clearing report filters refreshes feeder history and charts; verify all combinations in runtime. |
| 13 | Excel download (general) | Present | Combined multi-sheet Excel export added for Breakdown, Shutdown, Tripping, Consumption and Daily Reports; date/search filters apply to loaded records. SpreadsheetML text is now sanitized for XML 1.0 invalid control characters in the combined and dedicated exports. |
| 14 | PDF report | Present | Print-ready report opens in a separate window, hides edit controls, uses print margins and keeps report cards together; browser print can save as PDF. Browser/WebView print support and filtered layout still need runtime testing. |
| 15 | Staff login with individual login ID | Present | User ID + PIN login and Admin provisioning support one active Staff account per Power House; verify login and staff isolation in runtime. |
| 16 | Staff-wise entry history | Present | Staff API responses include only the signed-in Staff member's own audit events and omit the Admin notification feed; Admin retains full house-level history and notifications. Staff offline record caches are now isolated by authenticated UID to prevent cross-account cached-history exposure. Staff history and Admin staff-wise created-entry counts apply date/search filters; counts exclude later resolve/edit audit actions. Runtime verification remains. |
| 17 | Admin dashboard/reporting | Present | Admin dashboard, management forms, report views and operational records are present; end-to-end checks remain. |
| 18 | Edit history (who changed record and when) | Present | Update/resolve operations write before/after audit entries with actor and timestamp. |
| 19 | Staff cannot delete old records | Present | No staff delete UI/API action is exposed; Firestore direct writes are denied. Verify all routes remain protected. |
| 20 | Ongoing Breakdown alert | Present | Separate in-app Breakdown long-running alert section appears at 24+ hours; push/background delivery is not included. |
| 21 | Ongoing Shutdown alert | Present | Separate in-app Shutdown long-running alert section appears at 24+ hours; push/background delivery is not included. |
| 22 | New entry notification to Admin | Present | New-entry notifications are saved transactionally and shown with unread count in Admin dashboard; only Admin can mark them read. Push/background delivery is not included. |
| 23 | Pending Entry Alert = unread notifications, not approval queue | Present | Unread notification count and Mark Read action exist; no approval/reject queue is present. |
| 24 | Hindi + English toggle | Present | Toggle covers all static page labels/placeholders, common login/Admin/server validation messages, backup/pagination, offline queue status and browser alerts. Raw breaker status codes intentionally remain in English; free-text data is generally shown in the language entered. Dynamic edge-case messages and full device coverage still need testing. |
| 25 | Dark Mode | Present | Theme toggle and local preference persistence exist; visual coverage needs device testing. |
| 26 | Search by Feeder/date | Present | Feeder-name search and date-range filters are available across operational history, feeder history, reports, charts and exports; controls are separate by view rather than one global search. Runtime combinations still need testing. |
| 27 | Dashboard charts | Present | Record-count and monthly activity bar charts now respond to date/search filters; validate in runtime. |
| 28 | Backup system | Present | Admin can export a paginated JSON backup across operational and security-support collections, including staff-house assignments, normalized Staff User ID claims and the Admin setup guard. Backup includes format/schema/project/exporter metadata and per-collection row counts, validates every page response, rejects malformed/expired cursors and guards repeated cursors. Restore workflow is not included; PIN hashes/salts are excluded. Backup integrity still needs a live-data test. |
| 29 | Offline entry + sync on reconnection | Present | Local outbox, stable IDs, transactional idempotency, guarded single-run sync, queue merging that preserves entries added during sync, online/visibility/periodic retry and storage-quota warning exist. Existing registration in app.js activates the service worker, which caches the app shell for offline reload while API routes remain network-only. Operational record caches are isolated per Staff UID; login/logout resets in-memory records and pagination. Cache quota failures no longer replace fresh server data with stale cached records; offline reload, sync and WebView device testing remain. |
| 30 | Three separate Excel downloads with date filtering | Present | Separate Breakdown, Shutdown and Consumption Excel exports use From/To date filters and the shared XML 1.0 text sanitizer. |
 
## Important project constraints
- Work only on `bsk-complete-update-prep`.
- Do not deploy to Netlify, publish Firestore Rules, push/merge to `main`, or build APK until final tests and explicit user approval.
- Do not reintroduce Admin Approval/Reject. Staff entries must save immediately and appear in the dashboard; preserve audit history.
- Batch changes for a single Netlify deployment and build the Android APK only once after all changes and tests.
- The hosted app uses a network-first service worker for static assets, excludes Netlify API responses from cache, and increments the shell cache version when release assets change; the Android WebView should continue loading the hosted URL so website releases can appear without rebuilding the APK. Verify on the installed APK before release.
- Android WebView changes are deferred until the website's 30 updates are completed and tested.

## Remaining work before production sign-off (runtime verification, not feature coding)
1. Confirm the latest preparation-branch CI run passes JavaScript syntax, Firebase config parsing, Netlify function bundling, and Firestore Rules emulator tests.
2. Verify the 15 composite index definitions in this branch against Firebase. The prior Firebase CLI comparison found an exact 15/15 match and the Firebase console showed all 15 Enabled; repeat this check if index definitions change. Publish indexes only if any required definition is missing, then wait until it is READY before the website deployment.
3. After the single Netlify deployment, smoke-test Admin/Staff login, immediate Staff entry visibility, outage create/resolve, consumption totals, notifications, pagination, exports, and backup against live Firebase data.
4. Verify date/time edge cases, Hindi labels/messages, dark mode, filtered PDF print layout, and large-history pagination in a browser.
5. Verify offline shell reload, queued entry sync, and account isolation on the actual Android WebView device.
6. Confirm the hosted website update appears in the installed WebView app without a native rebuild; then build the APK once only if the native wrapper itself needs an update.
7. Publish restrictive Firestore Rules only after the new hosted app is active and old clients have refreshed; repeat the live smoke tests.

Known scope limits (not to be mistaken for completed runtime checks):
- Alerts and new-entry notifications are in-app only; push/background notifications are not implemented.
- Backup is a paginated JSON export; a restore/import workflow is not included.
- PDF output uses the browser print dialog / Save as PDF; WebView print support needs device verification.
- Hindi mode translates app UI and common messages; user-entered free text and raw breaker status codes are not translated.
- Offline queue, WebView cache refresh, and Android behavior are source-implemented but still need real-device testing.


## Feeder status consistency review
- The feeder status/history search now derives the displayed live state from the ongoing Breakdown and Shutdown records returned by the records API. This avoids a stale `feeder_status` document overriding a currently ongoing outage in the UI. The records API explicitly merges all ongoing outages into each history page, so the status calculation does not depend on loading every historical page.
- This is a source-level correction; live Firebase/Netlify and Android WebView behavior still requires pre-release testing. No production deployment, Firestore Rules publication, or APK build was performed. The existing 15 composite indexes were previously checked against Firebase and found matching and Enabled.


## Ongoing outage integrity review
- Outage creation now checks both Breakdown and Shutdown collections for an existing ongoing record for the selected feeder inside the same Firestore transaction, in addition to checking `feeder_status`. This prevents a stale or missing feeder-status document from allowing a second ongoing outage to be created for that feeder.
- The feeder status/history search derives the visible live status from ongoing outage records returned by the API. Both changes are source-level safeguards and still require runtime verification against the Firebase emulator and a test Power House before release.


## Report search filter refresh
- The shared feeder/staff search input now refreshes record history, daily reports, feeder status/history, alerts, charts, and report summaries immediately as the user types. Previously, date filters refreshed these views but typing in the shared search field did not consistently refresh them until another render-triggering action.
- Source-level correction only; browser/device regression testing remains part of final verification.


## Staff history and search rendering review
- Confirmed the Staff "Load Older Records" control is wired to the shared paginated records API and uses the same guarded history-loading lock as Admin pagination.
- Removed a duplicate `recordsSearch` input listener. The shared search now has one refresh path, avoiding repeated rendering of history, reports, feeder status, alerts and charts for each keystroke.
- This is source review plus CI syntax/bundle/rules coverage; actual browser/device pagination and offline-sync tests remain outstanding.


## Staff audit-history pagination correction
- Found that Staff audit entries were filtered by actor UID only after fetching each page. In busy Power Houses, other Staff members' entries could consume pages and hide the current Staff member's older history.
- The records API now applies the authenticated Staff UID as a Firestore query filter before pagination and rejects cursors belonging to another Staff account.
- Added the composite index for houseId + actorUid + createdAt descending to the preparation branch. The prior Firebase CLI comparison found the full 15-index set matched Firebase and the console showed all 15 Enabled; re-check if this index definition changes.
- Runtime validation of the new composite query/index remains part of the release checklist; CI will verify syntax, bundles and Firestore rules, but does not publish the index.


## Active-outage transaction query optimization
- Limited the cross-collection duplicate-outage transaction checks to records whose status is `ongoing`, rather than reading every historical Breakdown and Shutdown for the feeder on every new outage entry.
- Added composite indexes for feederId + status on both outage collections. The query still checks both collections in the same transaction. The prior Firebase CLI comparison found the full 15-index set matched Firebase and the console showed all 15 Enabled.
- Latest CI syntax, Netlify bundle and Firestore Rules emulator checks have passed. Real Firebase data-path testing remains a release prerequisite; the 15 composite indexes were previously confirmed Enabled.


## Stale feeder-status recovery
- Reviewed the outage creation transaction and found that a stale `feeder_status` document could reject a new outage even when both Breakdown and Shutdown collections contained no ongoing event for that feeder.
- The transaction now treats active outage records in both collections as the source of truth for duplicate prevention; when none exists, the new outage transaction writes the current status and replaces the stale status document.
- This avoids a false permanent block while retaining the cross-collection transaction check. Latest CI syntax, Netlify bundle and Firestore Rules emulator checks have passed; live Firebase testing remains pending. The existing 15 composite indexes were previously confirmed Enabled.


## Service-worker registration review correction
- A deeper search confirmed that `app.js` already registers `/sw.js` on HTTPS; the earlier review missed this existing module-level registration.
- Removed the extra duplicate registration that had briefly been added to `index.html`. The original single registration remains in `app.js`; the worker stays network-first for app assets and does not cache Netlify API routes.
- Offline form submission, shell reload, queued sync and WebView behavior still require real-device testing.


## House-scoped ongoing-outage page reads
- The records API now applies the Staff/Admin selected Power House filter directly to the ongoing Breakdown and Shutdown queries, rather than fetching ongoing events across every Power House and filtering them afterward.
- Added houseId + status composite indexes for both outage collections. This narrows backend reads while keeping ongoing feeders visible on every history page.
- The 15-index set was previously found to match Firebase exactly and all indexes were shown Enabled; Latest CI syntax, Netlify bundle and Firestore Rules emulator validation passed. Re-check index readiness if the index file changes before release.


## Expanded Firestore rules regression coverage
- Added emulator assertions that authenticated Staff and Admin cannot directly read or write backend-only `trippings`, `consumption_readings`, `feeder_status`, `entry_history`, `notifications`, or `login_attempt_limits` documents.
- This complements existing house-scope checks for Power Houses, feeders and daily reports, and verifies that legacy `edit_requests` remains inaccessible.
- Latest CI run #228 passed the expanded emulator suite; no rules were published to Firebase.

- Further assertions cover Admin access to user/legacy approval records and anonymous denial for Power House reads/writes; these remain denied by client Firestore rules.


## One-shot release order (not executed)
1. Freeze source changes on this preparation branch and confirm latest CI success.
2. Re-check the 15 Firestore composite indexes against the current `firestore.indexes.json`. They were previously found to match the branch definitions and all were Enabled. If any are missing, publish only indexes first (additive): `firebase deploy --only firestore:indexes --project testing-app-8af35`, then wait until every required index reports READY.
3. Merge this branch to `main` exactly once to trigger the single Netlify production deployment. Do not make follow-up code commits to `main`.
4. Smoke-test the new Admin/Staff app and Netlify API while the existing Firestore rules remain in place. The old live `main` app writes daily reports directly, while the new app routes these writes through the audited API.
5. After confirming the new app is active and users have refreshed/reopened it, publish the restrictive Firestore Rules: `firebase deploy --only firestore:rules --project testing-app-8af35`. Do not publish these rules before the Netlify update, because they deny direct client writes to `daily_reports` and would break the old live app.
6. Re-test Admin/Staff login, immediate entry visibility, outage create/resolve, consumption totals, notifications, pagination, Excel/PDF, and offline/reconnect behavior.
7. Only after those checks, perform the one final Android APK build from the prepared project and verify it loads the deployed URL.
- No step above has been executed; this is a release checklist only.


## Live-main compatibility finding
- The current `main` branch still writes `daily_reports` directly from `app.js`; it does not yet use the staged `records.mjs` API for that action.
- The staged Firestore Rules deny direct client writes to `daily_reports`. Therefore the rules must be published only after the one Netlify deployment has replaced the old app code and the new app has passed smoke tests.
- Adding indexes is non-breaking, so any genuinely missing index can be published before the website. The current 15-index set was previously found matching and Enabled in Firebase.


## Hindi translation coverage improvement
- Added Hindi mappings for common login, Admin, validation, cursor/pagination, backup, PDF and offline-sync messages.
- Replaced collection-specific backup failure strings with stable translatable messages. The language feature is marked Present at source level; uncommon dynamic messages and full screen/device coverage still need review.

- Static visible text on the current page was compared against the Hindi dictionary; only the BSK brand and raw breaker status values remain intentionally untranslated. Added a Hindi footer label and dynamic offline queue / backup-failure prefix handling.

- Routed the PDF pop-up warning, empty daily-report warning and login-restoration alert through the selected-language alert helper so browser alerts respect Hindi mode too.


## Foreground dashboard refresh
- Added an immediate records/dashboard refresh when the app returns to the foreground, while retaining the existing 60-second polling interval and offline/hidden-tab guards. This helps Admin see Staff entries promptly without doubling continuous Firestore read traffic.


## Lower-read-cost history refresh
- Changed periodic/dashboard refresh to fetch the newest records page only, merge it with older pages already loaded in memory, and keep the new first-page cursor for later pagination.
- Older pages remain visible; full-history exports remain blocked until the cursor chain is loaded completely again. This avoids re-reading every historical page on each 60-second Admin poll while preserving completeness safeguards.

- The latest-page merge also reconciles ongoing Breakdown/Shutdown records against the API's complete active-outage set, so an older cached outage that has been resolved is not left incorrectly marked ongoing. Admin edits trigger a one-time full-history reload to refresh older changed records.

- The resolve form now updates the just-resolved event in the local history before refreshing, so the event does not disappear from the visible older-page cache while the backend's active-outage reconciliation removes it from ongoing counts.
- The locally resolved outage state is also written to the account-scoped records cache before the refresh, so a transient read failure does not restore the old ongoing state from stale cache.
- If the newest-page refresh fails, the in-memory history is restored instead of replacing it with a possibly older/incomplete local cache.
- When another Staff account resolves an older outage, the latest audit page is used to update the cached historical event to its resolved state where available, instead of simply dropping it from the old-page cache.
- The explicit full-history reload used after Admin edits also restores the last successful in-memory page set if a later page request fails, rather than replacing it with an older cache snapshot.


## Final pre-release audit correction
- Corrected the Service Worker static-asset extension matcher in `sw.js`; the prior extra escaping prevented the intended extension match for non-shell static assets. The app-shell assets were already explicitly listed, but this improves offline caching for additional static resources.
- The correction is on the preparation branch only. It has not been deployed to Netlify and has not been verified on an Android device.


## Staff account isolation and one-Staff-per-house enforcement
- The Records API now rejects Staff accounts without a valid Power House assignment before any house-scoped record query can run.
- Admin Staff provisioning now uses a Firestore transaction and a deterministic per-house assignment document to prevent concurrent creation of multiple active Staff accounts for the same Power House. It also reserves a normalized User ID claim transactionally to prevent concurrent duplicate User IDs.
- Existing active Staff accounts are detected during migration even if no assignment document exists yet. Inactive/deleted assignments can be replaced by a new Staff account.
- The new `staff_house_assignments` and `staff_user_id_claims` collections are server-only; the Firestore client rules have no allow rule for them, so direct client access remains denied by default.
- This is a source-level security correction. Verify transaction behavior and Staff/Admin provisioning in the Firebase emulator and then in the post-deploy smoke test; no production deploy or Rules publication has occurred.

- First-time Admin creation is also guarded by a transactional singleton document, so two simultaneous setup requests cannot create multiple Admin accounts. The setup guard collection is server-only and covered by the Firestore Rules denial tests.
- Firestore Rules emulator coverage now explicitly checks that Staff and Admin clients cannot read or write the new Staff assignment, User ID claim, and Admin setup guard collections.

- Login now rejects unsupported account roles and Staff accounts with a missing, malformed, or inactive Power House assignment before issuing a Firebase custom token.
- Breakdown and Shutdown creation now reads the shared feeder-status document within its Firestore transaction. This serializes concurrent outage submissions for the same feeder so a simultaneous Breakdown and Shutdown cannot both pass the ongoing-outage check based on stale parallel reads.


## Backup coverage correction
- The Admin backup export allowlist now includes `staff_house_assignments`, `staff_user_id_claims`, and `admin_setup_guard`, in addition to operational collections. These metadata collections are needed to preserve the one-Staff-per-house, normalized User ID reservation, and single-Admin setup safeguards in a complete export.
- User PIN salts and hashes remain excluded from the export. This change is committed on `bsk-complete-update-prep` only; backup/restore is still export-only and has not been tested against live Firebase data.


## Additional Staff / Breakdown requests (2026-11-10)
- **31. Remove Daily Feeder Report from Staff login:** Removed the complete Daily Feeder Report form from the Staff screen and removed its Staff-side submit handler. The Admin's legacy Daily Reports/history/export view and existing stored records are retained for backward compatibility; no existing data is deleted.
- **32. Breakdown PTW time:** Added a required Staff input labelled “PTW Taken on Time” between Start Time and End Time. The time is saved in the Breakdown document and creation audit snapshot, can be edited by Admin with an audit event, appears in Breakdown history, and is included in the dedicated Breakdown Excel and combined Excel export. Backend validates the time format when supplied.
- Updated the service-worker shell cache version so the hosted WebView/PWA refreshes the changed HTML and JavaScript assets. Device-level refresh verification remains pending.
- Source edits are on the preparation branch only. No Production deployment, Firestore Rules publication, main-branch update, or APK build was performed.


## Staff Supply Position and two-section navigation (2026-11-10)
- Added exactly two Staff choices after Staff Operations: **Supply Position** and **Consumption Data**. Consumption Data contains the existing Consumption readings and all existing Breakdown, Shutdown, Resolve and Tripping forms; those forms and their underlying record collections are retained.
- Added Supply Position capture for three daily slots (1st, 2nd, 3rd) with report time. Every active feeder must be recorded as Running, Breakdown, or Direct Shutdown.
- Breakdown requires start time, PTW Taken on Time and reason; end time may be blank while ongoing. Direct Shutdown requires start time and reason; end time may be blank. Running needs no outage details.
- Supply Position is saved separately in `supply_positions`, with Power House/date/slot/time, feeder details and counts, and generates audit history and an Admin notification. The server verifies the authenticated Staff house and requires every active feeder exactly once.
- Supply Position history is shown to Staff and Admin record history. Combined Excel and JSON backup include the new collection. Offline queue supports Supply Position submissions.
- Supply Position history uses the stable document-ID order with the existing houseId equality filter; the client sorts the loaded reports by date. This avoids requiring a new composite Firestore index or a separate Firebase index deployment.
- Incremented Service Worker cache version to v6. No Production deploy, Firestore Rules publication, main update, or APK build was performed.


## Simplified Daily Supply Position (2026-11-10)
- Removed the 1st/2nd/3rd selector and Report Time from the Staff Supply Position form. Staff now selects the date and marks every active feeder with mutually exclusive **Closed** or **Opened** checkboxes.
- Closed is stored as the existing Running status (supply position OK). Opened is stored as Breakdown and reveals required Breakdown Time and PTW Taken on Time fields. The server continues validating the authenticated Staff Power House and requires every active feeder exactly once.
- Supply Position history and Excel now show feeder-level status, Breakdown Time and PTW time without slot/report-time labels. Previously saved records with legacy slot/time fields remain readable.
- Legacy “Direct Shutdown” values are displayed/exported as “Shutdown”; the backend remains compatible with legacy Shutdown rows.
- No Production deploy, Firestore Rules publication, main-branch update, or APK build was performed.

- Follow-up refinement: when a feeder is marked Opened, Staff must choose Breakdown or Shutdown. Breakdown requires Breakdown Time and PTW Taken on Time; Shutdown requires PTW Taken on Time and Reason only (no Breakdown Time). Both values appear in history and Excel.

## Legacy Supply Position history compatibility
- Staff and Admin history now normalize legacy `Direct Shutdown` to the displayed `Shutdown` status before choosing the detail fields, so legacy shutdown rows also show their saved PTW time and reason.
- This is a source-level compatibility fix; it must pass the same CI and refreshed Netlify Preview checks as the release candidate.
