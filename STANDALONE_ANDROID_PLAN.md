# BSK Standalone Android App and Automatic Update Plan

Status: architecture plan only; not a production change.

## Goals
- Preserve all 30 agreed BSK feature areas and every currently working workflow.
- Remove runtime dependency on the Netlify website and Netlify Functions.
- Keep Firebase as the system of record for authentication and operational data.
- Let staff receive routine UI, form, report, and business-logic updates without manually installing a new APK.
- Keep an offline-capable app shell and protect queued entries and user data during updates.
- Keep one carefully tested final production release; no premature production deployment.

## Recommended architecture

### 1. Android container
Use the existing Android application as a local-first container. Bundle a known-good BSK shell in the APK so the app can open even if the network is unavailable. The app should not simply load the Netlify URL.

### 2. Remotely delivered web layer
Host versioned BSK web asset bundles (HTML, CSS, JavaScript, images and other UI assets) on Firebase Hosting or Firebase Storage behind HTTPS. The Android container checks a small update manifest when the app starts and periodically while foregrounded.

The manifest should include:
- monotonically increasing version/build number;
- minimum compatible Android container version;
- asset bundle URL;
- SHA-256 digest;
- release notes and mandatory/optional flag;
- rollback/previous-known-good version metadata.

Download into app-private storage, verify the digest, unpack into a new version directory, then atomically switch the active bundle. Keep the previous known-good bundle for rollback. Never overwrite the active bundle in place. If download, verification, or activation fails, keep using the last known-good bundle. Do not clear Firestore data, login state, or offline queues during an asset update.

Only trusted HTTPS endpoints and verified manifests/bundles should be accepted. Do not execute arbitrary code or accept unsigned update instructions.

### 3. Firebase backend migration
Replace Netlify Functions with Firebase Cloud Functions or another Firebase-managed HTTPS backend:
- user ID + PIN login and custom-token issuance;
- admin operations and staff/house assignment;
- record create/update/resolve operations;
- exports and other privileged server-side operations.

Keep Firebase Admin SDK credentials server-side only. Never put service-account credentials in the Android app or browser bundle. Preserve role checks, house scoping, validation, audit history, and existing Firestore document formats. Test migration against a separate Firebase test project/database before touching the live project.

### 4. Direct Firebase data access
Where the existing client already uses Firebase Auth and Firestore safely, retain direct Firebase access subject to strict Firestore Rules. Privileged operations must go through authenticated Cloud Functions. Do not weaken rules to make the Android app work.

### 5. Native Android updates
Remote web-asset updates can deliver most routine UI, form, report, and workflow changes without staff action. Changes to native Android code, permissions, SDKs, or embedded libraries still require an APK update. For those, evaluate managed Google Play/private distribution or another approved enterprise distribution channel with automatic update policy. Do not implement an unsafe self-updater that silently installs arbitrary APKs.

## Migration and test phases
1. Inventory the current Android wrapper, app assets, Firebase config, Netlify Functions, collections, rules, offline queue, and all 30 feature areas.
2. Build the Firebase Cloud Functions equivalents in a separate prep branch and test project.
3. Add versioned asset delivery, manifest validation, checksum verification, atomic activation, rollback, and offline fallback.
4. Build a new Android container that loads the local/verified asset bundle rather than a Netlify URL.
5. Run automated syntax, dependency, backend, Firestore Rules emulator, and migration tests.
6. Test on physical Android devices: fresh install, login, routine asset update without APK, interrupted download, bad checksum, rollback, offline start, queued entry sync, and native-version incompatibility.
7. Compare every feature and data flow with the existing BSK app; verify existing live data is unchanged.
8. Only after explicit release approval, prepare one final production release and one controlled deployment.

## Current evidence and limitations
- The current prep branch contains a PWA service worker with network-first asset refresh and cache fallback.
- The current repository tree contains the web app and Netlify Functions; no Android project source is present in this repository snapshot. The existing Android Studio project/wrapper source must be located or supplied before native container work can be implemented.
- The current prep-branch CI passed JavaScript/config syntax, dependency installation, production dependency audit, Netlify function bundling, and Firestore Rules emulator tests.
- No production deployment, live Firestore Rules publication, Netlify removal, or APK build is authorized or performed by this plan.
