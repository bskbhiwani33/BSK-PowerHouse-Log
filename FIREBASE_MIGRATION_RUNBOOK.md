# BSK Firebase Backend Migration Runbook

This is a preparation document only. No command below has been run against the live Firebase project.

## Target project and region

- Firebase project: `testing-app-8af35`
- Cloud Functions generation: 2nd gen HTTPS
- Region: `asia-south1`
- Runtime: Node.js 22
- Functions: `login`, `admin`, `records`
- Existing Firestore collections and document formats remain the source of truth.

## Before deploying

1. Confirm the project selected in Firebase CLI is `testing-app-8af35`.
2. Confirm billing / Blaze plan and Cloud Functions, Cloud Build, Artifact Registry, Cloud Run, Secret Manager, and IAM APIs are enabled as required by Firebase.
3. Assign a dedicated least-privilege runtime service account to the functions. Grant only the Firestore permissions required by the existing Admin SDK handlers and permission to verify Firebase Authentication users / mint custom tokens.
4. For custom token creation, ensure the runtime service account has the required `iam.serviceAccounts.signBlob` permission (typically Service Account Token Creator on itself) and test token issuance before any client cutover.
5. Do not add a service-account JSON key to GitHub, Android assets, or the APK. The Functions handlers use Application Default Credentials in Firebase; Netlify keeps using its current server-side `FIREBASE_SERVICE_ACCOUNT` environment variable.
6. Confirm the current Firestore Rules and indexes are deployed and capture collection/document counts for comparison. Do not broaden client write rules.
7. Deploy only the Functions first; keep the current Netlify endpoints and APK unchanged.

## Deployment commands — not yet run

```bash
firebase use testing-app-8af35
firebase deploy --only functions:login,functions:admin,functions:records
```

The one-time `create-admin` bootstrap is intentionally not exported. The existing Admin account in the live project must remain intact.

## Endpoint verification before changing app.js

- Login with an existing Admin account and an existing Staff account.
- Confirm Firebase custom-token sign-in succeeds and the expected profile/role is returned.
- Confirm wrong PIN, inactive user, inactive Power House, invalid role, and rate-limit responses.
- Confirm Admin-only actions reject Staff tokens.
- Confirm Staff cannot read or write another Power House's records.
- Create a test Breakdown, resolve it, and verify feeder_status, entry_history, and notifications update consistently.
- Test Shutdown, Daily Report, Tripping, Consumption, Supply Position, record edits, pagination, and backup export.
- Confirm retrying an offline queued entry with the same clientEntryId does not create a duplicate.
- Compare test record results and collection counts; do not migrate or rewrite live records.

## Client cutover

Only after all endpoint tests pass:
1. Add a single configurable API base to the web app and Android client.
2. Switch login/admin/records calls from Netlify URLs to the deployed Firebase HTTPS function URLs in one tested change.
3. Verify Admin and Staff flows on a physical Android device and a browser.
4. Keep Netlify deployed as a rollback option for at least one stable observation period.
5. Do not disable Netlify until the Firebase endpoints and client cutover are proven stable.

## Android standalone / routine auto-update architecture

- APK contains a native Android shell and a small local bootstrap/offline screen, not the live Netlify site.
- UI bundle is versioned and hosted on Firebase Hosting or Firebase Storage under immutable version paths.
- On app launch/resume, native code fetches a small manifest, downloads only a newer bundle into app-private staging, verifies its SHA-256 and manifest version, then atomically activates it.
- Keep the last known-good bundle and roll back if verification or startup fails.
- The app must open the last known-good UI offline and retain the existing offline outbox until sync succeeds.
- Firebase HTTPS Functions remain the only privileged data-write interface; never place Admin SDK credentials in the APK.
- UI, forms, reports, and ordinary web logic can update remotely without reinstalling. Native Android changes, permissions, SDK changes, and native libraries still require a new APK and an approved distribution channel.

## Current status

- Firebase Functions source scaffold exists on `bsk-complete-update-prep`.
- Frontend still uses Netlify endpoints.
- No Firebase Functions deployment, IAM change, Firestore Rules deployment, live data migration, Netlify shutdown, or APK build has occurred.
