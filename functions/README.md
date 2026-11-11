# BSK Firebase HTTPS Functions (staging)

This directory contains a Firebase Functions v2 HTTPS adapter around the existing BSK login, admin, first-admin-setup, and records handlers. It deliberately preserves their request payloads, response payloads, role checks, validation, and Firestore document formats.

## Runtime behavior

- Functions are deployed in `asia-south1`.
- The web app continues to use same-origin Netlify Functions by default.
- A separately packaged Android/Firebase-hosted asset bundle can set `window.BSK_FUNCTIONS_BASE` in `bsk-config.js` to:
  `https://asia-south1-testing-app-8af35.cloudfunctions.net`
- Login, admin, and records endpoints then resolve to `/login`, `/admin`, and `/records` under that base.
- First-admin setup is exported as `/createAdmin` and requires the Firebase Secret `ADMIN_SETUP_KEY`.

## Credentials

The original Netlify handlers continue to use `FIREBASE_SERVICE_ACCOUNT` when that environment variable is present. In Firebase Functions, the handlers fall back to Application Default Credentials from the function's runtime service identity. No service-account JSON or private key belongs in the Android app, browser bundle, or Git repository.

Set the first-admin setup secret only if that endpoint is still needed:

```sh
firebase functions:secrets:set ADMIN_SETUP_KEY --project testing-app-8af35
```

The runtime service identity must have the minimum Firebase Authentication and Firestore permissions required by these handlers. Do not publish broader Firestore client rules to compensate for missing server permissions.

## Staging deployment

This is prep-branch code only. Before deploying, confirm that the Firebase project is on the Blaze billing plan, verify the Firestore region and runtime service-account IAM, and test against a non-production Firebase project first. Do not remove Netlify or switch the live app until the Firebase Functions endpoints and Android asset update path have passed integration tests.

Install and syntax-check:

```sh
cd functions
npm install
npm run check
```
