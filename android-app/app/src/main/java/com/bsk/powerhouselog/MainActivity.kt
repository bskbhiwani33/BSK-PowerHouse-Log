package com.bsk.powerhouselog

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.print.PrintAttributes
import android.print.PrintManager
import android.widget.Toast
import android.webkit.WebChromeClient
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var assetBundles: BskAssetBundleManager
    private var lastAssetCheckAt = 0L
    private var serviceWorkerCleanupStarted = false
    private val printWebViews = mutableListOf<WebView>()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetBundles = BskAssetBundleManager(this)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }
        }

        // Intercept service-worker fetches too. Older BSK builds may already
        // have a PWA service worker registered on the legacy origin.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest?): WebResourceResponse? {
                    val uri = request?.url ?: return null
                    return interceptLocalAsset(uri)
                }
            })
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url?.startsWith(APP_URL) == true && !serviceWorkerCleanupStarted) {
                    serviceWorkerCleanupStarted = true
                    // Remove only the old PWA worker/cache. Do not touch localStorage
                    // or IndexedDB, which contain the existing login and offline queue.
                    view?.evaluateJavascript(
                        "(async()=>{let changed=false;" +
                            "if(navigator.serviceWorker){const regs=await navigator.serviceWorker.getRegistrations();" +
                            "if(regs.length){await Promise.all(regs.map(r=>r.unregister()));changed=true;}}" +
                            "if(window.caches){const keys=await caches.keys();" +
                            "if(keys.length){await Promise.all(keys.map(k=>caches.delete(k)));changed=true;}}" +
                            "return changed;})()"
                    ) { result ->
                        if (result == "true" && !isFinishing && !isDestroyed) {
                            view?.post { view.reload() }
                        }
                    }
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (url?.startsWith(APP_URL) == true) checkAssetUpdatesIfDue()
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val uri = request?.url ?: return null
                return interceptLocalAsset(uri) ?: super.shouldInterceptRequest(view, request)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: android.webkit.WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                val uri = request?.url
                if (request?.isForMainFrame == true &&
                    uri?.scheme == "https" && uri.host == ASSET_HOST &&
                    assetBundles.rollbackToPrevious()
                ) {
                    view?.post { view.loadUrl(APP_URL) }
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                val uri = request?.url
                if (request?.isForMainFrame == true &&
                    uri?.scheme == "https" && uri.host == ASSET_HOST &&
                    (errorResponse?.statusCode ?: 0) >= 400 &&
                    assetBundles.rollbackToPrevious()
                ) {
                    view?.post { view.loadUrl(APP_URL) }
                }
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return true
                if (uri.scheme == "https" && uri.host == ASSET_HOST) return false
                if (uri.scheme == "https") startActivity(Intent(Intent.ACTION_VIEW, uri))
                return true
            }
        }
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(
            BskDownloadBridge(this) { title, html -> runOnUiThread { openPrintView(title, html) } },
            "BSKAndroidBridge"
        )

        // The UI opens from APK/app-private assets, never from Netlify.
        // DOM storage is intentionally preserved for the login session and offline queue.
        webView.loadUrl(APP_URL)

        // The first page load checks for updates; subsequent page refreshes
        // recheck at most once per minute without interrupting active entry work.
    }

    private fun openPrintView(title: String, html: String) {
        val printView = WebView(this)
        printWebViews.add(printView)
        printView.settings.javaScriptEnabled = false
        printView.webViewClient = object : WebViewClient() {
            private var printStarted = false

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (printStarted || view == null) return
                printStarted = true
                try {
                    val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
                    printManager.print(
                        title,
                        view.createPrintDocumentAdapter(title),
                        PrintAttributes.Builder().build()
                    )
                } catch (error: Exception) {
                    Toast.makeText(this@MainActivity, "Could not open PDF print: ${error.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
        printView.loadDataWithBaseURL(
            "https://bsk-powerhouse-log-bhiwani.netlify.app/",
            html,
            "text/html",
            "UTF-8",
            null
        )
    }

    private fun interceptLocalAsset(uri: Uri): WebResourceResponse? {
        if (uri.scheme != "https" || uri.host != ASSET_HOST) return null
        val path = uri.path.orEmpty().removePrefix("/").ifBlank { "index.html" }
        val stream = assetBundles.openAsset(path)
        if (stream == null) {
            return WebResourceResponse(
                "text/plain",
                "UTF-8",
                404,
                "Not Found",
                mapOf("Cache-Control" to "no-store"),
                ByteArrayInputStream("BSK asset not found".toByteArray())
            )
        }
        val mime = mimeType(path)
        val encoding = if (mime.startsWith("text/") ||
            mime.contains("javascript") || mime.contains("json")
        ) "UTF-8" else null
        return WebResourceResponse(mime, encoding, stream)
    }

    private fun checkAssetUpdatesIfDue() {
        val now = SystemClock.elapsedRealtime()
        if (lastAssetCheckAt != 0L && now - lastAssetCheckAt < 60_000L) return
        lastAssetCheckAt = now
        assetBundles.checkForUpdate { updated ->
            if (updated && !isFinishing) webView.post { webView.reload() }
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(null)
        }
        printWebViews.forEach { it.stopLoading(); it.destroy() }
        printWebViews.clear()
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.webChromeClient = null
            webView.webViewClient = WebViewClient()
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun mimeType(path: String): String {
        return when (path.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "webmanifest" -> "application/manifest+json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "ico" -> "image/x-icon"
            "woff" -> "font/woff"
            "woff2" -> "font/woff2"
            else -> "application/octet-stream"
        }
    }

    companion object {
        private const val ASSET_HOST = "bsk-powerhouse-log-bhiwani.netlify.app"
        private const val APP_URL = "https://bsk-powerhouse-log-bhiwani.netlify.app/index.html?bskLocal=1"
    }
}
