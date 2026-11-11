# BSK Native Android

This is a separate native Android application project. It does not render or open the BSK website in a WebView.

## Current implementation
- Jetpack Compose native login screen.
- User ID + four-digit PIN input.
- Calls the existing BSK login API over HTTPS.
- Exchanges the server-issued Firebase custom token using Firebase Authentication.
- Shows a role-aware native landing screen for Admin or Staff.
- Does not include any Firebase service-account secret.

## Firebase client configuration
Place the existing Android Firebase configuration file at:

`app/google-services.json`

Do not commit service-account JSON files or private keys. The Android google-services.json is a client configuration file, not an Admin SDK credential.

## Backend dependency
The native UI calls the existing HTTPS login endpoint:
`https://bsk-powerhouse-log-bhiwani.netlify.app/.netlify/functions/login`

This is an API call only; the Android app does not load the Netlify website. The current backend uses the server-side Firebase Admin SDK and therefore keeps PIN verification and custom-token creation off the device. Since the Firebase project is on the Spark plan, this scaffold does not deploy Firebase Cloud Functions or require a Blaze upgrade.

## Build
Open this directory in Android Studio after adding the existing google-services.json file. Use an installed Gradle 9.6-compatible Android Studio/Gradle setup. The project is a staged native foundation; operational dashboards, report forms, exports, offline queue, and complete test coverage are not yet implemented.
