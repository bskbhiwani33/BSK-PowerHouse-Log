# BSK Native Android

This is a standalone Jetpack Compose Android application. It does not load the BSK website in a WebView.

## Implemented native screens

- User ID + four-digit PIN login through the existing HTTPS login API.
- Firebase Authentication custom-token sign-in.
- Role-based Staff and Admin dashboards.
- Live refresh from the existing secure Netlify Functions API (API only; no website UI).
- Ongoing Breakdown and Shutdown counters and feeder lists.
- Resolve controls for ongoing events using the actual restoration time.
- Staff forms: Breakdown, Shutdown, Tripping, Consumption, Supply Position and Daily Feeder Report.
- Supply Position requires a status for every active feeder; Breakdown asks Breakdown Time and PTW time; Shutdown asks PTW time and reason. Both standalone Breakdown and Shutdown entries require PTW time.
- Admin actions: create Power Houses, create Feeders, create Staff logins, deactivate/restore Power Houses and Feeders.
- Admin and staff audit-history views.
- Admin notification inbox for new Breakdown/Shutdown entries, with unread count and mark-as-read action.
- Separate paginated, Excel-compatible CSV exports for Breakdown, Shutdown and Consumption.
- Admin full JSON backup export across the supported BSK collections; PIN hashes and salts are removed server-side from user records.

## Backend and security

The app calls the existing Netlify Functions endpoints over HTTPS. PIN verification and Firebase custom-token creation remain server-side. The Firebase service-account private key is never included in the Android app.

The Android client config in `app/google-services.json` belongs to Firebase project `testing-app-8af35` and package `com.bsk.powerhouselog`. This is a Firebase client configuration file, not an Admin SDK service-account credential.

The app remains compatible with the Firebase Spark plan; this native project does not deploy Firebase Cloud Functions or require a Blaze upgrade.

## Build and release

Open this `android-native` directory in Android Studio. Compile SDK and target SDK are 36. GitHub Actions runs a native debug build using the actual project Firebase client config and stores a short-lived debug APK artifact.

A debug APK is not a production release. A production update requires a release signing key that matches the app already installed on the devices. Keep that private key outside the repository and protect it with a secure signing process.

Native UI and feature updates require a new APK release. Cloud data refreshes through the backend when the app refreshes; native code changes do not silently update an already-installed APK.
