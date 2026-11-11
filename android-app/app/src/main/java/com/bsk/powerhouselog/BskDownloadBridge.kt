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
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Narrow JavaScript bridge for report exports, JSON backups, and PDF printing.
 * File data is streamed in chunks to an app-private temporary file before it is
 * published to Downloads. No broad storage permission is requested.
 */
internal class BskDownloadBridge(
    private val context: Context,
    private val printHandler: (String, String) -> Unit
) {
    private data class PendingDownload(
        val fileName: String,
        val mimeType: String,
        val tempFile: File,
        val output: FileOutputStream,
        var bytesWritten: Long = 0L
    )

    companion object {
        private const val TAG = "BSKDownload"
        private const val MAX_FILE_BYTES = 100L * 1024L * 1024L
        private const val MAX_CHUNK_BASE64_CHARS = 512 * 1024
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val pending = ConcurrentHashMap<String, PendingDownload>()

    init {
        context.cacheDir.listFiles()
            ?.filter { it.name.startsWith("bsk-export-") && it.name.endsWith(".tmp") }
            ?.forEach { it.delete() }
    }

    @JavascriptInterface
    fun beginFile(fileName: String, mimeType: String): String {
        return try {
            val id = UUID.randomUUID().toString().replace("-", "")
            val safeName = sanitizeFileName(fileName)
            val safeMime = sanitizeMimeType(mimeType)
            val tempFile = File(context.cacheDir, "bsk-export-$id.tmp")
            val output = FileOutputStream(tempFile)
            pending[id] = PendingDownload(safeName, safeMime, tempFile, output)
            id
        } catch (error: Exception) {
            Log.e(TAG, "Could not start export", error)
            showMessage("Could not start export: ${error.message ?: "unknown error"}")
            ""
        }
    }

    @JavascriptInterface
    fun appendFileChunk(id: String, base64Chunk: String): Boolean {
        val download = pending[id] ?: return false
        return try {
            if (base64Chunk.isEmpty() || base64Chunk.length > MAX_CHUNK_BASE64_CHARS) {
                throw IllegalArgumentException("Invalid export chunk")
            }
            val bytes = Base64.decode(base64Chunk, Base64.DEFAULT)
            if (download.bytesWritten + bytes.size > MAX_FILE_BYTES) {
                throw IllegalArgumentException("Export exceeds 100 MB")
            }
            download.output.write(bytes)
            download.bytesWritten += bytes.size
            true
        } catch (error: Exception) {
            Log.e(TAG, "Could not append export chunk", error)
            cancelFileInternal(id)
            showMessage("Export could not be written: ${error.message ?: "unknown error"}")
            false
        }
    }

    @JavascriptInterface
    fun finishFile(id: String): Boolean {
        val download = pending.remove(id) ?: return false
        return try {
            download.output.flush()
            download.output.close()
            if (download.bytesWritten <= 0L) throw IllegalArgumentException("Export file is empty")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveWithMediaStore(download)
                showMessage("Saved to Downloads/BSK/${download.fileName}")
            } else {
                saveToAppDownloads(download)
                showMessage("Saved in BSK app Downloads/${download.fileName}")
            }
            download.tempFile.delete()
            true
        } catch (error: Exception) {
            try { download.output.close() } catch (_: Exception) {}
            download.tempFile.delete()
            Log.e(TAG, "Could not finish export", error)
            showMessage("Export could not be saved: ${error.message ?: "unknown error"}")
            false
        }
    }

    @JavascriptInterface
    fun cancelFile(id: String) {
        cancelFileInternal(id)
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

    private fun saveWithMediaStore(download: PendingDownload) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, download.fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, download.mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/BSK")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Could not create Downloads file")
        try {
            resolver.openOutputStream(uri, "w")?.use { output ->
                FileInputStream(download.tempFile).use { input -> input.copyTo(output) }
            } ?: throw IllegalStateException("Could not open Downloads file")
            val published = ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0)
            }
            resolver.update(uri, published, null, null)
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
    }

    private fun saveToAppDownloads(download: PendingDownload) {
        val baseDirectory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: context.filesDir
        val directory = File(baseDirectory, "BSK")
        if (!directory.exists() && !directory.mkdirs()) {
            throw IllegalStateException("Could not create download folder")
        }
        download.tempFile.copyTo(File(directory, download.fileName), overwrite = true)
    }

    private fun cancelFileInternal(id: String) {
        val download = pending.remove(id) ?: return
        try { download.output.close() } catch (_: Exception) {}
        download.tempFile.delete()
    }

    private fun sanitizeFileName(value: String): String {
        val cleaned = value.replace(Regex("[^A-Za-z0-9._-]"), "_").take(100)
        return if (cleaned.isBlank() || cleaned == "." || cleaned == "..") "BSK_Export" else cleaned
    }

    private fun sanitizeMimeType(value: String): String {
        return when (value.lowercase()) {
            "application/vnd.ms-excel" -> "application/vnd.ms-excel"
            "application/json" -> "application/json"
            "text/csv" -> "text/csv"
            else -> "application/octet-stream"
        }
    }

    private fun showMessage(message: String) {
        mainHandler.post {
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
        }
    }
}
