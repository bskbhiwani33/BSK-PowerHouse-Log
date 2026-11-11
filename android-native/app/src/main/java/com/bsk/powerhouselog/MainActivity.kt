package com.bsk.powerhouselog

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

private const val LOGIN_API =
    "https://bsk-powerhouse-log-bhiwani.netlify.app/.netlify/functions/login"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                BSKApp()
            }
        }
    }
}

private data class BSKProfile(
    val userId: String,
    val role: String,
    val houseId: String,
    val houseName: String
)

@Composable
private fun BSKApp() {
    var userId by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var profile by remember { mutableStateOf<BSKProfile?>(null) }
    val scope = rememberCoroutineScope()

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface
    ) {
        if (profile == null) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = "BSK",
                    fontSize = 38.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "Power House Feeder Management",
                    fontSize = 15.sp
                )
                Spacer(Modifier.height(24.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                    elevation = CardDefaults.cardElevation(defaultElevation = 3.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(22.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text("Login", fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        OutlinedTextField(
                            value = userId,
                            onValueChange = { userId = it.trim(); error = "" },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("User ID") },
                            singleLine = true,
                            enabled = !loading
                        )
                        OutlinedTextField(
                            value = pin,
                            onValueChange = {
                                if (it.length <= 4 && it.all(Char::isDigit)) {
                                    pin = it
                                    error = ""
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("4-digit PIN") },
                            singleLine = true,
                            enabled = !loading,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.NumberPassword
                            )
                        )
                        Button(
                            onClick = {
                                scope.launch {
                                    loading = true
                                    error = ""
                                    try {
                                        profile = authenticate(userId, pin)
                                    } catch (e: Exception) {
                                        error = e.message ?: "Login failed. Please try again."
                                    } finally {
                                        loading = false
                                    }
                                }
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(52.dp),
                            enabled = !loading && userId.isNotBlank() && pin.length == 4
                        ) {
                            if (loading) {
                                CircularProgressIndicator()
                            } else {
                                Text("LOGIN")
                            }
                        }
                        if (error.isNotBlank()) {
                            Text(error, color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                Spacer(Modifier.height(18.dp))
                Text(
                    "Standalone Android application",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            NativeHome(
                profile = profile!!,
                onSignOut = {
                    FirebaseAuth.getInstance().signOut()
                    profile = null
                    pin = ""
                }
            )
        }
    }
}

private suspend fun authenticate(userId: String, pin: String): BSKProfile {
    require(userId.matches(Regex("[A-Za-z0-9_-]{3,40}"))) {
        "Enter a valid User ID."
    }
    require(pin.matches(Regex("[0-9]{4}"))) {
        "Enter your 4-digit PIN."
    }

    val response = withContext(Dispatchers.IO) {
        val connection = (URL(LOGIN_API).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 15000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
        }
        try {
            val payload = JSONObject()
                .put("userId", userId)
                .put("pin", pin)
                .toString()
            connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = JSONObject(body.ifBlank { "{}" })
            if (status !in 200..299) {
                throw IllegalStateException(
                    json.optString("error", "Login failed. Please try again.")
                )
            }
            json
        } finally {
            connection.disconnect()
        }
    }

    val token = response.optString("token")
    check(token.isNotBlank()) { "Login service returned an invalid response." }

    // Exchange the server-issued custom token for a Firebase Auth session.
    FirebaseAuth.getInstance().signInWithCustomToken(token).await()

    val data = response.getJSONObject("profile")
    val role = data.optString("role")
    check(role == "admin" || role == "staff") {
        "Your account role is not configured. Contact Admin."
    }

    return BSKProfile(
        userId = data.optString("userId", userId),
        role = role,
        houseId = data.optString("houseId"),
        houseName = data.optString("houseName")
    )
}

@Composable
private fun NativeHome(profile: BSKProfile, onSignOut: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("BSK", fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text(
            if (profile.role == "admin") "Admin Dashboard" else "Staff Dashboard",
            fontSize = 23.sp,
            fontWeight = FontWeight.SemiBold
        )
        Text("User ID: ${profile.userId}")
        Text("Role: ${profile.role}")
        if (profile.houseName.isNotBlank()) {
            Text("Power House: ${profile.houseName}")
        }
        Text(
            "Secure login is connected. Dashboard modules and reporting forms are the next build stage.",
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.weight(1f))
        Button(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) {
            Text("LOG OUT")
        }
    }
}
