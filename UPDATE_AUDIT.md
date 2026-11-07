# BSK 30-Update Implementation Audit

Audit basis: source code on branch `bsk-complete-update-prep`, updated after report/history improvements. This remains a source-code review, not a live-system test.
This is a source-code audit only. It does not mean the features have passed end-to-end testing or are live on Netlify.

Status meanings:
- **Present**: a corresponding implementation is visible in the current source; runtime verification is still required.
- **Partial**: some implementation exists, but the requested feature needs completion or stronger verification.
- **Not found**: no corresponding implementation was found in the reviewed source.

| # | Requested update | Source audit status | Notes / remaining work |
|---|---|---|---|
| 1 | Dashboard: only ongoing Breakdown/Shutdown counts and feeder names | Present | Live outage dashboard renders ongoing counts and lists; verify role visibility and multiple feeders. |
| 2 | Tripping entry: only number of trippings and number of feeders | Present | Form has exactly the two requested numeric inputs; date is hidden/automatic. |
| 3 | Breakdown/Shutdown entry with feeder, date, start, optional end, reason | Present | Separate forms and resolve workflow exist; verify overnight duration and simultaneous outage constraints. |
| 4 | Five Power House consumption readings, automatic total, history and Excel | Present | Five fields, client/server total calculation, history list and Consumption Excel exist; verify units/rounding and larger datasets. |
| 5 | Feeder status Running/Breakdown/Shutdown | Present | Canonical `feeder_status` records are written on ongoing outage and reset on resolution. Added a houseId + document-ID composite index for Staff pagination of feeder status; index deployment remains deferred until final release. |
| 6 | Feeder history | Partial | Feeder search now applies the date range and displays all currently loaded history; use Load All History to retrieve older pages. Backend rejects malformed/expired cursors and invalid Firestore document IDs for resolve, edit, notification, feeder selection, Admin house selection and pagination cursor actions; refresh and paging share a lock, and history restoration stops cleanly after a failed page request. Runtime verification remains. |
| 7 | Automatic Breakdown duration | Present | Duration is calculated from start to end/current time for display; verify date/time edge cases. |
| 8 | Repeat-Breakdown report | Partial | Repeat counts are grouped by feeder ID and filtered by date/search. The report now warns when only partial history is loaded; complete historical counts require loading all pages first. |
| 9 | Feeder-wise report | Partial | A dedicated feeder-wise breakdown/shutdown count summary is present and warns when older history pages remain unloaded. |
| 10 | Daily summary | Partial | Daily entry counts show category-separated totals across loaded record types and warn when history is incomplete; full-history verification remains. |
| 11 | Monthly report | Partial | Monthly entry counts show category-separated totals and warn when history is incomplete; full-history verification remains. |
| 12 | Date-wise search | Partial | From/to filters apply to record history, feeder history, reports, charts, audit history and three dedicated Excel exports. Clearing report filters refreshes feeder history and charts; verify all combinations in runtime. |
| 13 | Excel download (general) | Present | Combined multi-sheet Excel export added for Breakdown, Shutdown, Tripping, Consumption and Daily Reports; date/search filters apply to loaded records. SpreadsheetML text is now sanitized for XML 1.0 invalid control characters in the combined and dedicated exports. |
| 14 | PDF report | Partial | Print-ready report opens in a separate window, hides edit controls, uses print margins and keeps report cards together; test browser/WebView print support and filtered layout. |
| 15 | Staff login with individual login ID | Present | User ID + PIN login and Admin provisioning support multiple active staff accounts per Power House; verify login and staff isolation in runtime. |
| 16 | Staff-wise entry history | Partial | Staff API responses include only the signed-in Staff member's own audit events and omit the Admin notification feed; Admin retains full house-level history and notifications. Staff offline record caches are now isolated by authenticated UID to prevent cross-account cached-history exposure. Staff history and Admin staff-wise created-entry counts apply date/search filters; counts exclude later resolve/edit audit actions. Runtime verification remains. |
| 17 | Admin dashboard/reporting | Present | Admin dashboard, management forms, report views and operational records are present; end-to-end checks remain. |
| 18 | Edit history (who changed record and when) | Present | Update/resolve operations write before/after audit entries with actor and timestamp. |
| 19 | Staff cannot delete old records | Present | No staff delete UI/API action is exposed; Firestore direct writes are denied. Verify all routes remain protected. |
| 20 | Ongoing Breakdown alert | Partial | Separate Breakdown long-running alert section now appears at 24+ hours; no push/background notification delivery. |
| 21 | Ongoing Shutdown alert | Partial | Separate Shutdown long-running alert section now appears at 24+ hours; no push/background notification delivery. |
| 22 | New entry notification to Admin | Partial | New-entry notifications are saved transactionally and shown with unread count in Admin dashboard; only Admin can mark them read. No push/background delivery. |
| 23 | Pending Entry Alert = unread notifications, not approval queue | Present | Unread notification count and Mark Read action exist; no approval/reject queue is present. |
| 24 | Hindi + English toggle | Partial | Added translations for login guidance, report instructions, select prompts, Power House management text and empty states. Less-common validation/server messages and full device coverage still need testing. |
| 25 | Dark Mode | Present | Theme toggle and local preference persistence exist; visual coverage needs device testing. |
| 26 | Search by Feeder/date | Partial | Feeder-name search and date range filters exist in separate views; consistent combined search across all datasets is incomplete. |
| 27 | Dashboard charts | Partial | Record-count and monthly activity bar charts now respond to date/search filters; validate in runtime. |
| 28 | Backup system | Partial | Admin can export a paginated JSON backup across operational collections. Backup includes format/schema/project/exporter metadata and per-collection row counts, validates every page response, rejects malformed/expired cursors and guards repeated cursors. Restore workflow and backup integrity tests remain. PIN hashes/salts are excluded. |
| 29 | Offline entry + sync on reconnection | Partial | Local outbox, stable IDs, transactional idempotency, guarded single-run sync, queue merging that preserves entries added during sync, online/visibility/periodic retry and storage-quota warning exist. Operational record caches are isolated per Staff UID; login/logout resets in-memory records and pagination. Cache quota failures no longer replace fresh server data with stale cached records; offline reload and device testing remain. |
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
- CI and emulator checks are being rerun against this latest staged change. Real Firebase index readiness remains a release prerequisite.
