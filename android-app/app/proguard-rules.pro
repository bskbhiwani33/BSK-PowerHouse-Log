# Keep the JavaScript bridge methods callable by WebView after R8 optimization.
-keepclassmembers class com.bsk.powerhouselog.BskDownloadBridge {
    @android.webkit.JavascriptInterface <methods>;
}
