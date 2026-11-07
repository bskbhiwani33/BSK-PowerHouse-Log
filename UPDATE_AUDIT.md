# BSK 30-Update Implementation Audit

Audit basis: source code on branch `bsk-complete-update-prep`, updated after report/history improvements. This remains a source-code review, not a live-system test.
This is a source-code audit only. It does not mean the features have passed end-to-end testing or are live on Netlify.

Status meanings:
- **Present**: a corresponding implementation is visible in the current source; runtime verification is still required.
- **Partial**: some implementation exists, but the requested feature needs completion or stronger verification.
- **Not found**: no corresponding implementation was found in the reviewed source.

Current source-audit count: **30 Present · 0 Partial · 0 Not found**. This is not a production sign-off; live Firebase/Netlify and Android device checks remain release gates.

| # | Requested update | Source audit status | Notes / remaining work |
|---|---|---|---|
| 1 | Dashboard: only ongoing Breakdown/Shutdown counts and feeder names | Present | Live outage dashboard renders ongoing counts and lists; Admin refreshes every 60 seconds and immediately when the app becomes visible again. Verify role visibility and multiple feeders on device. |
| 2 | Tripping entry: only number of trippings and number of feeders | Present | Form has exactly the two requested numeric inputs; date is hidden/automatic. |
| 3 | Breakdown/Shutdown entry with feeder, date, start, optional end, reason | Present | Separate forms and resolve workflow exist; verify overnight duration and simultaneous outage constraints. |
| 4 | Five Power House consumption readings, automatic total, history and Excel | Present | Five fields, client/server total calculation, history list and Consumption Excel exist; verify units/rounding and larger datasets. |
| 5 | Feeder status Running/Breakdown/Shutdown | Present | Canonical `feeder_status` records are written on ongoing outage and reset on resolution. Added a houseId + document-ID composite index for Staff pagination of feeder status; index deployment remains deferred until final release. |
| 6 | Feeder history | Present | Feeder search applies date range and displays loaded history; Load All History retrieves older pages. Backend rejects malformed/expired cursors and invalid Firestore document IDs. Refresh and paging share a lock; periodic refresh now updates only the newest page and preserves older pages in memory instead of re-downloading all history. Runtime verification remains. |
| 7 | Automatic Breakdown duration | Present | Duration is calculated from start to end/current time for display; verify date/time edge cases. |
| 8 | Repeat-Breakdown report | Present | Repeat counts are grouped by feeder ID and filtered by date/search. The report now warns when only partial history is loaded; complete historical counts require loading all pages first. |
| 9 | Feeder-wise report | Present | A dedicated feeder-wise breakdown/shutdown count summary is present and warns when older history pages remain unloaded. |
| 10 | Daily summary | Present | Daily entry counts show category-separated totals across loaded record types and warn when history is incomplete; full-history verification remains. |
| 11 | Monthly report | Present | Monthly entry counts show category-separated totals and warn when history is incomplete; full-history verification remains. |
| 12 | Date-wise search | Present | From/to filters apply to record history, feeder history, reports, charts, audit history and three dedicated Excel exports. Clearing report filters refreshes feeder history and charts; verify all combinations in runtime. |
| 13 | Excel download (general) | Present | Combined multi-sheet Excel export added for Breakdown, Shutdown, Tripping, Consumption and Daily Reports; date/search filters apply to loaded records. SpreadsheetML text is now sanitized for XML 1.0 invalid control characters in the combined and dedicated exports. |
| 14 | PDF report | Present | Print-ready report opens in a separate window, hides edit controls, uses print margins and keeps report cards together; browser print can save as PDF. Browser/WebView print support and filtered layout still need runtime testing. |
| 15 | Staff login with individual login ID | Present | User ID + PIN login and Admin provisioning support multiple active staff accounts per Power House; verify login and staff isolation in runtime. |
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
| 28 | Backup system | Present | Admin can export a paginated JSON backup across operational collections. Backup includes format/schema/project/exporter metadata and per-collection row counts, validates every page response, rejects malformed/expired cursors and guards repeated cursors. Restore workflow is not included; PIN hashes/salts are excluded. Backup integrity still needs a live-data test. |
| 29 | Offline entry + sync on reconnection | Present | Local outbox, stable IDs, transactional idempotency, guarded single-run sync, queue merging that preserves entries added during sync, online/visibility/periodic retry and storage-quota warning exist. Existing registration in app.js activates the service worker, which caches the app shell for offline reload while API routes remain network-only. Operational record caches are isolated per Staff UID; login/logout resets in-memory records and pagination. Cache quota failures no longer replace fresh server data with stale cached records; offline reload, sync and WebView device testing remain. |
| 30 | Three separate Excel downloads with date filtering | Present | Separate Breakdown, Shutdown and Consumption Excel exports use From/To date filters and the shared XML 1.0 text sanitizer. |
 
## Important project constraints
- Work only on `bsk-complete-update-prep`.
- Do not deploy to Netlify, publish Firestore Rules, push/merge to `main`, or build APK until final tests and explicit user approval.
- Do not reintroduce Admin Approval/Reject. Staff entries must save immediately and appear in the dashboard; preserve audit history.
- Batch changes for a single Netlify deployment and build the Android APK only once after all changes and tests.
- The hosted app uses a network-first service worker for static assets, excludes Netlify API responses from cache, and increments the shell cache version when release assets change; the Android WebView should continue loading the hosted URL so website releases can appear without rebuilding the APK. Verify on the installed APK before release.
- Android WebView changes are deferred until the website's 30 updates are completed and tested.

## Next implementation order
1. Complete data/report foundations: validate full-history pagination and date-filtered repeat/feeder/daily/monthly summaries.
2. Complete staff/admin reporting: staff-filtered history and export/report consistency.
3. Complete notifications and separate Breakdown/Shutdown alerts without adding approval workflow.
4. Complete Hindi translation coverage and PDF/export behavior.
5. Harden and test offline queue and backup/restore.
6. Run full automated and manual regression checks before release approval.


## Feeder status consistency review
- The feeder status/history search now derives the displayed live state from the ongoing Breakdown and Shutdown records returned by the records API. This avoids a stale `feeder_status` document overriding a currently ongoing outage in the UI. The records API explicitly merges all ongoing outages into each history page, so the status calculation does not depend on loading every historical page.
- This is a source-level correction; live Firebase/Netlify and Android WebView behavior still requires pre-release testing. No production deployment, Firestore Rules/index publication, or APK build was performed.


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
- Added a staged composite index for houseId + actorUid + createdAt descending. This index is committed only to the preparation branch and is not published to Firebase yet.
- Runtime validation of the new composite query/index remains part of the release checklist; CI will verify syntax, bundles and Firestore rules, but does not publish the index.


## Active-outage transaction query optimization
- Limited the cross-collection duplicate-outage transaction checks to records whose status is `ongoing`, rather than reading every historical Breakdown and Shutdown for the feeder on every new outage entry.
- Added staged composite indexes for feederId + status on both outage collections. The query still checks both collections in the same transaction; no live index publication has occurred.
- Latest CI syntax, Netlify bundle and Firestore Rules emulator checks have passed. Real Firebase index readiness remains a release prerequisite.


## Stale feeder-status recovery
- Reviewed the outage creation transaction and found that a stale `feeder_status` document could reject a new outage even when both Breakdown and Shutdown collections contained no ongoing event for that feeder.
- The transaction now treats active outage records in both collections as the source of truth for duplicate prevention; when none exists, the new outage transaction writes the current status and replaces the stale status document.
- This avoids a false permanent block while retaining the cross-collection transaction check. Latest CI syntax, Netlify bundle and Firestore Rules emulator checks have passed; live Firebase testing and index publication remain pending.


## Service-worker registration review correction
- A deeper search confirmed that `app.js` already registers `/sw.js` on HTTPS; the earlier review missed this existing module-level registration.
- Removed the extra duplicate registration that had briefly been added to `index.html`. The original single registration remains in `app.js`; the worker stays network-first for app assets and does not cache Netlify API routes.
- Offline form submission, shell reload, queued sync and WebView behavior still require real-device testing.


## House-scoped ongoing-outage page reads
- The records API now applies the Staff/Admin selected Power House filter directly to the ongoing Breakdown and Shutdown queries, rather than fetching ongoing events across every Power House and filtering them afterward.
- Added staged houseId + status composite indexes for both outage collections. This narrows backend reads while keeping ongoing feeders visible on every history page.
- Indexes remain un-published until the coordinated Firebase release; Latest CI syntax, Netlify bundle and Firestore Rules emulator validation passed; production index readiness remains pending.


## Expanded Firestore rules regression coverage
- Added emulator assertions that authenticated Staff and Admin cannot directly read or write backend-only `trippings`, `consumption_readings`, `feeder_status`, `entry_history`, `notifications`, or `login_attempt_limits` documents.
- This complements existing house-scope checks for Power Houses, feeders and daily reports, and verifies that legacy `edit_requests` remains inaccessible.
- Latest CI run #228 passed the expanded emulator suite; no rules were published to Firebase.

- Further assertions cover Admin access to user/legacy approval records and anonymous denial for Power House reads/writes; these remain denied by client Firestore rules.


## One-shot release order (not executed)
1. Freeze source changes on this preparation branch and confirm latest CI success.
2. Publish only the staged Firestore composite indexes first (additive): `firebase deploy --only firestore:indexes --project testing-app-8af35`. Wait until every required index reports READY.
3. Merge this branch to `main` exactly once to trigger the single Netlify production deployment. Do not make follow-up code commits to `main`.
4. Smoke-test the new Admin/Staff app and Netlify API while the existing Firestore rules remain in place. The old live `main` app writes daily reports directly, while the new app routes these writes through the audited API.
5. After confirming the new app is active and users have refreshed/reopened it, publish the restrictive Firestore Rules: `firebase deploy --only firestore:rules --project testing-app-8af35`. Do not publish these rules before the Netlify update, because they deny direct client writes to `daily_reports` and would break the old live app.
6. Re-test Admin/Staff login, immediate entry visibility, outage create/resolve, consumption totals, notifications, pagination, Excel/PDF, and offline/reconnect behavior.
7. Only after those checks, perform the one final Android APK build from the prepared project and verify it loads the deployed URL.
- No step above has been executed; this is a release checklist only.


## Live-main compatibility finding
- The current `main` branch still writes `daily_reports` directly from `app.js`; it does not yet use the staged `records.mjs` API for that action.
- The staged Firestore Rules deny direct client writes to `daily_reports`. Therefore the rules must be published only after the one Netlify deployment has replaced the old app code and the new app has passed smoke tests.
- The staged indexes can be published first because adding indexes is non-breaking. This dependency is now reflected in the one-shot release order above.


## Hindi translation coverage improvement
- Added Hindi mappings for common login, Admin, validation, cursor/pagination, backup, PDF and offline-sync messages.
- Replaced collection-specific backup failure strings with stable translatable messages. The language feature remains marked Partial because uncommon dynamic messages and full screen/device coverage still need review.

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
