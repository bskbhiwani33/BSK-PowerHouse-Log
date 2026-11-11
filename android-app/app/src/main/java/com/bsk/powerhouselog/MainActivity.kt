package com.bsk.powerhouselog

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var assetBundles: BskAssetBundleManager

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

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val uri = request?.url ?: return null
                if (uri.scheme == "https" && uri.host == ASSET_HOST) {
                    val path = uri.path.orEmpty().removePrefix("/").removePrefix("assets/")
                    val stream = assetBundles.openAsset(path)
                    if (stream != null) {
                        val mime = mimeType(path)
                        val encoding = if (mime.startsWith("text/") ||
                            mime.contains("javascript") || mime.contains("json")
                        ) "UTF-8" else null
                        return WebResourceResponse(mime, encoding, stream)
                    }
                    return WebResourceResponse(
                        "text/plain",
                        "UTF-8",
                        404,
                        "Not Found",
                        mapOf("Cache-Control" to "no-store"),
                        ByteArrayInputStream("BSK asset not found".toByteArray())
                    )
                }
                return super.shouldInterceptRequest(view, request)
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

        // The UI opens from APK/app-private assets, never from Netlify.
        // DOM storage is intentionally preserved for the login session and offline queue.
        webView.loadUrl(APP_URL)

        // Routine UI/form/report updates arrive as a verified asset bundle.
        // A failed or interrupted update leaves the previous bundle untouched.
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
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val APP_URL = "https://appassets.androidplatform.net/assets/index.html"
    }
}
