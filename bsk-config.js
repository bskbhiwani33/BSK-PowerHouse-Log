// Shared browser and Android runtime configuration.
// The Android shell keeps the previous WebView origin only as a local virtual
// origin so existing localStorage / Firebase Auth IndexedDB remain available.
// MainActivity intercepts every app asset request and serves it from local files.
const standaloneFlag = new URLSearchParams(location.search).get("bskLocal") === "1";
window.BSK_FUNCTIONS_BASE = window.BSK_FUNCTIONS_BASE || (standaloneFlag
  ? "https://asia-south1-testing-app-8af35.cloudfunctions.net"
  : "");
window.BSK_DISABLE_SERVICE_WORKER = standaloneFlag;
