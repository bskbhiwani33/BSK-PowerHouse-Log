import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const app = read("app.js");
const html = read("index.html");
const admin = read("functions/handlers/admin.mjs");
const records = read("functions/handlers/records.mjs");
const functionsIndex = read("functions/index.js");
const hostedApp = read("public/app.js");
const hostedHtml = read("public/index.html");
const apkFallbackApp = read("android-app/app/src/main/assets/app.js");
const apkFallbackHtml = read("android-app/app/src/main/assets/index.html");
const apkFallbackConfig = read("android-app/app/src/main/assets/bsk-config.js");
const updateManifest = JSON.parse(read("public/bsk-updates/manifest.json"));
const updateBundle = readFileSync(resolve(root, "public/bsk-updates", updateManifest.bundleUrl.split("/").pop()));
const firebaseConfig = JSON.parse(read("firebase.json"));
const androidActivity = read("android-app/app/src/main/java/com/bsk/powerhouselog/MainActivity.kt");
const androidUpdater = read("android-app/app/src/main/java/com/bsk/powerhouselog/BskAssetBundleManager.kt");
const androidManifest = read("android-app/app/src/main/AndroidManifest.xml");
const androidDownloadBridge = read("android-app/app/src/main/java/com/bsk/powerhouselog/BskDownloadBridge.kt");
const androidProguard = read("android-app/app/proguard-rules.pro");
const androidGradle = read("android-app/app/build.gradle.kts");
const releaseConfig = JSON.parse(read("bsk-release.json"));

const expectedAdmin = [
  "getDashboardData", "updateHouse", "setHouseActive", "updateFeeder",
  "setFeederActive", "createHouse", "createFeeder", "createStaff"
];
const expectedRecords = [
  "createBreakdown", "createShutdown", "resolveBreakdown", "resolveShutdown",
  "updateRecord", "createDailyReport", "createTripping", "createConsumption",
  "createSupplyPosition", "exportBackupPage", "getRecords", "markNotificationRead"
];

const adminActions = new Set([...admin.matchAll(/body\.action\s*===\s*["']([^"']+)["']/g)].map(m => m[1]));
const recordActions = new Set([...records.matchAll(/case\s+["']([^"']+)["']/g)].map(m => m[1]));
const frontendActions = new Set([...app.matchAll(/["'](getDashboardData|updateHouse|setHouseActive|updateFeeder|setFeederActive|createHouse|createFeeder|createStaff|createBreakdown|createShutdown|resolveBreakdown|resolveShutdown|updateRecord|createDailyReport|createTripping|createConsumption|createSupplyPosition|exportBackupPage|getRecords|markNotificationRead)["']/g)].map(m => m[1]));

const missingAdmin = expectedAdmin.filter(x => !adminActions.has(x));
const missingRecords = expectedRecords.filter(x => !recordActions.has(x));
const missingFrontend = [...expectedAdmin, ...expectedRecords].filter(x => !frontendActions.has(x));
for (const [label, missing] of [["admin backend", missingAdmin], ["records backend", missingRecords], ["frontend", missingFrontend]]) {
  if (missing.length) throw new Error(label + " missing actions: " + missing.join(", "));
}
for (const route of ["login", "admin", "records"]) {
  if (!app.includes(`bskFunctionUrl("${route}")`)) throw new Error("Frontend route missing: " + route);
  if (!functionsIndex.includes(`export const ${route} =`)) throw new Error("Firebase HTTPS export missing: " + route);
}
if (!(html.indexOf("/bsk-config.js") < html.indexOf('/app.js'))) {
  throw new Error("Runtime config must load before app.js");
}
if (firebaseConfig.functions?.source !== "functions") throw new Error("Firebase Functions source is not configured");
if (firebaseConfig.hosting?.public !== "public") throw new Error("Firebase Hosting public root is not configured");
for (const route of ["/.netlify/functions/login", "/.netlify/functions/admin", "/.netlify/functions/records"]) {
  if (!firebaseConfig.hosting.rewrites?.some(x => x.source === route)) throw new Error("Firebase Hosting rewrite missing: " + route);
}
if (!hostedHtml.includes("/bsk-config.js") || !hostedHtml.includes("/app.js")) throw new Error("Generated Firebase Hosting HTML is incomplete");
if (hostedApp.includes("https://www.gstatic.com/firebasejs/13.2.0/firebase-")) throw new Error("Generated app bundle still depends on remote Firebase SDK imports");
if (apkFallbackApp.includes("https://www.gstatic.com/firebasejs/13.2.0/firebase-") || !apkFallbackHtml.includes("/app.js") || !apkFallbackConfig.includes("bskLocal")) throw new Error("Generated Android fallback assets are incomplete");
if (!Number.isSafeInteger(updateManifest.version) || !updateManifest.bundleUrl.startsWith("https://testing-app-8af35.web.app/bsk-updates/")) throw new Error("Update manifest URL/version is invalid");
const actualHash = createHash("sha256").update(updateBundle).digest("hex");
if (actualHash !== updateManifest.sha256) throw new Error("Update bundle SHA-256 does not match manifest");
if (!androidActivity.includes("bsk-powerhouse-log-bhiwani.netlify.app") || !androidActivity.includes("bskLocal=1") || !androidActivity.includes("assetBundles.openAsset")) throw new Error("Android local virtual-origin interception is missing");
if (!read("bsk-config.js").includes("bskLocal") || !read("bsk-config.js").includes("asia-south1-testing-app-8af35.cloudfunctions.net")) throw new Error("Android Firebase API runtime config is missing");
if (!androidUpdater.includes("MessageDigest.getInstance(\"SHA-256\")") || !androidUpdater.includes("renameTo(installed)") || !androidUpdater.includes("TRUSTED_HOST")) throw new Error("Android asset updater safety checks are incomplete");
if (!androidActivity.includes("ServiceWorkerController") || !androidActivity.includes("getRegistrations()") || !androidActivity.includes("caches.delete")) throw new Error("Android migration does not retire the old PWA cache safely");
if (!androidManifest.includes("android.permission.INTERNET")) throw new Error("Android manifest is missing internet permission");
const nativeVersion = Number(androidUpdater.match(/NATIVE_VERSION\\s*=\\s*(\\d+)L/)?.[1]);
const apkVersion = Number(androidGradle.match(/versionCode\\s*=\\s*(\\d+)/)?.[1]);
if (!nativeVersion || nativeVersion !== apkVersion || Number(updateManifest.minNativeVersion) !== nativeVersion || Number(releaseConfig.minNativeVersion) !== nativeVersion) {
  throw new Error("APK, native updater, and remote bundle minimum versions do not match");
}

if (!androidProguard.includes("@android.webkit.JavascriptInterface")) throw new Error("Android R8 keep rule for JavaScript bridge is missing");
if (!app.includes("function bskDownloadBlob") || !app.includes("window.BSKAndroidBridge") || !app.includes("appendFileChunk")) throw new Error("Web export helper is not connected to chunked Android downloads");
if (!app.includes("window.BSKAndroidBridge.printHtml")) throw new Error("Android PDF/print bridge is not connected");
if (!androidActivity.includes("BskDownloadBridge(this)") || !androidDownloadBridge.includes("@JavascriptInterface") || !androidDownloadBridge.includes("MediaStore.Downloads.EXTERNAL_CONTENT_URI") || !androidDownloadBridge.includes("fun beginFile") || !androidDownloadBridge.includes("fun appendFileChunk") || !androidDownloadBridge.includes("fun finishFile") || !androidDownloadBridge.includes("fun printHtml") || !androidActivity.includes("PrintManager")) throw new Error("Android export bridge is incomplete");
for (const collection of ["breakdowns", "shutdowns", "trippings", "consumption_readings", "supply_positions", "daily_reports", "feeder_status", "notifications", "entry_history"]) {
  if (!records.includes(`"${collection}"`)) throw new Error("Records collection missing: " + collection);
}
console.log("BSK API contract OK: " + expectedAdmin.length + " admin actions, " + expectedRecords.length + " records actions, 3 API routes, 9 operational collections.");
