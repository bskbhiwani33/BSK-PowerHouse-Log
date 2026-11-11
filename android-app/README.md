# BSK Standalone Android source

This Android module replaces the Netlify URL WebView with a local asset shell.

## How it works

- The APK contains the generated files from the repository's `public/` folder.
- WebView opens `https://appassets.androidplatform.net/assets/index.html`, served from local APK/app-private files by `MainActivity`.
- On app start, `BskAssetBundleManager` checks the Firebase Hosting update manifest.
- It downloads only from the fixed Firebase Hosting host, checks the SHA-256 digest, rejects unsafe ZIP paths, extracts to a staging folder, validates required files, then atomically activates the new version.
- The last installed version and the APK-bundled assets remain available if an update fails.
- Login and operational APIs go directly to Firebase HTTPS Functions from the Android asset origin. Netlify is not used by this Android shell.
- The native updater does not clear WebView DOM storage, so the existing login session and local offline queue are not deliberately erased.

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
- `android-app/app/src/main/AndroidManifest.xml`

In the existing app module's `build.gradle.kts`, add the source set below if the Android project is kept inside this repository at `android-app/`:

```kotlin
sourceSets {
    getByName("main") {
        assets.srcDir("../../public")
    }
}
```

If the Android Studio project is stored elsewhere, copy the generated `public/` files into `app/src/main/assets/` and remove the source-set override. Keep package/application ID `com.bsk.powerhouselog`.

## Important release limitations

- This is a checksum-verified HTTPS asset update, not a cryptographically signed manifest. Keep Firebase Hosting deployment permissions tightly restricted; add an asymmetric manifest signature before distributing to a wider managed fleet.
- Routine HTML/CSS/JS changes can update without APK reinstall. Native Android code, permissions, SDK or library changes still require an APK update.
- Firebase Functions and Hosting must be deployed and tested before installing this container. The current live Netlify app is not switched by this source-only preparation.
- The generated Android module has not yet been built on a physical device in this workspace.
