package com.bsk.powerhouselog

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipInputStream
import javax.net.ssl.HttpsURLConnection

/**
 * Downloads versioned BSK web assets from Firebase Hosting.
 * The APK contains a fallback copy in assets/. Updates are installed into
 * app-private storage and activated only after HTTPS + SHA-256 + ZIP checks.
 */
internal class BskAssetBundleManager(private val context: Context) {
    companion object {
        private const val TAG = "BSKAssetUpdate"
        private const val MANIFEST_URL = "https://testing-app-8af35.web.app/bsk-updates/manifest.json"
        private const val TRUSTED_HOST = "testing-app-8af35.web.app"
        private const val NATIVE_VERSION = 2L
        private const val MAX_MANIFEST_BYTES = 64 * 1024
        private const val MAX_BUNDLE_BYTES = 25L * 1024L * 1024L
        private const val MAX_UNPACKED_BYTES = 50L * 1024L * 1024L
    }

    private val preferences = context.getSharedPreferences("bsk_asset_updates", Context.MODE_PRIVATE)
    private val root = File(context.filesDir, "bsk-assets")
    private val versions = File(root, "versions")
    private val worker = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        if (!preferences.contains("active_version")) {
            val bundledVersion = try {
                JSONObject(context.assets.open("bsk-release.json").bufferedReader().use { it.readText() })
                    .optLong("version", 0L)
                    .coerceAtLeast(0L)
            } catch (_: Exception) {
                0L
            }
            preferences.edit()
                .putLong("active_version", bundledVersion)
                .putLong("previous_version", 0L)
                .apply()
        }
    }

    fun openAsset(requestPath: String): java.io.InputStream? {
        val clean = requestPath.substringBefore("?").trimStart('/')
        if (clean.isBlank() || clean.split('/').any { it == ".." } || clean.contains('\\')) return null

        val activeVersion = preferences.getLong("active_version", 0L)
        if (activeVersion > 0L) {
            val activeRoot = File(versions, "v$activeVersion")
            val candidate = File(activeRoot, clean)
            if (candidate.canonicalPath.startsWith(activeRoot.canonicalPath + File.separator) &&
                candidate.isFile
            ) {
                return FileInputStream(candidate)
            }
        }

        return try {
            context.assets.open(clean)
        } catch (_: Exception) {
            null
        }
    }

    fun checkForUpdate(onComplete: (Boolean) -> Unit) {
        if (!busy.compareAndSet(false, true)) {
            onComplete(false)
            return
        }
        worker.execute {
            var updated = false
            try {
                updated = downloadAndInstall()
            } catch (error: Exception) {
                Log.w(TAG, "Asset update skipped; keeping last known-good assets", error)
            } finally {
                busy.set(false)
                mainHandler.post { onComplete(updated) }
            }
        }
    }

    private fun downloadAndInstall(): Boolean {
        val manifestBytes = downloadHttps(URL(MANIFEST_URL), MAX_MANIFEST_BYTES)
        val manifest = JSONObject(String(manifestBytes, Charsets.UTF_8))
        val version = manifest.getLong("version")
        val minimumNative = manifest.optLong("minNativeVersion", 1L)
        if (version <= 0L || minimumNative <= 0L) throw IOException("Invalid update version")
        if (minimumNative > NATIVE_VERSION) {
            Log.w(TAG, "Update requires a newer BSK Android container")
            return false
        }

        val currentVersion = preferences.getLong("active_version", 0L)
        if (version <= currentVersion) return false

        val bundleUrl = URL(manifest.getString("bundleUrl"))
        if (bundleUrl.protocol != "https" || bundleUrl.host != TRUSTED_HOST ||
            !bundleUrl.path.startsWith("/bsk-updates/")
        ) {
            throw IOException("Untrusted asset bundle URL")
        }

        val expectedHash = manifest.getString("sha256").lowercase()
        if (!Regex("^[0-9a-f]{64}$").matches(expectedHash)) throw IOException("Invalid bundle checksum")
        val bundleBytes = downloadHttps(bundleUrl, MAX_BUNDLE_BYTES)
        val actualHash = MessageDigest.getInstance("SHA-256")
            .digest(bundleBytes)
            .joinToString("") { "%02x".format(it) }
        if (!MessageDigest.isEqual(
                expectedHash.toByteArray(Charsets.US_ASCII),
                actualHash.toByteArray(Charsets.US_ASCII)
            )
        ) {
            throw IOException("Asset bundle checksum mismatch")
        }

        versions.mkdirs()
        val staging = File(versions, ".staging-$version")
        staging.deleteRecursively()
        if (!staging.mkdirs()) throw IOException("Could not create update staging folder")
        try {
            extractSafely(bundleBytes, staging)
            validateBundle(staging)

            val installed = File(versions, "v$version")
            installed.deleteRecursively()
            if (!staging.renameTo(installed)) throw IOException("Could not activate downloaded asset bundle")
            if (!preferences.edit()
                    .putLong("previous_version", currentVersion)
                    .putLong("active_version", version)
                    .commit()
            ) {
                installed.deleteRecursively()
                throw IOException("Could not save active asset version")
            }
            keepCurrentAndPrevious(version, currentVersion)
            Log.i(TAG, "Installed BSK asset version $version")
            return true
        } catch (error: Exception) {
            staging.deleteRecursively()
            throw error
        }
    }

    private fun downloadHttps(url: URL, maximumBytes: Long): ByteArray {
        if (url.protocol != "https" || url.host != TRUSTED_HOST) throw IOException("HTTPS host is not trusted")
        val connection = (url.openConnection() as HttpsURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = false
            requestMethod = "GET"
            setRequestProperty("Accept", "*/*")
        }
        try {
            val status = connection.responseCode
            if (status !in 200..299) throw IOException("Update server returned HTTP $status")
            if (connection.contentLengthLong > maximumBytes) throw IOException("Update file is too large")
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8 * 1024)
                var total = 0L
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > maximumBytes) throw IOException("Update file exceeded size limit")
                    output.write(buffer, 0, count)
                }
            }
            return output.toByteArray()
        } finally {
            connection.disconnect()
        }
    }

    private fun extractSafely(bytes: ByteArray, destination: File) {
        val destinationPath = destination.canonicalPath + File.separator
        var totalUnpacked = 0L
        var fileCount = 0
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val normalized = entry.name.replace('\\', '/')
                if (normalized.startsWith("/") || normalized.split('/').any { it == ".." }) {
                    throw IOException("Unsafe path in update bundle")
                }
                val target = File(destination, normalized)
                val targetPath = target.canonicalPath
                if (!targetPath.startsWith(destinationPath)) throw IOException("Update path escaped staging folder")
                if (entry.isDirectory) {
                    target.mkdirs()
                } else {
                    fileCount += 1
                    if (fileCount > 100) throw IOException("Too many files in update bundle")
                    target.parentFile?.mkdirs()
                    FileOutputStream(target).use { output ->
                        val buffer = ByteArray(8 * 1024)
                        while (true) {
                            val count = zip.read(buffer)
                            if (count < 0) break
                            totalUnpacked += count
                            if (totalUnpacked > MAX_UNPACKED_BYTES) throw IOException("Unpacked update is too large")
                            output.write(buffer, 0, count)
                        }
                    }
                }
                zip.closeEntry()
            }
        }
    }

    private fun validateBundle(folder: File) {
        val required = listOf("index.html", "app.js", "style.css", "bsk-config.js", "manifest.webmanifest")
        required.forEach { name ->
            val file = File(folder, name)
            if (!file.isFile || file.length() == 0L) throw IOException("Update bundle is missing $name")
        }
        val config = File(folder, "bsk-config.js").readText()
        if (!config.contains("bskLocal") ||
            !config.contains("asia-south1-testing-app-8af35.cloudfunctions.net")
        ) {
            throw IOException("Android runtime configuration is missing")
        }
    }

    fun rollbackToPrevious(): Boolean {
        val current = preferences.getLong("active_version", 0L)
        if (current <= 0L) return false
        val previous = preferences.getLong("previous_version", 0L)
        return preferences.edit()
            .putLong("active_version", previous)
            .putLong("previous_version", 0L)
            .commit()
    }

    private fun keepCurrentAndPrevious(newVersion: Long, oldVersion: Long) {
        val keep = setOf("v$newVersion", "v$oldVersion")
        versions.listFiles()?.filter { it.isDirectory && it.name.startsWith("v") && it.name !in keep }
            ?.forEach { it.deleteRecursively() }
    }
}
