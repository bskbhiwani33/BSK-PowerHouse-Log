# BSK Standalone Android App and Automatic Update Plan

Status: implementation staged on branch `bsk-firebase-functions-prep`; not deployed to the live Firebase project or Netlify site.

## Goals

- Preserve all agreed BSK feature areas, existing working workflows, and live Firestore records.
- Remove the Android app's runtime dependency on the Netlify website and Netlify Functions.
- Keep Firebase as the system of record for authentication and operational data.
- Deliver routine UI, form, report, and workflow changes without staff manually reinstalling an APK.
- Keep an offline-capable app shell and protect login persistence and queued entries during asset updates.
- Keep one carefully tested final production release; no premature production deployment.

## Staged implementation now present

### Firebase backend

- Added Firebase HTTPS Functions v2 adapters for login, admin, first-admin setup, and records.
- Reused the existing validated handlers and Firestore document formats rather than rewriting record logic.
- Added Application Default Credentials for Firebase Functions while retaining the existing Netlify service-account environment path.
- Bound the first-admin setup key through Firebase Secret Manager.
- Kept the browser app on same-origin Netlify routes by default; no live endpoint has been switched.

### Firebase Hosting and asset build

- Configured Firebase Hosting to serve generated assets from `public/`.
- Added Hosting rewrites for the existing API paths to Firebase HTTPS Functions.
- Added a build that bundles the Firebase Web SDK locally into the app JavaScript, so Android does not need to load Firebase modules from a third-party CDN.
- Added a versioned ZIP asset bundle and SHA-256 manifest. Increase `bsk-release.json`'s version for every routine asset release.
- Added no-cache headers for the update manifest and immutable caching for versioned bundles.

### Android shell

- Added a local-asset WebView shell. It intercepts the existing Netlify hostname and serves all app files locally, retaining that hostname only as a virtual WebView origin so existing localStorage and Firebase Auth IndexedDB are not stranded during migration.
- Added a Firebase Hosting update downloader that checks the trusted HTTPS host, verifies SHA-256, rejects ZIP path traversal, extracts into a staging directory, validates required files, and atomically activates the new version.
- Retains the previous bundle and APK-bundled fallback if an update fails.
- Adds bounded chunked native downloads for Excel-compatible exports and JSON backups, plus Android PrintManager support for Save as PDF.
- A `bskLocal=1` runtime marker routes API calls directly to Firebase HTTPS Functions and disables the PWA service worker in the native shell. The normal browser Netlify site remains unchanged.
- Routine web asset changes can update without an APK reinstall. Native Android code, permissions, SDK or library changes still require a new APK.

### Automated checks

- GitHub Actions installs the web and Functions dependencies.
- Builds the Firebase Hosting asset bundle.
- Checks JavaScript syntax and compares frontend API actions with backend actions.
- Checks Hosting rewrites, update-manifest URL, bundle checksum, and Android source safety markers.

## Security and deployment constraints

- The current update manifest uses HTTPS plus SHA-256 integrity verification. It is not yet cryptographically signed. Firebase Hosting deployment permissions must remain tightly restricted; add asymmetric manifest signing before broad managed distribution.
- Firebase Functions use the runtime service identity. Verify its minimum required Authentication and Firestore permissions.
- Cloud Functions deployment requires an eligible Firebase billing plan. Confirm billing and Firestore region before staging deployment.
- Configure the `ADMIN_SETUP_KEY` secret before deploying the first-admin setup endpoint, or omit that one-time endpoint if it is no longer needed.
- Never put Firebase service-account JSON/private keys in the Android app, browser bundle, or Git repository.
- Do not loosen Firestore Rules to make the app work. Privileged writes continue through authenticated server handlers.
- Netlify remains the current live host until Firebase Hosting, Functions, data compatibility, and Android behavior pass end-to-end tests.

## Remaining validation before release

1. Deploy to a separate Firebase staging project and verify Authentication, Firestore, Functions IAM, Hosting rewrites, and the first-admin secret.
2. Test all login/admin/record API actions against staging, including staff house scoping, duplicate staff prevention, audit history, ongoing outages, exports, and backup paging.
3. Compare all agreed BSK features and every operational collection with the current live app; verify live Firestore data remains unchanged.
4. Build the Android module in Android Studio and test on a physical device: fresh install, sign-in, asset update, failed download, wrong checksum, ZIP path traversal, rollback, offline launch, offline queue sync, session persistence, Excel/JSON downloads, and print-to-PDF.
5. Add cryptographic signature verification for update manifests before broad rollout.
6. Only after the staging tests pass, prepare one controlled production cutover. Keep the current Netlify site available until Firebase Hosting and the Android APK are confirmed.


Deployment requirement: Firebase Cloud Functions requires the Blaze billing plan. Use local emulators before production and configure budget alerts/spend caps.
