package com.bsk.powerhouselog

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream

/**
 * Narrow JavaScript bridge for the app's existing Excel-compatible and JSON exports.
 * Files are written to Downloads/BSK on Android 10+, or the app-specific Downloads
 * directory on older Android versions. No broad storage permission is requested.
 */
internal class BskDownloadBridge(
    private val context: Context,
    private val printHandler: (String, String) -> Unit
) {
    companion object {
        private const val TAG = "BSKDownload"
        private const val MAX_FILE_BYTES = 15 * 1024 * 1024
        private const val MAX_BASE64_CHARS = 21 * 1024 * 1024
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun saveBase64File(fileName: String, mimeType: String, base64Data: String) {
        try {
            if (base64Data.length > MAX_BASE64_CHARS) throw IllegalArgumentException("Export is too large")
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            if (bytes.isEmpty() || bytes.size > MAX_FILE_BYTES) {
                throw IllegalArgumentException("Export file size is invalid")
            }
            val safeName = sanitizeFileName(fileName)
            val safeMime = when (mimeType.lowercase()) {
                "application/vnd.ms-excel" -> "application/vnd.ms-excel"
                "application/json" -> "application/json"
                "text/csv" -> "text/csv"
                else -> "application/octet-stream"
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveWithMediaStore(safeName, safeMime, bytes)
                showMessage("Saved to Downloads/BSK/$safeName")
            } else {
                val directory = File(
                    context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    "BSK"
                )
                if (!directory.exists() && !directory.mkdirs()) {
                    throw IllegalStateException("Could not create download folder")
                }
                FileOutputStream(File(directory, safeName)).use { it.write(bytes) }
                showMessage("Saved in BSK app Downloads/$safeName")
            }
        } catch (error: Exception) {
            Log.e(TAG, "Could not save export", error)
            showMessage("Export could not be saved: ${error.message ?: "unknown error"}")
        }
    }

    @JavascriptInterface
    fun printHtml(title: String, html: String) {
        if (html.length > 2 * 1024 * 1024) {
            showMessage("Report is too large to print.")
            return
        }
        val safeTitle = title.replace(Regex("[^A-Za-z0-9 _-]"), "").take(80).ifBlank { "BSK Report" }
        printHandler(safeTitle, html)
    }

    private fun saveWithMediaStore(fileName: String, mimeType: String, bytes: ByteArray) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/BSK")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Could not create Downloads file")
        try {
            resolver.openOutputStream(uri, "w")?.use { it.write(bytes) }
                ?: throw IllegalStateException("Could not open Downloads file")
            val published = ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0)
            }
            resolver.update(uri, published, null, null)
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
    }

    private fun sanitizeFileName(value: String): String {
        val cleaned = value.replace(Regex("[^A-Za-z0-9._-]"), "_").take(100)
        return if (cleaned.isBlank() || cleaned == "." || cleaned == "..") {
            "BSK_Export"
        } else cleaned
    }

    private fun showMessage(message: String) {
        mainHandler.post {
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
        }
    }
}
