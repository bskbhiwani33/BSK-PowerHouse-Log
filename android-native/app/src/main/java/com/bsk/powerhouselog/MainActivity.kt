package com.bsk.powerhouselog

import android.os.Bundle
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
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
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

private const val BASE_API = "https://bsk-powerhouse-log-bhiwani.netlify.app/.netlify/functions"
private const val LOGIN_API = "$BASE_API/login"
private const val ADMIN_API = "$BASE_API/admin"
private const val RECORDS_API = "$BASE_API/records"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { BSKApp() } }
    }
}

private data class BSKProfile(
    val userId: String,
    val role: String,
    val houseId: String,
    val houseName: String
)

private data class DashboardData(
    val houses: List<JSONObject> = emptyList(),
    val feeders: List<JSONObject> = emptyList(),
    val users: List<JSONObject> = emptyList(),
    val reports: List<JSONObject> = emptyList(),
    val breakdowns: List<JSONObject> = emptyList(),
    val shutdowns: List<JSONObject> = emptyList(),
    val trippings: List<JSONObject> = emptyList(),
    val consumption: List<JSONObject> = emptyList(),
    val supplyPositions: List<JSONObject> = emptyList(),
    val history: List<JSONObject> = emptyList(),
    val notifications: List<JSONObject> = emptyList(),
    val error: String = ""
)

@Composable
private fun BSKApp() {
    var userId by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var profile by remember { mutableStateOf<BSKProfile?>(null) }
    var dashboard by remember { mutableStateOf(DashboardData()) }
    val scope = rememberCoroutineScope()

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        if (profile == null) {
            Column(
                Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("BSK", fontSize = 40.sp, fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary)
                Text("Power House Feeder Management")
                Spacer(Modifier.height(24.dp))
                Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp)) {
                    Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text("Login", fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        OutlinedTextField(userId, { userId = it.trim(); error = "" },
                            Modifier.fillMaxWidth(), label = { Text("User ID") },
                            singleLine = true, enabled = !loading)
                        OutlinedTextField(pin, {
                            if (it.length <= 4 && it.all(Char::isDigit)) { pin = it; error = "" }
                        }, Modifier.fillMaxWidth(), label = { Text("4-digit PIN") },
                            singleLine = true, enabled = !loading,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                        Button(onClick = {
                            scope.launch {
                                loading = true; error = ""
                                try {
                                    profile = authenticate(userId, pin)
                                    dashboard = loadDashboard(profile!!)
                                } catch (e: Exception) {
                                    FirebaseAuth.getInstance().signOut()
                                    profile = null
                                    error = e.message ?: "Login failed. Please try again."
                                } finally { loading = false }
                            }
                        }, Modifier.fillMaxWidth().height(52.dp),
                            enabled = !loading && userId.isNotBlank() && pin.length == 4) {
                            if (loading) CircularProgressIndicator(Modifier.size(22.dp))
                            else Text("LOGIN")
                        }
                        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                    }
                }
                Spacer(Modifier.height(16.dp))
                Text("Standalone Android application", fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            NativeDashboard(
                profile = profile!!,
                data = dashboard,
                loading = loading,
                onRefresh = {
                    scope.launch {
                        loading = true
                        dashboard = try { loadDashboard(profile!!) }
                        catch (e: Exception) { dashboard.copy(error = e.message ?: "Refresh failed") }
                        loading = false
                    }
                },
                onSubmitEntry = { action, payload ->
                    scope.launch {
                        loading = true
                        try {
                            val token = FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
                                ?: error("Please sign in again.")
                            postJson(RECORDS_API, payload.put("action", action), token)
                            dashboard = loadDashboard(profile!!)
                        } catch (e: Exception) {
                            dashboard = dashboard.copy(error = e.message ?: "Entry save failed")
                        } finally { loading = false }
                    }
                },
                onAdminAction = { payload ->
                    scope.launch {
                        loading = true
                        try {
                            val token = FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
                                ?: error("Please sign in again.")
                            postJson(ADMIN_API, payload, token)
                            dashboard = loadDashboard(profile!!)
                        } catch (e: Exception) {
                            dashboard = dashboard.copy(error = e.message ?: "Admin action failed")
                        } finally { loading = false }
                    }
                },
                onSignOut = {
                    FirebaseAuth.getInstance().signOut()
                    profile = null; dashboard = DashboardData(); pin = ""
                }
            )
        }
    }
}

@Composable
private fun NativeDashboard(
    profile: BSKProfile,
    data: DashboardData,
    loading: Boolean,
    onRefresh: () -> Unit,
    onSubmitEntry: (String, JSONObject) -> Unit,
    onAdminAction: (JSONObject) -> Unit,
    onSignOut: () -> Unit
) {
    val context = LocalContext.current
    val exportScope = rememberCoroutineScope()
    var exporting by remember { mutableStateOf(false) }
    var exportContent by remember { mutableStateOf("") }
    var backupContent by remember { mutableStateOf("") }
    var backupError by remember { mutableStateOf("") }
    val backupLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
        if (uri != null) {
            runCatching {
                context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(backupContent) }
                    ?: error("Could not write the backup file.")
            }.onFailure { backupError = it.message ?: "Could not save backup file." }
        }
        exporting = false
    }
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri: Uri? ->
        if (uri != null) runCatching {
            context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(exportContent) }
        }
    }
    val ongoingBreakdowns = data.breakdowns.filter { it.optString("status") == "ongoing" }
    val ongoingShutdowns = data.shutdowns.filter { it.optString("status") == "ongoing" }
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("BSK", fontSize = 30.sp, fontWeight = FontWeight.Bold)
                    Text(if (profile.role == "admin") "Admin Dashboard" else "Staff Dashboard",
                        fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                }
                TextButton(onClick = onSignOut) { Text("LOG OUT") }
            }
            Text("User ID: ${profile.userId}")
            if (profile.houseName.isNotBlank()) Text("Power House: ${profile.houseName}")
            Spacer(Modifier.height(4.dp))
            Button(onClick = onRefresh, enabled = !loading, modifier = Modifier.fillMaxWidth()) {
                if (loading) CircularProgressIndicator(Modifier.size(18.dp))
                else Text("REFRESH DATA")
            }
            if (data.error.isNotBlank()) Text(data.error, color = MaterialTheme.colorScheme.error)
        }
        item {
            Text("Ongoing Feeder Status", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricCard("Breakdown", ongoingBreakdowns.size.toString(), Modifier.weight(1f))
                MetricCard("Shutdown", ongoingShutdowns.size.toString(), Modifier.weight(1f))
            }
        }
        item { Text("Ongoing Breakdown Feeders", fontWeight = FontWeight.SemiBold) }
        if (ongoingBreakdowns.isEmpty()) item { EmptyLine("No ongoing Breakdown") }
        items(ongoingBreakdowns) { row -> OutageRow(row, "Breakdown") { endTime ->
            onSubmitEntry("resolveBreakdown", JSONObject().put("id", row.optString("id")).put("endTime", endTime))
        } }
        item { Text("Ongoing Shutdown Feeders", fontWeight = FontWeight.SemiBold) }
        if (ongoingShutdowns.isEmpty()) item { EmptyLine("No ongoing Shutdown") }
        items(ongoingShutdowns) { row -> OutageRow(row, "Shutdown") { endTime ->
            onSubmitEntry("resolveShutdown", JSONObject().put("id", row.optString("id")).put("endTime", endTime))
        } }

        if (profile.role == "staff") {
            item { NativeEntryForms(feeders = data.feeders, loading = loading, onSubmit = onSubmitEntry) }
        }
        if (profile.role == "admin") {
            item { AdminManagementForms(data = data, loading = loading, onAction = onAdminAction) }
            item { Text("Administration Overview", fontWeight = FontWeight.Bold, fontSize = 18.sp) }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MetricCard("Power Houses", data.houses.size.toString(), Modifier.weight(1f))
                    MetricCard("Feeders", data.feeders.size.toString(), Modifier.weight(1f))
                    MetricCard("Staff", data.users.count { it.optString("role") == "staff" && it.optBoolean("active") }.toString(), Modifier.weight(1f))
                }
            }
            item {
                Text("Download Excel-compatible CSV", fontWeight = FontWeight.SemiBold)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Button(onClick = {
                        exportScope.launch {
                            exporting = true
                            backupError = ""
                            runCatching {
                                backupContent = loadFullBackup()
                                backupLauncher.launch("BSK_Full_Backup.json")
                            }.onFailure {
                                backupError = it.message ?: "Backup failed. Please try again."
                                exporting = false
                            }
                        }
                    }, enabled = !exporting, modifier = Modifier.fillMaxWidth()) {
                        Text("DOWNLOAD FULL JSON BACKUP")
                    }
                    if (backupError.isNotBlank()) Text(backupError, color = MaterialTheme.colorScheme.error)
                    Button(onClick = {
                        exportScope.launch {
                            exporting = true
                            runCatching {
                                val rows = loadAllRecords("breakdowns")
                                exportContent = csvDocument(listOf("Date","Power House","Feeder","Start Time","End Time","PTW Time","Reason","Status"),
                                    rows.map { listOf(it.optString("date"),it.optString("houseName"),it.optString("feederName"),it.optString("startTime"),it.optString("endTime"),it.optString("ptwTakenOnTime"),it.optString("reason"),it.optString("status")) })
                                exportLauncher.launch("BSK_Breakdown.csv")
                            }.onFailure { }
                            exporting = false
                        }
                    }, enabled = !exporting, modifier = Modifier.fillMaxWidth()) { Text("EXPORT BREAKDOWN CSV") }
                    Button(onClick = {
                        exportScope.launch {
                            exporting = true
                            runCatching {
                                val rows = loadAllRecords("shutdowns")
                                exportContent = csvDocument(listOf("Date","Power House","Feeder","Start Time","End Time","PTW Time","Reason","Status"),
                                    rows.map { listOf(it.optString("date"),it.optString("houseName"),it.optString("feederName"),it.optString("startTime"),it.optString("endTime"),it.optString("ptwTakenOnTime"),it.optString("reason"),it.optString("status")) })
                                exportLauncher.launch("BSK_Shutdown.csv")
                            }.onFailure { }
                            exporting = false
                        }
                    }, enabled = !exporting, modifier = Modifier.fillMaxWidth()) { Text("EXPORT SHUTDOWN CSV") }
                    Button(onClick = {
                        exportScope.launch {
                            exporting = true
                            runCatching {
                                val rows = loadAllRecords("consumption_readings")
                                exportContent = csvDocument(listOf("Date","Power House","AP Feeder","Rural Domestic","Urban","Industrial","Independent","Total"),
                                    rows.map { listOf(it.optString("date"),it.optString("houseName"),it.optString("apFeeder"),it.optString("ruralDomestic"),it.optString("urban"),it.optString("industrial"),it.optString("independent"),it.optString("total")) })
                                exportLauncher.launch("BSK_Consumption.csv")
                            }.onFailure { }
                            exporting = false
                        }
                    }, enabled = !exporting, modifier = Modifier.fillMaxWidth()) { Text("EXPORT CONSUMPTION CSV") }
                }
            }
            item {
                val unread = data.notifications.count { !it.optBoolean("read") }
                Text("Admin Inbox ($unread unread)", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            }
            if (data.notifications.isEmpty()) item { EmptyLine("No new-entry notifications") }
            items(data.notifications.take(30)) { notification ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(notification.optString("title", "New entry"), fontWeight = FontWeight.SemiBold)
                        Text(notification.optString("message"))
                        Text("${notification.optString("recordCollection")} • ${notification.optString("recordId")}", fontSize = 12.sp)
                        if (!notification.optBoolean("read")) {
                            Button(onClick = { onSubmitEntry("markNotificationRead", JSONObject().put("id", notification.optString("id"))) },
                                enabled = !loading, modifier = Modifier.fillMaxWidth()) { Text("MARK AS READ") }
                        } else Text("Read", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item { Text("Recent Audit History", fontWeight = FontWeight.SemiBold) }
            items(data.history.take(30)) { row ->
                InfoCard(row.optString("recordCollection"), "${row.optString("action")} • ${row.optString("recordId")}",
                    "${row.optString("actorUserId")} • ${row.optString("actorRole")}")
            }
            item { Text("Recent Feeder Reports (${data.reports.size})", fontWeight = FontWeight.SemiBold) }
            items(data.reports.take(20)) { report ->
                InfoCard(
                    report.optString("feederName", "Feeder"),
                    "${report.optString("houseName")} • ${report.optString("reportDate")}",
                    "Breaker: ${report.optString("breakerStatus")} • ${report.optString("remarks")}"
                )
            }
        } else {
            item {
                InfoCard("Assigned Power House", profile.houseName.ifBlank { "Not assigned" },
                    "Only your assigned Power House records are requested from the backend.")
            }
            item { Text("Your Recent Entries", fontWeight = FontWeight.Bold, fontSize = 18.sp) }
            item { InfoCard("Breakdown history", data.breakdowns.size.toString(), "Records returned by secure Records API") }
            item { InfoCard("Shutdown history", data.shutdowns.size.toString(), "Records returned by secure Records API") }
            item { InfoCard("Tripping entries", data.trippings.size.toString(), "Records returned by secure Records API") }
            item { InfoCard("Consumption entries", data.consumption.size.toString(), "Records returned by secure Records API") }
            item { InfoCard("Supply Position entries", data.supplyPositions.size.toString(), "Records returned by secure Records API") }
            item { Text("Your Entry History", fontWeight = FontWeight.SemiBold) }
            items(data.history.take(30)) { row ->
                InfoCard(row.optString("recordCollection"), row.optString("action"),
                    "${row.optString("recordId")} • ${row.optString("actorUserId")}")
            }
        }
        item {
            Text("Data is synchronized with the secure BSK backend. Resolve ongoing events here using the actual restoration time.",
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun NativeEntryForms(
    feeders: List<JSONObject>,
    loading: Boolean,
    onSubmit: (String, JSONObject) -> Unit
) {
    var form by remember { mutableStateOf("Breakdown") }
    var date by remember { mutableStateOf("") }
    var feederId by remember { mutableStateOf("") }
    var start by remember { mutableStateOf("") }
    var end by remember { mutableStateOf("") }
    var ptw by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var trips by remember { mutableStateOf("") }
    var feederCount by remember { mutableStateOf("") }
    var ap by remember { mutableStateOf("") }
    var rural by remember { mutableStateOf("") }
    var urban by remember { mutableStateOf("") }
    var industrial by remember { mutableStateOf("") }
    var independent by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    val selected = feeders.firstOrNull { it.optString("id") == feederId }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text("New Entry", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    listOf("Breakdown", "Shutdown").forEach {
                        FilterChip(selected = form == it, onClick = { form = it }, label = { Text(it) })
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    listOf("Tripping", "Consumption").forEach {
                        FilterChip(selected = form == it, onClick = { form = it }, label = { Text(it) })
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    listOf("Supply Position", "Daily Report").forEach {
                        FilterChip(selected = form == it, onClick = { form = it }, label = { Text(it) })
                    }
                }
            }
            OutlinedTextField(date, { date = it }, Modifier.fillMaxWidth(), label = { Text("Date (YYYY-MM-DD)") }, singleLine = true)
            if (form == "Breakdown" || form == "Shutdown") {
                Box {
                    OutlinedButton(onClick = { expanded = true }, Modifier.fillMaxWidth()) {
                        Text(selected?.optString("name") ?: "Select Feeder")
                    }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        feeders.forEach { f ->
                            DropdownMenuItem(text = { Text(f.optString("name")) }, onClick = {
                                feederId = f.optString("id"); expanded = false
                            })
                        }
                    }
                }
                OutlinedTextField(start, { start = it }, Modifier.fillMaxWidth(), label = { Text("Start Time (HH:MM)") }, singleLine = true)
                OutlinedTextField(ptw, { ptw = it }, Modifier.fillMaxWidth(), label = { Text("PTW Taken on Time (HH:MM)") }, singleLine = true)
                OutlinedTextField(reason, { reason = it }, Modifier.fillMaxWidth(), label = { Text("Reason") }, minLines = 2)
                OutlinedTextField(end, { end = it }, Modifier.fillMaxWidth(), label = { Text("End Time (HH:MM) — blank if ongoing") }, singleLine = true)
                Text("End Time khali chhodne par entry Ongoing save hogi.", fontSize = 12.sp)
            } else if (form == "Tripping") {
                OutlinedTextField(trips, { trips = it.filter(Char::isDigit) }, Modifier.fillMaxWidth(), label = { Text("How many Trippings?") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                OutlinedTextField(feederCount, { feederCount = it.filter(Char::isDigit) }, Modifier.fillMaxWidth(), label = { Text("On how many Feeders?") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            } else if (form == "Consumption") {
                OutlinedTextField(ap, { ap = it }, Modifier.fillMaxWidth(), label = { Text("AP Feeder") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(rural, { rural = it }, Modifier.fillMaxWidth(), label = { Text("Rural Domestic") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(urban, { urban = it }, Modifier.fillMaxWidth(), label = { Text("Urban") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(industrial, { industrial = it }, Modifier.fillMaxWidth(), label = { Text("Industrial") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(independent, { independent = it }, Modifier.fillMaxWidth(), label = { Text("Independent") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                val total = listOf(ap, rural, urban, industrial, independent).sumOf { it.toDoubleOrNull() ?: 0.0 }
                Text("Total Reading: $total", fontWeight = FontWeight.SemiBold)
            } else if (form == "Supply Position") {
                SupplyPositionFields(date, feeders, loading, onSubmit)
            } else {
                DailyReportFields(date, feeders, loading, onSubmit)
            }
            if (form != "Supply Position" && form != "Daily Report") {
            Button(onClick = {
                val p = JSONObject().put("date", date.trim())
                val action = when (form) {
                    "Breakdown", "Shutdown" -> {
                        p.put("feederId", feederId).put("startTime", start.trim()).put("endTime", end.trim())
                            .put("ptwTakenOnTime", ptw.trim()).put("reason", reason.trim())
                        if (form == "Breakdown") "createBreakdown" else "createShutdown"
                    }
                    "Tripping" -> { p.put("trippingCount", trips.toIntOrNull()).put("feederCount", feederCount.toIntOrNull()); "createTripping" }
                    "Consumption" -> {
                        p.put("apFeeder", ap.toDoubleOrNull()).put("ruralDomestic", rural.toDoubleOrNull())
                            .put("urban", urban.toDoubleOrNull()).put("industrial", industrial.toDoubleOrNull())
                            .put("independent", independent.toDoubleOrNull())
                        "createConsumption"
                    }
                    else -> return@Button
                }
                onSubmit(action, p)
            }, enabled = !loading && date.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) && when (form) {
                "Breakdown", "Shutdown" -> feederId.isNotBlank() && start.matches(Regex("([01]\\d|2[0-3]):[0-5]\\d")) &&
                    ptw.matches(Regex("([01]\\d|2[0-3]):[0-5]\\d") ) && reason.isNotBlank() &&
                    (end.isBlank() || end.matches(Regex("([01]\\d|2[0-3]):[0-5]\\d")))
                "Tripping" -> trips.toIntOrNull() != null && feederCount.toIntOrNull() != null
                "Consumption" -> listOf(ap, rural, urban, industrial, independent).all { it.toDoubleOrNull() != null && (it.toDoubleOrNull() ?: -1.0) >= 0 }
                else -> false
            }, modifier = Modifier.fillMaxWidth()) {
                if (loading) CircularProgressIndicator(Modifier.size(18.dp)) else Text("SAVE ENTRY")
            }
            }
            Text("Entry backend par seedhi save hoti hai; approval ki zaroorat nahi.", fontSize = 12.sp)
        }
    }
}

@Composable
private fun SupplyPositionFields(
    date: String,
    feeders: List<JSONObject>,
    loading: Boolean,
    onSubmit: (String, JSONObject) -> Unit
) {
    val statuses = remember(feeders) { mutableStateMapOf<String, String>() }
    val starts = remember(feeders) { mutableStateMapOf<String, String>() }
    val ptws = remember(feeders) { mutableStateMapOf<String, String>() }
    val reasons = remember(feeders) { mutableStateMapOf<String, String>() }
    var menu by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Supply Position — Select status for every active feeder", fontWeight = FontWeight.SemiBold)
        feeders.forEach { feeder ->
            val id = feeder.optString("id")
            val status = statuses[id].orEmpty()
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(feeder.optString("name"), fontWeight = FontWeight.SemiBold)
                    Box {
                        OutlinedButton(onClick = { menu = id }, Modifier.fillMaxWidth()) { Text(status.ifBlank { "Select Closed / Opened status" }) }
                        DropdownMenu(expanded = menu == id, onDismissRequest = { menu = "" }) {
                            listOf("Running", "Breakdown", "Shutdown").forEach { option ->
                                DropdownMenuItem(text = { Text(if (option == "Running") "Closed — Running" else "Opened — $option") },
                                    onClick = { statuses[id] = option; menu = "" })
                            }
                        }
                    }
                    if (status == "Breakdown") {
                        OutlinedTextField(starts[id].orEmpty(), { starts[id] = it }, Modifier.fillMaxWidth(), label = { Text("Breakdown Time (HH:MM)") }, singleLine = true)
                        OutlinedTextField(ptws[id].orEmpty(), { ptws[id] = it }, Modifier.fillMaxWidth(), label = { Text("PTW Taken on Time (HH:MM)") }, singleLine = true)
                    } else if (status == "Shutdown") {
                        OutlinedTextField(ptws[id].orEmpty(), { ptws[id] = it }, Modifier.fillMaxWidth(), label = { Text("PTW Taken on Time (HH:MM)") }, singleLine = true)
                        OutlinedTextField(reasons[id].orEmpty(), { reasons[id] = it }, Modifier.fillMaxWidth(), label = { Text("Shutdown Reason") }, minLines = 2)
                    }
                }
            }
        }
        Button(onClick = {
            val rows = JSONArray()
            feeders.forEach { f ->
                val id = f.optString("id")
                val row = JSONObject().put("feederId", id).put("status", statuses[id])
                if (statuses[id] == "Breakdown") row.put("startTime", starts[id]).put("ptwTakenOnTime", ptws[id])
                if (statuses[id] == "Shutdown") row.put("ptwTakenOnTime", ptws[id]).put("reason", reasons[id])
                rows.put(row)
            }
            onSubmit("createSupplyPosition", JSONObject().put("date", date).put("feeders", rows))
        }, enabled = !loading && date.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) && feeders.isNotEmpty() && feeders.all { f ->
            val id=f.optString("id")
            when(statuses[id]) {
                "Running" -> true
                "Breakdown" -> starts[id].orEmpty().matches(Regex("([01]\\d|2[0-3]):[0-5]\\d")) && ptws[id].orEmpty().matches(Regex("([01]\\d|2[0-3]):[0-5]\\d"))
                "Shutdown" -> ptws[id].orEmpty().matches(Regex("([01]\\d|2[0-3]):[0-5]\\d")) && reasons[id].orEmpty().isNotBlank()
                else -> false
            }
        }, modifier = Modifier.fillMaxWidth()) { Text("SAVE SUPPLY POSITION") }
    }
}

@Composable
private fun DailyReportFields(
    date: String,
    feeders: List<JSONObject>,
    loading: Boolean,
    onSubmit: (String, JSONObject) -> Unit
) {
    var feederId by remember { mutableStateOf("") }
    var breaker by remember { mutableStateOf("ON") }
    var fault by remember { mutableStateOf("") }
    var duration by remember { mutableStateOf("") }
    var restoration by remember { mutableStateOf("") }
    var remarks by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var breakerMenu by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Daily Feeder Report", fontWeight = FontWeight.SemiBold)
        Box {
            OutlinedButton(onClick = { menu = true }, Modifier.fillMaxWidth()) {
                Text(feeders.firstOrNull { it.optString("id") == feederId }?.optString("name") ?: "Select Feeder")
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                feeders.forEach { f -> DropdownMenuItem(text = { Text(f.optString("name")) }, onClick = { feederId=f.optString("id"); menu=false }) }
            }
        }
        Box {
            OutlinedButton(onClick = { breakerMenu = true }, Modifier.fillMaxWidth()) { Text("Breaker Status: $breaker") }
            DropdownMenu(expanded = breakerMenu, onDismissRequest = { breakerMenu = false }) {
                listOf("ON", "OFF", "TRIPPED", "UNDER MAINTENANCE").forEach { v ->
                    DropdownMenuItem(text = { Text(v) }, onClick = { breaker=v; breakerMenu=false })
                }
            }
        }
        OutlinedTextField(fault, { fault=it }, Modifier.fillMaxWidth(), label = { Text("Fault Details") }, minLines = 2)
        OutlinedTextField(duration, { duration=it }, Modifier.fillMaxWidth(), label = { Text("Duration") }, singleLine = true)
        OutlinedTextField(restoration, { restoration=it }, Modifier.fillMaxWidth(), label = { Text("Restoration Time (HH:MM, optional)") }, singleLine = true)
        OutlinedTextField(remarks, { remarks=it }, Modifier.fillMaxWidth(), label = { Text("Remarks") }, minLines = 2)
        Button(onClick = {
            val payload=JSONObject().put("reportDate",date).put("feederId",feederId).put("breakerStatus",breaker)
                .put("eventType","Normal").put("faultDetails",fault).put("duration",duration)
                .put("restorationTime",restoration).put("remarks",remarks)
            onSubmit("createDailyReport",payload)
        }, enabled = !loading && date.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) && feederId.isNotBlank() &&
            (restoration.isBlank() || restoration.matches(Regex("([01]\\d|2[0-3]):[0-5]\\d"))),
            modifier = Modifier.fillMaxWidth()) { Text("SAVE DAILY REPORT") }
    }
}

@Composable
private fun AdminManagementForms(
    data: DashboardData,
    loading: Boolean,
    onAction: (JSONObject) -> Unit
) {
    var houseName by remember { mutableStateOf("") }
    var feederName by remember { mutableStateOf("") }
    var staffId by remember { mutableStateOf("") }
    var staffPin by remember { mutableStateOf("") }
    var houseId by remember { mutableStateOf("") }
    var feederHouseId by remember { mutableStateOf("") }
    var staffHouseId by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Admin Management", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            OutlinedTextField(houseName, { houseName = it }, Modifier.fillMaxWidth(), label = { Text("New Power House Name") }, singleLine = true)
            Button(onClick = { onAction(JSONObject().put("action", "createHouse").put("houseName", houseName.trim())); houseName = "" },
                enabled = !loading && houseName.trim().length >= 2, modifier = Modifier.fillMaxWidth()) { Text("ADD POWER HOUSE") }
            Text("Add Feeder", fontWeight = FontWeight.SemiBold)
            Box {
                OutlinedButton(onClick = { expanded = "feederHouse" }, Modifier.fillMaxWidth()) {
                    Text(data.houses.firstOrNull { it.optString("id") == feederHouseId }?.optString("name") ?: "Select Power House for Feeder")
                }
                DropdownMenu(expanded = expanded == "feederHouse", onDismissRequest = { expanded = "" }) {
                    data.houses.filter { it.optBoolean("active", true) }.forEach { h ->
                        DropdownMenuItem(text = { Text(h.optString("name")) }, onClick = { feederHouseId = h.optString("id"); expanded = "" })
                    }
                }
            }
            OutlinedTextField(feederName, { feederName = it }, Modifier.fillMaxWidth(), label = { Text("Feeder Name") }, singleLine = true)
            Button(onClick = { onAction(JSONObject().put("action", "createFeeder").put("houseId", feederHouseId).put("feederName", feederName.trim())); feederName = "" },
                enabled = !loading && feederHouseId.isNotBlank() && feederName.trim().length >= 2, modifier = Modifier.fillMaxWidth()) { Text("ADD FEEDER") }
            HorizontalDivider()
            Text("Power House Status", fontWeight = FontWeight.SemiBold)
            data.houses.forEach { house ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(house.optString("name"), fontWeight = FontWeight.Medium)
                        Text(if (house.optBoolean("active", true)) "Active" else "Inactive", fontSize = 12.sp)
                    }
                    Button(onClick = { onAction(JSONObject().put("action", "setHouseActive").put("houseId", house.optString("id")).put("active", !house.optBoolean("active", true))) },
                        enabled = !loading,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) {
                        Text(if (house.optBoolean("active", true)) "DEACTIVATE" else "RESTORE")
                    }
                }
            }
            Text("Feeder Status", fontWeight = FontWeight.SemiBold)
            data.feeders.forEach { feeder ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(feeder.optString("name"), fontWeight = FontWeight.Medium)
                        Text(feeder.optString("houseName"), fontSize = 12.sp)
                    }
                    Button(onClick = { onAction(JSONObject().put("action", "setFeederActive").put("feederId", feeder.optString("id")).put("active", !feeder.optBoolean("active", true))) },
                        enabled = !loading,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) {
                        Text(if (feeder.optBoolean("active", true)) "DEACTIVATE" else "RESTORE")
                    }
                }
            }
            HorizontalDivider()
            Text("Create Staff Login", fontWeight = FontWeight.SemiBold)
            Box {
                OutlinedButton(onClick = { expanded = "staffHouse" }, Modifier.fillMaxWidth()) {
                    Text(data.houses.firstOrNull { it.optString("id") == staffHouseId }?.optString("name") ?: "Select Staff Power House")
                }
                DropdownMenu(expanded = expanded == "staffHouse", onDismissRequest = { expanded = "" }) {
                    data.houses.filter { it.optBoolean("active", true) }.forEach { h ->
                        DropdownMenuItem(text = { Text(h.optString("name")) }, onClick = { staffHouseId = h.optString("id"); expanded = "" })
                    }
                }
            }
            OutlinedTextField(staffId, { staffId = it }, Modifier.fillMaxWidth(), label = { Text("Staff User ID") }, singleLine = true)
            OutlinedTextField(staffPin, { if (it.length <= 4 && it.all(Char::isDigit)) staffPin = it },
                Modifier.fillMaxWidth(), label = { Text("4-digit Staff PIN") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
            Button(onClick = { onAction(JSONObject().put("action", "createStaff").put("houseId", staffHouseId).put("userId", staffId.trim()).put("pin", staffPin)); staffId = ""; staffPin = "" },
                enabled = !loading && staffHouseId.isNotBlank() && staffId.matches(Regex("[A-Za-z0-9_-]{3,40}")) && staffPin.matches(Regex("[0-9]{4}")),
                modifier = Modifier.fillMaxWidth()) { Text("CREATE STAFF ACCOUNT") }
        }
    }
}

@Composable
private fun MetricCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(value, fontSize = 25.sp, fontWeight = FontWeight.Bold)
            Text(label, fontSize = 12.sp)
        }
    }
}

@Composable
private fun InfoCard(title: String, value: String, detail: String) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(value)
            if (detail.isNotBlank()) Text(detail, fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun EmptyLine(message: String) {
    Text(message, Modifier.padding(start = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun OutageRow(record: JSONObject, type: String, onResolve: (String) -> Unit) {
    var endTime by remember(record.optString("id")) { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(record.optString("feederName", "Feeder"), fontWeight = FontWeight.SemiBold)
            Text("${record.optString("houseName")} • ${record.optString("date")} • ${record.optString("startTime")}")
            Text("${type} • ${record.optString("reason")}")
            OutlinedTextField(endTime, { endTime = it }, Modifier.fillMaxWidth(),
                label = { Text("Restoration / End Time (HH:MM)") }, singleLine = true)
            Button(onClick = { onResolve(endTime) },
                enabled = endTime.matches(Regex("([01]\\d|2[0-3]):[0-5]\\d")),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.fillMaxWidth()) { Text("RESOLVE ${type.uppercase()}") }
        }
    }
}

private suspend fun loadAllRecords(collection: String): List<JSONObject> {
    require(collection in setOf("breakdowns", "shutdowns", "consumption_readings"))
    val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again.")
    val token = user.getIdToken(false).await().token ?: error("Could not refresh secure session.")
    val output = linkedMapOf<String, JSONObject>()
    var cursor: String? = null
    var pages = 0
    do {
        val cursors = JSONObject()
        if (cursor != null) cursors.put(collection, cursor)
        val response = postJson(RECORDS_API, JSONObject().put("action", "getRecords").put("cursors", cursors), token)
        jsonArray(response.optJSONArray(collection)).forEach { row ->
            val id = row.optString("id")
            if (id.isNotBlank()) output[id] = row
        }
        val next = response.optJSONObject("nextCursors")?.optString(collection).orEmpty()
        cursor = next.takeIf { it.isNotBlank() && it != "null" }
        pages++
        check(pages < 1000) { "Export page limit reached. Narrow the export period and retry." }
    } while (cursor != null)
    return output.values.toList()
}

private suspend fun loadFullBackup(): String {
    val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again.")
    val token = user.getIdToken(false).await().token ?: error("Could not refresh secure session.")
    val names = listOf(
        "powerhouses", "feeders", "users", "staff_house_assignments",
        "breakdowns", "shutdowns",
        "trippings", "consumption_readings", "supply_positions", "daily_reports",
        "feeder_status", "notifications", "entry_history"
    )
    val collections = JSONObject()
    for (name in names) {
        val rows = JSONArray()
        var cursor: String? = null
        var pages = 0
        do {
            val request = JSONObject().put("action", "exportBackupPage").put("collection", name)
            if (cursor != null) request.put("cursor", cursor)
            val response = postJson(RECORDS_API, request, token)
            jsonArray(response.optJSONArray("rows")).forEach { rows.put(it) }
            val next = response.optString("nextCursor")
            cursor = next.takeIf { it.isNotBlank() && it != "null" }
            pages++
            check(pages < 1000) { "Backup page limit reached for $name." }
        } while (cursor != null)
        collections.put(name, rows)
    }
    return JSONObject()
        .put("format", "BSK_FULL_BACKUP")
        .put("version", 1)
        .put("exportedAtEpochMs", System.currentTimeMillis())
        .put("collections", collections)
        .toString(2)
}

private fun csvDocument(headers: List<String>, rows: List<List<String>>): String {
    fun cell(value: String): String {
        val trimmed = value.trimStart()
        val safe = if (trimmed.startsWith("=") || trimmed.startsWith("+") ||
            trimmed.startsWith("-") || trimmed.startsWith("@") ||
            trimmed.startsWith("\t") || trimmed.startsWith("\r")) "'$value" else value
        return "\"" + safe.replace("\"", "\"\"") + "\""
    }
    return (listOf(headers) + rows).joinToString("\r\n") { row -> row.joinToString(",") { cell(it) } }
}

private suspend fun authenticate(userId: String, pin: String): BSKProfile {
    require(userId.matches(Regex("[A-Za-z0-9_-]{3,40}"))) { "Enter a valid User ID." }
    require(pin.matches(Regex("[0-9]{4}"))) { "Enter your 4-digit PIN." }
    val response = postJson(LOGIN_API, JSONObject().put("userId", userId).put("pin", pin))
    val token = response.optString("token")
    check(token.isNotBlank()) { "Login service returned an invalid response." }
    FirebaseAuth.getInstance().signInWithCustomToken(token).await()
    val p = response.getJSONObject("profile")
    val role = p.optString("role")
    check(role == "admin" || role == "staff") { "Account role is not configured. Contact Admin." }
    return BSKProfile(p.optString("userId", userId), role, p.optString("houseId"), p.optString("houseName"))
}

private suspend fun loadDashboard(profile: BSKProfile): DashboardData {
    val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again.")
    val token = user.getIdToken(false).await().token ?: error("Could not refresh secure session.")
    val records = postJson(RECORDS_API, JSONObject().put("action", "getRecords"), token)
    val breakdowns = jsonArray(records.optJSONArray("breakdowns"))
    val shutdowns = jsonArray(records.optJSONArray("shutdowns"))
    val trippings = jsonArray(records.optJSONArray("trippings"))
    val consumption = jsonArray(records.optJSONArray("consumption_readings"))
    val supply = jsonArray(records.optJSONArray("supply_positions"))
    if (profile.role == "staff") {
        return DashboardData(
            feeders = jsonArray(records.optJSONArray("feeders")),
            breakdowns = breakdowns, shutdowns = shutdowns, trippings = trippings,
            consumption = consumption, supplyPositions = supply,
            history = jsonArray(records.optJSONArray("entry_history"))
        )
    }
    val admin = postJson(ADMIN_API, JSONObject().put("action", "getDashboardData"), token)
    return DashboardData(
        houses = jsonArray(admin.optJSONArray("houses")),
        feeders = jsonArray(admin.optJSONArray("feeders")),
        users = jsonArray(admin.optJSONArray("users")),
        reports = jsonArray(admin.optJSONArray("reports")),
        breakdowns = breakdowns, shutdowns = shutdowns, trippings = trippings,
        consumption = consumption, supplyPositions = supply,
        history = jsonArray(records.optJSONArray("entry_history")),
        notifications = jsonArray(records.optJSONArray("notifications"))
    )
}

private fun jsonArray(array: JSONArray?): List<JSONObject> =
    (0 until (array?.length() ?: 0)).mapNotNull { array?.optJSONObject(it) }

private suspend fun postJson(endpoint: String, payload: JSONObject, idToken: String? = null): JSONObject =
    withContext(Dispatchers.IO) {
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 20000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            if (!idToken.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $idToken")
        }
        try {
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = JSONObject(body.ifBlank { "{}" })
            if (status !in 200..299) throw IllegalStateException(
                json.optString("error", "Request failed (HTTP $status).")
            )
            json
        } finally { connection.disconnect() }
    }
