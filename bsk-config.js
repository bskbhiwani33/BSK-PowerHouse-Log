// Shared browser and Android runtime configuration.
// The Android WebView serves local assets from this HTTPS-style app origin;
// it calls the Firebase HTTPS Functions directly and does not depend on Netlify.
const isBskStandaloneAndroid = location.hostname === "appassets.androidplatform.net";
window.BSK_FUNCTIONS_BASE = window.BSK_FUNCTIONS_BASE || (isBskStandaloneAndroid
  ? "https://asia-south1-testing-app-8af35.cloudfunctions.net"
  : "");
window.BSK_DISABLE_SERVICE_WORKER = isBskStandaloneAndroid;
