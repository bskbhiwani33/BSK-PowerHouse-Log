# BSK Standalone Android source

This Android module replaces the Netlify URL WebView with a local asset shell.

## How it works

- The APK contains the generated files from the repository's `public/` folder.
- WebView keeps the existing `https://bsk-powerhouse-log-bhiwani.netlify.app` origin (with a private `bskLocal=1` marker) only to preserve the current device's localStorage and Firebase Auth IndexedDB. `MainActivity` intercepts the page and every asset request and serves them from local APK/app-private files; it does not fetch the Netlify website.
- On app start, `BskAssetBundleManager` checks the Firebase Hosting update manifest.
- It downloads only from the fixed Firebase Hosting host, checks the SHA-256 digest, rejects unsafe ZIP paths, extracts to a staging folder, validates required files, then atomically activates the new version.
- The last installed version and the APK-bundled assets remain available if an update fails.
- Login and operational APIs go directly to Firebase HTTPS Functions from the Android asset origin. Netlify is not used by this Android shell.
- The native shell removes the old PWA service worker and CacheStorage once, then reloads from local files. It deliberately preserves localStorage and IndexedDB, so the existing login session and offline queue are not cleared.
- Excel-compatible report exports and JSON backups use a narrow native bridge to save into Downloads/BSK on Android 10+, or the app-specific Downloads folder on older Android versions. The PDF/print action opens Android's native print dialog (including Save as PDF). No broad storage permission is requested.

## Build prerequisites

From the repository root:

```sh
npm install
npm run build:hosting
```

The build creates `public/` and a versioned `public/bsk-updates/bsk-assets-vN.zip` with a SHA-256 manifest. Increment `bsk-release.json`'s `version` for every released asset update.

## Integrating with the existing Android Studio project

Copy these files into the existing project paths:

- `android-app/app/src/main/java/com/bsk/powerhouselog/MainActivity.kt`
- `android-app/app/src/main/java/com/bsk/powerhouselog/BskAssetBundleManager.kt`
- `android-app/app/src/main/java/com/bsk/powerhouselog/BskDownloadBridge.kt`
- Merge `android-app/app/src/main/AndroidManifest.xml` into the existing manifest: keep the current launcher icon, round icon, and `@style/Theme.BSK`; ensure INTERNET permission, exported launcher activity, and `adjustResize` are present.

In the existing app module's `build.gradle.kts`, add the source set below if the Android project is kept inside this repository at `android-app/`:

```kotlin
sourceSets {
    getByName("main") {
        assets.srcDir("../../public")
    }
}
```

If the Android Studio project is stored elsewhere, copy the generated `public/` files into `app/src/main/assets/` and remove the source-set override. Keep package/application ID `com.bsk.powerhouselog`. Do not replace the existing BSK theme or launcher icons. If release shrinking/optimization is enabled, merge `android-app/app/proguard-rules.pro` into the app's R8 rules so the `@JavascriptInterface` bridge methods remain callable.

## Important release limitations

- This is a checksum-verified HTTPS asset update, not a cryptographically signed manifest. Keep Firebase Hosting deployment permissions tightly restricted; add an asymmetric manifest signature before distributing to a wider managed fleet.
- Routine HTML/CSS/JS changes can update without APK reinstall. Native Android code, permissions, SDK or library changes still require an APK update.
- Firebase Functions and Hosting must be deployed and tested before installing this container. The current live Netlify app is not switched by this source-only preparation.
- The generated Android module has not yet been built on a physical device in this workspace.
