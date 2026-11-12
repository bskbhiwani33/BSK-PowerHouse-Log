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
- Supply Position requires a status for every active feeder; Breakdown asks Breakdown Time and PTW time; Shutdown asks PTW time and reason.
- Admin actions: create Power Houses, create Feeders, create Staff logins, deactivate/restore Power Houses and Feeders.
- Admin audit-history view.
- Separate Excel-compatible CSV exports for Breakdown, Shutdown and Consumption.

## Backend and security

The app calls the existing Netlify Functions endpoints over HTTPS. PIN verification and Firebase custom-token creation remain server-side. The Firebase service-account private key is never included in the Android app. The backend must remain configured with its existing server-side Firebase Admin credential.

The app uses the existing Firebase project and remains compatible with the Firebase Spark plan; this native project does not deploy Firebase Cloud Functions or require a Blaze upgrade.

## Firebase Android client configuration

A real distributable APK requires the Firebase Android client configuration file at:

`app/google-services.json`

Register the Android package name `com.bsk.powerhouselog` in the existing Firebase project and place its generated `google-services.json` in that location. This file is different from a Firebase service-account private key. Never commit any service-account JSON or private key.

The GitHub Actions compile-check workflow creates a **dummy compile-only** Google Services config so that source compilation can be tested without exposing project credentials. Its APK artifact is not a working release and must not be installed for production use.

## Build and release

Open this `android-native` directory in Android Studio and use a compatible Android Gradle Plugin / Gradle installation. Compile SDK is 37. A real release build must use the actual Firebase Android client configuration, then be tested on a physical Android device before distribution.

Native UI and feature updates require a new APK release. Cloud data refreshes automatically through the backend when the app refreshes; native code changes do not silently update an already-installed APK.
