
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getAuth,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAaatwBprTOw0DgxS5c7C4isUc-u0cdvFM",
  authDomain: "testing-app-8af35.firebaseapp.com",
  projectId: "testing-app-8af35",
  storageBucket: "testing-app-8af35.firebasestorage.app",
  messagingSenderId: "871710608561",
  appId: "1:871710608561:web:cce414a9d8c933ac4ee690",
  measurementId: "G-19VDNM6L2S"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

let currentProfile = null;
let dashboardData = {
  houses: [],
  feeders: [],
  users: [],
  reports: [],
};

function message(id, text, error = false) {
  if ($(id)) {
    $(id).textContent = text;
    $(id).style.color = error ? "#dc2626" : "#15803d";
  }
}

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function setToday() {
  if ($("reportDate")) {
    $("reportDate").value =
      new Date().toLocaleDateString("en-CA");
  }
}

async function adminRequest(action, data = {}) {
  if (!auth.currentUser) throw new Error("Please login again.");

  const token = await auth.currentUser.getIdToken();

  const response = await fetch("/.netlify/functions/admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ action, ...data })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Admin request failed");
  }

  return result;
}

// Login
$("loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  message("loginMessage", "Signing in...");

  const userId = $("userId").value.trim();
  const pin = $("pin").value.trim();

  try {
    const response = await fetch("/.netlify/functions/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, pin })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Login failed");
    }

    await signInWithCustomToken(auth, result.token);
    currentProfile = result.profile;
    localStorage.setItem("bsk-profile", JSON.stringify(currentProfile));

    $("loginCard").classList.add("hidden");
    $("appPanel").classList.remove("hidden");

    $("welcome").textContent =
      `${currentProfile.userId} · ${currentProfile.role}` +
      (currentProfile.houseName
        ? ` · ${currentProfile.houseName}`
        : "");

    $("staffPanel").classList.toggle(
      "hidden", currentProfile.role !== "staff"
    );

    $("adminPanel").classList.toggle(
      "hidden", currentProfile.role !== "admin"
    );

    message("loginMessage", "");

    if (currentProfile.role === "staff") {
      await loadStaffFeeders();
      fillOperationalFeederLists();
    }

    await loadOperationalRecords();
    setOperationalDates();
    await syncOutbox();
    renderOfflineQueueStatus();

    if (currentProfile.role === "admin") {
      await refreshDashboard();
    }

  } catch (error) {
    message("loginMessage", error.message, true);
  }
});

// Logout
$("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
  currentProfile = null;
  localStorage.removeItem("bsk-profile");

  $("appPanel").classList.add("hidden");
  $("loginCard").classList.remove("hidden");

  $("pin").value = "";
});

// Staff: Load assigned Power House feeders
async function loadStaffFeeders() {
  const feederField = $("feederName");
  if (!feederField || !currentProfile?.houseId) return;
  let feeders = [];
  try {
    const feederQuery = query(
      collection(db, "feeders"),
      where("houseId", "==", currentProfile.houseId),
      where("active", "==", true)
    );
    const snapshot = await getDocs(feederQuery);
    feeders = snapshot.docs.map(doc => ({ id:doc.id, ...doc.data() }));
    localStorage.setItem("bsk-feeders-"+currentProfile.houseId, JSON.stringify(feeders));
  } catch (error) {
    try {
      feeders = JSON.parse(localStorage.getItem("bsk-feeders-"+currentProfile.houseId) || "[]");
      message("reportMessage", "Offline mode: cached feeder list loaded.");
    } catch { feeders = []; }
  }
  operational.feeders = feeders;
  const select = document.createElement("select");
  select.id = "feederName";
  select.name = "feederName";
  select.required = true;
  select.className = feederField.className;
  select.innerHTML = '<option value="">Select Feeder</option>';
  feeders.forEach(feeder => {
    const option = document.createElement("option");
    option.value = feeder.id;
    option.textContent = feeder.name;
    option.dataset.name = feeder.name;
    select.appendChild(option);
  });
  feederField.replaceWith(select);
  if (!feeders.length) message("reportMessage", "No active feeder found. Contact Admin.", true);
}

// Staff: Submit daily report
$("reportForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!auth.currentUser || currentProfile?.role !== "staff") {
    return;
  }

  message("reportMessage", "Submitting report...");

  try {
    const feederSelect = $("feederName");
    const selectedOption =
      feederSelect.options[feederSelect.selectedIndex];

    if (!selectedOption || !selectedOption.value) {
      throw new Error("Please select a Feeder.");
    }

    const saved = await recordsRequest("createDailyReport", {
      feederId: selectedOption.value,
      reportDate: $("reportDate").value,
      breakerStatus: $("breakerStatus").value,
      eventType: $("eventType").value,
      faultDetails: $("faultDetails").value.trim(),
      duration: $("duration").value.trim(),
      restorationTime: $("restorationTime").value,
      remarks: $("remarks").value.trim()
    });

    $("reportForm").reset();
    setToday();

    message("reportMessage", saved.queued ? "Report saved offline. It will sync when internet returns." : "Report submitted successfully.");

  } catch (error) {
    message("reportMessage", error.message, true);
  }
});

// Admin: Refresh dashboard
async function refreshDashboard() {
  message("houseMessage", "Loading dashboard...");

  try {
    dashboardData = await adminRequest("getDashboardData");

    renderDashboard();
    await loadOperationalRecords();
    message("houseMessage", "Dashboard updated.");

  } catch (error) {
    message("houseMessage", error.message, true);
  }
}

$("refreshDashboard")?.addEventListener("click", refreshDashboard);

// Admin: Render dashboard
function renderDashboard() {
  const {
    houses, feeders, users, reports
  } = dashboardData;

  if ($("houseList")) {
    $("houseList").innerHTML = houses.length
      ? houses.map(h => `<p>${safe(h.name)} — ${h.active ? "Active" : "Inactive"}</p>`).join("")
      : "<p>No Power Houses added.</p>";
  }

  if ($("feederList")) {
    $("feederList").innerHTML = feeders.length
      ? feeders.map(f => `<p>${safe(f.name)} — ${safe(f.houseName || "")}</p>`).join("")
      : "<p>No Feeders added.</p>";
  }

  if ($("staffList")) {
    const staff = users.filter(u => u.role === "staff");

    $("staffList").innerHTML = staff.length
      ? staff.map(u =>
          `<p>${safe(u.userId)} — ${safe(u.houseName)} — ${u.active ? "Active" : "Inactive"}</p>`
        ).join("")
      : "<p>No Staff accounts added.</p>";
  }

  fillHouseDropdowns();
  renderReports();
}

// Admin: Fill Power House dropdowns
function fillHouseDropdowns() {
  const dropdownIds = [
    "feederHouse",
    "staffHouse",
    "filterHouse"
  ];

  dropdownIds.forEach(id => {
    const select = $(id);
    if (!select) return;

    const oldValue = select.value;
    const includeAll = id === "filterHouse";

    select.innerHTML = includeAll
      ? '<option value="">All Power Houses</option>'
      : '<option value="">Select Power House</option>';

    dashboardData.houses.forEach(house => {
      if (house.active !== true) return;

      const option = document.createElement("option");
      option.value = house.id;
      option.textContent = house.name;
      select.appendChild(option);
    });

    if ([...select.options].some(o => o.value === oldValue)) {
      select.value = oldValue;
    }
  });
}

// Admin: Create Power House
$("houseForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  try {
    message("houseMessage", "Creating Power House...");

    await adminRequest("createHouse", {
      houseName: $("houseName").value.trim()
    });

    $("houseForm").reset();
    await refreshDashboard();

    message("houseMessage", "Power House created successfully.");

  } catch (error) {
    message("houseMessage", error.message, true);
  }
});

// Admin: Create Feeder
$("feederForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  try {
    message("feederMessage", "Creating Feeder...");

    await adminRequest("createFeeder", {
      houseId: $("feederHouse").value,
      feederName: $("newFeederName").value.trim()
    });

    $("feederForm").reset();
    await refreshDashboard();

    message("feederMessage", "Feeder created successfully.");

  } catch (error) {
    message("feederMessage", error.message, true);
  }
});

// Admin: Create Staff
$("staffForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  try {
    message("staffMessage", "Creating Staff account...");

    await adminRequest("createStaff", {
      userId: $("newStaffId").value.trim(),
      pin: $("newStaffPin").value.trim(),
      houseId: $("staffHouse").value
    });

    $("staffForm").reset();
    await refreshDashboard();

    message("staffMessage", "Staff account created successfully.");

  } catch (error) {
    message("staffMessage", error.message, true);
  }
});

// Admin: Reports filter
$("applyReportFilter")?.addEventListener("click", renderReports);

$("clearReportFilter")?.addEventListener("click", () => {
  ["filterHouse","filterDate","recordsFrom","recordsTo","recordsSearch"].forEach(id => { if ($(id)) $(id).value=""; });
  renderReports();
  renderRecordHistory();
});

function getFilteredReports() {
  let reports = [...dashboardData.reports];

  const houseId = $("filterHouse")?.value || "";
  const date = $("filterDate")?.value || "";
  const search = ($("recordsSearch")?.value || "").toLowerCase().trim();
  const from = $("recordsFrom")?.value || "";
  const to = $("recordsTo")?.value || "";

  if (houseId) {
    reports = reports.filter(r => r.houseId === houseId);
  }

  if (date) {
    reports = reports.filter(r => r.reportDate === date);
  }
  if (from) reports = reports.filter(r => r.reportDate >= from);
  if (to) reports = reports.filter(r => r.reportDate <= to);
  if (search) {
    reports = reports.filter(r => [r.feederName,r.createdByUserId,r.houseName].some(v=>String(v||"").toLowerCase().includes(search)));
  }

  return reports;
}

function renderReports() {
  const list = $("reportList");
  if (!list) return;

  const reports = getFilteredReports();

  list.innerHTML = reports.length
    ? reports.map(r => `
      <div class="report-item">
        <p><strong>${safe(r.reportDate)}</strong> — ${safe(r.houseName)}</p>
        <p>Feeder: ${safe(r.feederName)}</p>
        <p>Breaker: ${safe(r.breakerStatus)} | Event: ${safe(r.eventType)}</p>
        <p>Fault: ${safe(r.faultDetails)}</p>
        <p>Duration: ${safe(r.duration)} | Restoration: ${safe(r.restorationTime)}</p>
        <p>Remarks: ${safe(r.remarks)}</p>
        <p>Staff: ${safe(r.createdByUserId || "")}</p>
        <hr>
      </div>
    `).join("")
    : "<p>No reports found.</p>";
}

// Initial setup
setToday();


// ---------------- Operational records (direct save; no approval workflow) ----------------
let operational = { breakdowns: [], shutdowns: [], trippings: [], consumption_readings: [], daily_reports: [], notifications: [], entry_history: [] };
const recordCollections = ["breakdowns", "shutdowns", "trippings", "consumption_readings", "daily_reports"];

async function recordsRequest(action, data = {}) {
  if (!auth.currentUser) throw new Error("Please login again.");
  const token = await auth.currentUser.getIdToken();
  const response = await fetch("/.netlify/functions/records", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ action, ...data })
  });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || "Request failed"); error.status = response.status; throw error; }
  return result;
}

function setOperationalDates() {
  const today = new Date().toLocaleDateString("en-CA");
  ["breakdownDate","shutdownDate","trippingDate","consumptionDate"].forEach(id => {
    if ($(id) && !$(id).value) $(id).value = today;
  });
}

function fillOperationalFeederLists() {
  const source = $("feederName");
  if (!source) return;
  ["breakdownFeeder","shutdownFeeder"].forEach(id => {
    const target = $(id);
    if (!target) return;
    const selected = target.value;
    target.innerHTML = '<option value="">Select Feeder</option>';
    [...source.options].slice(1).forEach(opt => {
      const item = document.createElement("option");
      item.value = opt.value;
      item.textContent = opt.textContent;
      target.appendChild(item);
    });
    target.value = selected;
  });
}

function ongoingRecords() {
  return [
    ...operational.breakdowns.filter(x => x.status === "ongoing").map(x => ({...x, kind:"Breakdown"})),
    ...operational.shutdowns.filter(x => x.status === "ongoing").map(x => ({...x, kind:"Shutdown"}))
  ].sort((a,b) => String(a.date).localeCompare(String(b.date)));
}

async function loadOperationalRecords() {
  try {
    const result = await recordsRequest("getRecords");
    const assignedFeeders = operational.feeders || [];
    operational = Object.fromEntries(recordCollections.concat(["notifications","entry_history"]).map(k => [k, result[k] || []]));
    operational.feeders = assignedFeeders;
    localStorage.setItem(recordsCacheKey(), JSON.stringify(operational));
    renderOperational();
  } catch (error) {
    try {
      const cached = JSON.parse(localStorage.getItem(recordsCacheKey()) || "null");
      if (cached) { operational = cached; renderOperational(); }
    } catch {}
    if ($("adminMessage")) message("adminMessage", "Offline: showing last synced records.", true);
  }
}

function renderOperational() {
  const openBreakdowns = operational.breakdowns.filter(x => x.status === "ongoing");
  const openShutdowns = operational.shutdowns.filter(x => x.status === "ongoing");
  if ($("ongoingBreakdownCount")) $("ongoingBreakdownCount").textContent = openBreakdowns.length;
  if ($("ongoingShutdownCount")) $("ongoingShutdownCount").textContent = openShutdowns.length;
  const durationText = x => {
    const start = new Date(x.date+"T"+x.startTime+":00+05:30").getTime();
    let end = x.endTime ? new Date(x.date+"T"+x.endTime+":00+05:30").getTime() : Date.now();
    if (x.endTime && end < start) end += 24*60*60*1000;
    if (!Number.isFinite(start)) return "—";
    const mins = Math.max(0, Math.floor((end-start)/60000));
    return Math.floor(mins/60)+"h "+(mins%60)+"m";
  };
  const list = (items, label) => items.length ? items.map(x =>
    `<p><strong>${safe(x.feederName)}</strong> · ${safe(x.date)} ${safe(x.startTime)} · ${safe(x.reason)} · ${durationText(x)} <span class="muted">(${safe(label)})</span></p>`
  ).join("") : "<p class='muted'>None ongoing.</p>";
  if ($("adminBreakdownList")) $("adminBreakdownList").innerHTML = list(openBreakdowns, "Breakdown");
  if ($("adminShutdownList")) $("adminShutdownList").innerHTML = list(openShutdowns, "Shutdown");
  if ($("staffOngoingList")) $("staffOngoingList").innerHTML = list(openBreakdowns, "Breakdown") + list(openShutdowns, "Shutdown");
  const resolve = $("resolveRecord");
  if (resolve) {
    resolve.innerHTML = '<option value="">Select event</option>';
    ongoingRecords().forEach(x => {
      const opt = document.createElement("option");
      opt.value = x.id + "|" + x.kind;
      opt.textContent = x.kind + " · " + x.feederName + " · " + x.date + " " + x.startTime;
      resolve.appendChild(opt);
    });
  }
  renderRecordHistory();
}


function renderFeederStatusSearch() {
  const output=$("feederStatusResult");
  if (!output) return;
  const query=($("feederStatusSearch")?.value||"").trim().toLowerCase();
  if (!query) { output.innerHTML="<p class='muted'>Search a feeder to see its current status and history.</p>"; return; }
  const feeders=(currentProfile?.role==="admin"?(dashboardData.feeders||[]):(operational.feeders||[])).filter(f=>f.active!==false && String(f.name||"").toLowerCase().includes(query));
  if (!feeders.length) { output.textContent="No matching feeder found."; return; }
  output.innerHTML=feeders.map(f=>{
    const breakdowns=operational.breakdowns.filter(x=>x.feederId===f.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const shutdowns=operational.shutdowns.filter(x=>x.feederId===f.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const status=breakdowns.some(x=>x.status==="ongoing")?"Breakdown":shutdowns.some(x=>x.status==="ongoing")?"Shutdown":"Running";
    const dailySource=currentProfile?.role==="admin"?(dashboardData.reports||[]):(operational.daily_reports||[]);
    const daily=dailySource.filter(x=>x.feederId===f.id).map(x=>({...x,date:x.reportDate,kind:"Daily Report",reason:x.remarks||x.eventType}));
    const history=[...breakdowns.map(x=>({...x,kind:"Breakdown"})),...shutdowns.map(x=>({...x,kind:"Shutdown"})),...daily].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,15);
    return `<article class="report-item"><strong>${safe(f.name)} — ${status}</strong>${history.map(x=>`<p>${safe(x.kind)} · ${safe(x.date)} · ${safe(x.startTime)}–${safe(x.endTime||"Ongoing")} · ${safe(x.reason)}</p>`).join("") || "<p>No outage history.</p>"}</article>`;
  }).join("");
}
$("feederStatusSearch")?.addEventListener("input",renderFeederStatusSearch);

$("adminRecordsList")?.addEventListener("click", async event => {
  const button=event.target.closest("[data-edit-record]");
  if(!button||currentProfile?.role!=="admin")return;
  const collection=button.dataset.recordCollection,id=button.dataset.editRecord,item=operational[collection]?.find(x=>x.id===id);
  if(!item)return;
  const fields=["breakdowns","shutdowns"].includes(collection)?[["date","Date"],["startTime","Start time"],["reason","Reason"]]
    :collection==="daily_reports"?[["reportDate","Report date"],["breakerStatus","Breaker status"],["faultDetails","Fault details"],["duration","Duration"],["restorationTime","Restoration time"],["remarks","Remarks"]]
    :collection==="trippings"?[["date","Date"],["trippingCount","Tripping count"],["feederCount","Feeder count"]]
    :[["date","Date"],["apFeeder","AP Feeder"],["ruralDomestic","Rural Domestic"],["urban","Urban"],["industrial","Industrial"],["independent","Independent"]];
  const changes={};
  for(const [key,label] of fields){const value=window.prompt(label+" (blank = unchanged)",item[key]??"");if(value===null)return;if(value!=="")changes[key]=value;}
  if(!Object.keys(changes).length)return;
  try{await recordsRequest("updateRecord",{recordCollection:collection,id,changes});await loadOperationalRecords();message("adminMessage","Record updated. Edit history saved.");}
  catch(error){message("adminMessage",error.message,true);}
});

function renderRecordHistory() {
  const from = $("recordsFrom")?.value || "";
  const to = $("recordsTo")?.value || "";
  const search = ($("recordsSearch")?.value || "").toLowerCase().trim();
  const inside = x => (!from || x.date >= from) && (!to || x.date <= to) &&
    (!search || [x.feederName,x.createdByUserId,x.houseName].some(v => String(v || "").toLowerCase().includes(search)));
  const rows = [
    ...operational.breakdowns.filter(inside).map(x => ({...x, kind:"Breakdown", collection:"breakdowns"})),
    ...operational.shutdowns.filter(inside).map(x => ({...x, kind:"Shutdown", collection:"shutdowns"})),
    ...operational.trippings.filter(inside).map(x => ({...x, kind:"Tripping", collection:"trippings"})),
    ...operational.consumption_readings.filter(inside).map(x => ({...x, kind:"Consumption", collection:"consumption_readings"})),
    ...(operational.daily_reports || []).map(x => ({...x, date:x.reportDate, kind:"Daily Feeder Report", collection:"daily_reports", reason:x.remarks || x.eventType})).filter(inside)
  ].sort((a,b) => String(b.date).localeCompare(String(a.date)));
  const durationFor = x => {
    if (!x.startTime) return "";
    const start = new Date(x.date+"T"+x.startTime+":00+05:30").getTime();
    let end = x.endTime ? new Date(x.date+"T"+x.endTime+":00+05:30").getTime() : Date.now();
    if (x.endTime && end < start) end += 86400000;
    if (!Number.isFinite(start)) return "";
    const minutes = Math.max(0,Math.floor((end-start)/60000));
    return Math.floor(minutes/60)+"h "+(minutes%60)+"m";
  };
  if ($("adminRecordsList")) $("adminRecordsList").innerHTML = rows.length ? rows.map(x =>
    `<article class="report-item"><strong>${safe(x.kind)} · ${safe(x.date)}</strong><p>${safe(x.feederName || x.houseName || "")}</p><p>${safe(x.reason || (x.kind==="Tripping" ? "Trippings: "+x.trippingCount+" · Feeders: "+x.feederCount : x.kind==="Consumption" ? "Total: "+x.total : ""))}</p><p>Status: ${safe(x.status || "Saved")} ${durationFor(x) ? "· Duration: "+durationFor(x) : ""}</p><p>Staff: ${safe(x.createdByUserId || "")}</p>${currentProfile?.role==="admin" ? `<button type="button" class="secondary" data-edit-record="${safe(x.id)}" data-record-collection="${safe(x.collection || x.kind.toLowerCase())}">Edit Record</button>` : ""}</article>`
  ).join("") : "<p>No records in selected date range.</p>";
  if ($("recordsInsights")) {
    const outageRows = [...operational.breakdowns.map(x=>({...x,kind:"Breakdown"})),...operational.shutdowns.map(x=>({...x,kind:"Shutdown"}))].filter(inside);
    const byFeeder = {};
    operational.breakdowns.filter(inside).forEach(x => { const k=x.feederName||"Unknown"; byFeeder[k]=(byFeeder[k]||0)+1; });
    const repeats = Object.entries(byFeeder).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]);
    const daily = {};
    const monthly = {};
    const dailyReportRows = (dashboardData.reports||[]).filter(r=>(!from||r.reportDate>=from)&&(!to||r.reportDate<=to)&&(!search||[r.feederName,r.createdByUserId,r.houseName].some(v=>String(v||"").toLowerCase().includes(search)))).map(r=>({...r,date:r.reportDate}));
    const summaryRows = [...outageRows, ...operational.trippings.filter(inside), ...operational.consumption_readings.filter(inside), ...dailyReportRows];
    summaryRows.forEach(x=>{ daily[x.date]=(daily[x.date]||0)+1; const m=String(x.date||"").slice(0,7); monthly[m]=(monthly[m]||0)+1; });
    const staffCounts = {};
    operational.entry_history.forEach(x=>{ const who=x.actorUserId||"Unknown"; staffCounts[who]=(staffCounts[who]||0)+1; });
    $("recordsInsights").innerHTML =
      "<h3>Repeat Breakdown / Feeder-wise Report</h3>" +
      (repeats.length ? repeats.map(([name,n])=>`<p>${safe(name)} · ${n} outage events</p>`).join("") : "<p>No repeat outage found in selected dates.</p>") +
      "<h3>Daily Outage Summary</h3>" +
      (Object.keys(daily).length ? Object.entries(daily).sort((a,b)=>b[0].localeCompare(a[0])).map(([d,n])=>`<p>${safe(d)} · ${n} events</p>`).join("") : "<p>No daily records.</p>") +
      "<h3>Monthly Outage Summary</h3>" +
      (Object.keys(monthly).length ? Object.entries(monthly).sort((a,b)=>b[0].localeCompare(a[0])).map(([m,n])=>`<p>${safe(m)} · ${n} events</p>`).join("") : "<p>No monthly records.</p>") +
      "<h3>Staff-wise Entry History</h3>" +
      (Object.keys(staffCounts).length ? Object.entries(staffCounts).sort((a,b)=>b[1]-a[1]).map(([who,n])=>`<p>${safe(who)} · ${n} entries</p>`).join("") : "<p>No history loaded.</p>");
  }
  renderFeederStatusSearch();
  if ($("historyList")) {
    const timeOf = h => {
      const seconds = h.createdAt?.seconds ?? h.createdAt?._seconds;
      if (Number.isFinite(seconds)) return new Date(seconds*1000).toLocaleString("en-IN");
      if (typeof h.createdAt === "string") return new Date(h.createdAt).toLocaleString("en-IN");
      return "";
    };
    $("historyList").innerHTML = "<h3>Recent Edit History (who / when)</h3>" +
      operational.entry_history.filter(h=>!search || String(h.actorUserId||"").toLowerCase().includes(search)).slice(0,40).map(h => `<p>${safe(h.action)} · ${safe(h.recordCollection)} · Staff: ${safe(h.actorUserId)} · ${safe(timeOf(h))}</p>`).join("");
  }
  if ($("notificationList")) $("notificationList").innerHTML = "<h3>New Entry Notifications · Unread: "+operational.notifications.filter(n=>!n.read).length+"</h3>" +
    operational.notifications.slice(0,30).map(n => `<p>${safe(n.title)} · ${safe(n.message)} · ${n.read ? "Read" : "New"} ${n.read ? "" : `<button type="button" class="secondary" data-notification-id="${safe(n.id)}">Mark read</button>`}</p>`).join("");
}

async function submitOperational(formId, action, payload, messageId) {
  const form = $(formId);
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      message(messageId, "Saving...");
      const saved = await recordsRequest(action, payload());
      form.reset();
      setOperationalDates();
      updateConsumptionTotal();
      await loadOperationalRecords();
      message(messageId, saved.queued ? "Saved on this device. It will sync when internet returns." : "Entry saved successfully and visible on dashboard.");
    } catch (error) { message(messageId, error.message, true); }
  });
}

submitOperational("breakdownForm", "createBreakdown", () => ({
  date:$("breakdownDate").value, feederId:$("breakdownFeeder").value,
  startTime:$("breakdownStart").value, endTime:$("breakdownEnd").value,
  reason:$("breakdownReason").value.trim()
}), "breakdownMessage");

submitOperational("shutdownForm", "createShutdown", () => ({
  date:$("shutdownDate").value, feederId:$("shutdownFeeder").value,
  startTime:$("shutdownStart").value, endTime:$("shutdownEnd").value,
  reason:$("shutdownReason").value.trim()
}), "shutdownMessage");

$("resolveForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const [id, kind] = $("resolveRecord").value.split("|");
    if (!id || !kind) throw new Error("Select ongoing event.");
    await recordsRequest(kind === "Breakdown" ? "resolveBreakdown" : "resolveShutdown", { id, endTime:$("resolveEnd").value });
    $("resolveForm").reset();
    await loadOperationalRecords();
    message("resolveMessage", "Event resolved successfully.");
  } catch (error) { message("resolveMessage", error.message, true); }
});

submitOperational("trippingForm", "createTripping", () => ({
  date:$("trippingDate").value, trippingCount:$("trippingCount").value,
  feederCount:$("trippingFeederCount").value
}), "trippingMessage");

const consumptionInputs = ["apFeeder","ruralDomestic","urban","industrial","independent"];
function updateConsumptionTotal() {
  const total = consumptionInputs.reduce((sum,id) => sum + (Number($(id)?.value) || 0), 0);
  if ($("consumptionTotal")) $("consumptionTotal").textContent = total.toLocaleString("en-IN");
}
consumptionInputs.forEach(id => $(id)?.addEventListener("input", updateConsumptionTotal));
submitOperational("consumptionForm", "createConsumption", () => ({
  date:$("consumptionDate").value, apFeeder:$("apFeeder").value,
  ruralDomestic:$("ruralDomestic").value, urban:$("urban").value,
  industrial:$("industrial").value, independent:$("independent").value
}), "consumptionMessage");

$("refreshRecords")?.addEventListener("click", loadOperationalRecords);
["recordsFrom","recordsTo"].forEach(id => $(id)?.addEventListener("change", () => { renderRecordHistory(); renderReports(); }));

function downloadExcelXml(kind) {
  const from = $("recordsFrom")?.value || "", to = $("recordsTo")?.value || "";
  const search = ($("recordsSearch")?.value || "").toLowerCase().trim();
  const inRange = x => (!from || x.date >= from) && (!to || x.date <= to) && (!search || [x.feederName,x.createdByUserId,x.houseName].some(v=>String(v||"").toLowerCase().includes(search)));
  let rows = [], filename = "";
  const xml = v => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  if (kind === "breakdowns") {
    rows = [["Date","Power House","Feeder","Start Time","End Time","Status","Reason"], ...operational.breakdowns.filter(inRange).map(x=>[x.date,x.houseName,x.feederName,x.startTime,x.endTime,x.status,x.reason])]; filename="BSK_Breakdown_Report.xls";
  } else if (kind === "shutdowns") {
    rows = [["Date","Power House","Feeder","Start Time","End Time","Status","Reason"], ...operational.shutdowns.filter(inRange).map(x=>[x.date,x.houseName,x.feederName,x.startTime,x.endTime,x.status,x.reason])]; filename="BSK_Shutdown_Report.xls";
  } else {
    rows = [["Date","Power House","AP Feeder","Rural Domestic","Urban","Industrial","Independent","Total"], ...operational.consumption_readings.filter(inRange).map(x=>[x.date,x.houseName,x.apFeeder,x.ruralDomestic,x.urban,x.industrial,x.independent,x.total])]; filename="BSK_Consumption_Report.xls";
  }
  const table = rows.map(row => "<Row>"+row.map(v=>"<Cell><Data ss:Type=\""+(typeof v === "number" ? "Number" : "String")+"\">"+xml(v)+"</Data></Cell>").join("")+"</Row>").join("");
  const workbook = '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>'+table+'</Table></Worksheet></Workbook>';
  const blob = new Blob([workbook], {type:"application/vnd.ms-excel"});
  const url = URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
$("downloadBreakdowns")?.addEventListener("click",()=>downloadExcelXml("breakdowns"));
$("downloadShutdowns")?.addEventListener("click",()=>downloadExcelXml("shutdowns"));
$("downloadConsumption")?.addEventListener("click",()=>downloadExcelXml("consumption"));
$("downloadPdf")?.addEventListener("click",()=>{
  const content = ($("recordsInsights")?.innerHTML || "") + ($("recordsChart")?.innerHTML || "") + ($("adminRecordsList")?.innerHTML || "") + ($("reportList")?.innerHTML || "");
  const w=window.open("","_blank");
  if (!w) { alert("Please allow pop-ups to create PDF."); return; }
  w.document.write("<html><head><title>BSK Report</title><style>body{font:14px Arial;padding:24px}article{border-bottom:1px solid #ccc;padding:10px}</style></head><body><h1>BSK Power House Report</h1>"+content+"</body></html>");
  w.document.close(); w.focus(); w.print();
});

// Make selected feeders available to all operational forms after initial feeder load.
const feederObserver = new MutationObserver(fillOperationalFeederLists);
if ($("feederName")) feederObserver.observe($("feederName"), {childList:true, subtree:true});
fillOperationalFeederLists();
setOperationalDates();


// Offline outbox: locally queue operational entries and retry when connectivity returns.
// Server-side clientEntryId makes retries idempotent.
function recordsCacheKey() {
  if (currentProfile?.role === "admin") return "bsk-record-cache-admin";
  return "bsk-record-cache-house-" + (currentProfile?.houseId || "unknown");
}
function outboxKey() { return "bsk-operational-outbox-v1-" + (auth.currentUser?.uid || "signed-out"); }
function readOutbox() {
  try { return JSON.parse(localStorage.getItem(outboxKey()) || "[]"); }
  catch { return []; }
}
function writeOutbox(items) { localStorage.setItem(outboxKey(), JSON.stringify(items)); renderOfflineQueueStatus(); }
function renderOfflineQueueStatus() {
  const count=readOutbox().length;
  if ($("offlineQueueStatus")) $("offlineQueueStatus").textContent = count ? count+" offline entr"+(count===1?"y":"ies")+" waiting to sync." : "";
}
async function queueOffline(action, payload) {
  const item = { clientEntryId: (crypto.randomUUID ? crypto.randomUUID() : "bsk"+Date.now()+Math.random().toString(36).slice(2)), ownerUid:auth.currentUser?.uid, action, payload, queuedAt: new Date().toISOString() };
  const items = readOutbox(); items.push(item); writeOutbox(items);
  return item;
}
async function syncOutbox() {
  if (!navigator.onLine || !auth.currentUser) return;
  const items = readOutbox();
  if (!items.length) return;
  const remaining = [];
  for (const item of items) {
    if (!auth.currentUser || item.ownerUid !== auth.currentUser.uid) { remaining.push(item); continue; }
    try { await recordsRequest(item.action, {...item.payload, clientEntryId:item.clientEntryId}); }
    catch (error) { remaining.push(item); }
  }
  writeOutbox(remaining);
  if (remaining.length !== items.length) {
    await loadOperationalRecords();
    if ($("reportMessage")) message("reportMessage", remaining.length ? "Some offline entries are waiting to sync." : "Offline entries synced successfully.");
  }
}
window.addEventListener("online", syncOutbox);
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncOutbox(); });
const originalRecordsRequest = recordsRequest;
recordsRequest = async (action, data = {}) => {
  const canQueue = ["createDailyReport","createBreakdown","createShutdown","createTripping","createConsumption"].includes(action);
  if (!navigator.onLine && canQueue) {
    await queueOffline(action, data);
    return { success:true, queued:true };
  }
  try {
    return await originalRecordsRequest(action, data);
  } catch (error) {
    if (canQueue && !error.status) {
      await queueOffline(action, data);
      return { success:true, queued:true };
    }
    throw error;
  }
};

$("recordsSearch")?.addEventListener("input", () => { renderRecordHistory(); renderReports(); });

$("backupRecords")?.addEventListener("click", async () => {
  if (currentProfile?.role !== "admin") {
    message("adminMessage", "Admin only.", true);
    return;
  }
  const button = $("backupRecords");
  const label = button?.textContent || "Download Backup JSON";
  if (button) { button.disabled = true; button.textContent = "Preparing backup..."; }
  try {
    const collections = ["powerhouses","feeders","users","breakdowns","shutdowns","trippings","consumption_readings","daily_reports","notifications","entry_history"];
    const backup = { exportedAt: new Date().toISOString(), collections: {} };
    for (const collection of collections) {
      const rows = [];
      let cursor = null;
      do {
        const page = await recordsRequest("exportBackupPage", { collection, cursor });
        rows.push(...(Array.isArray(page.rows) ? page.rows : []));
        cursor = page.nextCursor || null;
      } while (cursor);
      backup.collections[collection] = rows;
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "BSK_Full_Backup_" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    message("adminMessage", "Complete backup downloaded.");
  } catch (error) {
    message("adminMessage", "Backup failed: " + error.message, true);
  } finally {
    if (button) { button.disabled = false; button.textContent = label; }
  }
});

function renderAlertsAndCharts() {
  const open = ongoingRecords();
  const long = open.filter(x => {
    const start = new Date(x.date+"T"+x.startTime+":00+05:30").getTime();
    return Number.isFinite(start) && Date.now()-start >= 24*60*60*1000;
  });
  if ($("longRunningAlerts")) $("longRunningAlerts").innerHTML = long.length
    ? "<h3>Long-running alert (24+ hours)</h3>"+long.map(x=>`<div class="alert-warning">${safe(x.kind)} · ${safe(x.feederName)} · ${safe(x.date)} ${safe(x.startTime)}</div>`).join("")
    : "<p class='muted'>No outage has crossed the 24-hour alert threshold.</p>";
  const counts = [
    {label:"Breakdown",value:operational.breakdowns.length},
    {label:"Shutdown",value:operational.shutdowns.length},
    {label:"Tripping",value:operational.trippings.length},
    {label:"Consumption",value:operational.consumption_readings.length}
  ];
  const max = Math.max(1,...counts.map(x=>x.value));
  const monthCounts = {};
  [...operational.breakdowns,...operational.shutdowns,...operational.trippings,...operational.consumption_readings].forEach(x=>{
    const month=String(x.date||"").slice(0,7);
    if(month) monthCounts[month]=(monthCounts[month]||0)+1;
  });
  const recentMonths=Object.entries(monthCounts).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,6).reverse();
  const monthMax=Math.max(1,...recentMonths.map(x=>x[1]));
  if ($("recordsChart")) $("recordsChart").innerHTML = "<h3>Records Overview</h3>"+counts.map(x=>
    `<div class="chart-row"><span>${x.label}</span><div class="chart-track"><div class="chart-fill" style="width:${Math.round(x.value/max*100)}%"></div></div><strong>${x.value}</strong></div>`
  ).join("")+"<h3>Monthly Activity</h3>"+recentMonths.map(([month,value])=>
    `<div class="chart-row"><span>${safe(month)}</span><div class="chart-track"><div class="chart-fill" style="width:${Math.round(value/monthMax*100)}%"></div></div><strong>${value}</strong></div>`
  ).join("");
}
const priorRenderOperational = renderOperational;
renderOperational = function() { priorRenderOperational(); renderAlertsAndCharts(); };
$("themeToggle")?.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const dark = document.body.classList.contains("dark");
  localStorage.setItem("bsk-theme", dark ? "dark" : "light");
  $("themeToggle").textContent = dark ? "Light Mode" : "Dark Mode";
});
if (localStorage.getItem("bsk-theme")==="dark") {
  document.body.classList.add("dark");
  if ($("themeToggle")) $("themeToggle").textContent="Light Mode";
}
let hindiMode = localStorage.getItem("bsk-language") === "hi";
const hindiWords = {
  "Power House Feeder Log":"पावर हाउस फीडर लॉग","Dashboard":"डैशबोर्ड","Logout":"लॉग आउट",
  "Dark Mode":"डार्क मोड","Light Mode":"लाइट मोड","Breakdown Entry":"ब्रेकडाउन एंट्री",
  "Shutdown Entry":"शटडाउन एंट्री","Tripping Entry":"ट्रिपिंग एंट्री",
  "Power House Consumption Readings":"पावर हाउस खपत रीडिंग",
  "Save Breakdown":"ब्रेकडाउन सेव करें","Save Shutdown":"शटडाउन सेव करें",
  "Save Tripping":"ट्रिपिंग सेव करें","Save Consumption":"खपत सेव करें",
  "Ongoing Breakdown":"चालू ब्रेकडाउन","Ongoing Shutdown":"चालू शटडाउन",
  "Breakdown Feeders":"ब्रेकडाउन फीडर","Shutdown Feeders":"शटडाउन फीडर",
  "Reports & Downloads":"रिपोर्ट और डाउनलोड","Refresh Records":"रिकॉर्ड रिफ्रेश करें",
  "Date":"दिनांक","Start Time":"शुरू समय","End Time (blank if ongoing)":"समाप्ति समय (चालू हो तो खाली छोड़ें)",
  "Reason":"कारण","Feeder":"फीडर","Select Feeder":"फीडर चुनें",
  "How many trippings occurred?":"कितनी ट्रिपिंग हुई?","On how many feeders?":"कितने फीडरों पर?",
  "AP Feeder":"एपी फीडर","Rural Domestic":"ग्रामीण घरेलू","Urban":"शहरी",
  "Industrial":"औद्योगिक","Independent":"स्वतंत्र","Total (automatic):":"कुल (अपने आप):",
  "Mark Resolved":"समाप्त दर्ज करें","Ongoing event":"चालू घटना चुनें",
  "Daily Feeder Report":"दैनिक फीडर रिपोर्ट","Report date":"रिपोर्ट दिनांक","Breaker status":"ब्रेकर स्थिति",
  "Event type":"घटना का प्रकार","Fault details":"खराबी का विवरण","Duration":"अवधि",
  "Restoration time":"बहाली का समय","Remarks":"टिप्पणी","Submit report":"रिपोर्ट जमा करें",
  "Add Power House":"पावर हाउस जोड़ें","Power House Name":"पावर हाउस का नाम",
  "Select Power House":"पावर हाउस चुनें","Add Feeder":"फीडर जोड़ें","Feeder Name":"फीडर का नाम",
  "Create Staff Account":"स्टाफ खाता बनाएं","Staff User ID":"स्टाफ यूजर आईडी",
  "4-digit PIN":"4 अंकों का पिन","Power House List":"पावर हाउस सूची",
  "Feeder List":"फीडर सूची","Staff List":"स्टाफ सूची","Daily Reports":"दैनिक रिपोर्ट",
  "Power House Filter":"पावर हाउस फ़िल्टर","Report Date Filter":"रिपोर्ट दिनांक फ़िल्टर",
  "Apply Filter":"फ़िल्टर लगाएं","Clear Filter":"फ़िल्टर हटाएं",
  "Live Outage Dashboard":"चालू ब्रेकडाउन / शटडाउन डैशबोर्ड",
  "From date":"शुरू दिनांक","To date":"अंतिम दिनांक",
  "Search feeder / staff":"फीडर / स्टाफ खोजें","Download Backup JSON":"बैकअप डाउनलोड करें (JSON)",
  "Breakdown Excel":"ब्रेकडाउन एक्सेल","Shutdown Excel":"शटडाउन एक्सेल",
  "Consumption Excel":"खपत एक्सेल","PDF Report":"पीडीएफ रिपोर्ट",
  "Refresh Dashboard":"डैशबोर्ड रिफ्रेश करें","Admin Dashboard":"एडमिन डैशबोर्ड",
  "Daily Feeder Reports Excel":"दैनिक फीडर रिपोर्ट एक्सेल","Feeder Status / History Search":"फीडर स्थिति / इतिहास खोजें",
  "Create Power House":"पावर हाउस बनाएं","Create Feeder":"फीडर बनाएं","Create Staff":"स्टाफ बनाएं",
  "Resolve Ongoing Event":"चालू घटना समाप्त करें","Ongoing Breakdown / Shutdown":"चालू ब्रेकडाउन / शटडाउन",
  "Long-running alert (24+ hours)":"लंबे समय से चालू अलर्ट (24+ घंटे)",
  "Records Overview":"रिकॉर्ड सारांश","Monthly Activity":"मासिक गतिविधि",
  "Power House Filter":"पावर हाउस फ़िल्टर","Report Date Filter":"रिपोर्ट दिनांक फ़िल्टर",
  "Submit report":"रिपोर्ट जमा करें","Save":"सेव करें","No matching feeder found.":"कोई मेल खाता फीडर नहीं मिला।",
  "New Entry Notifications · Unread:":"नई एंट्री सूचनाएँ · अपठित:","Recent Edit History (who / when)":"हाल का बदलाव इतिहास (किसने / कब)",
  "Repeat Breakdown / Feeder-wise Report":"दोहराए गए ब्रेकडाउन / फीडर-वार रिपोर्ट",
  "Daily Entry Summary":"दैनिक एंट्री सारांश","Monthly Entry Summary":"मासिक एंट्री सारांश",
  "Staff-wise Entry History":"स्टाफ-वार एंट्री इतिहास","No outage history.":"कोई आउटेज इतिहास नहीं।",
  "BSK Login":"बीएसके लॉगिन","User ID":"यूजर आईडी","Login":"लॉगिन",
  "Save offline. It will sync when internet returns.":"ऑफलाइन सेव हुआ। इंटरनेट आने पर अपने आप सिंक होगा."
};
function applyLanguage() {
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())) {
    if(!node.__bskEnglish) node.__bskEnglish=node.nodeValue;
    const original=node.__bskEnglish.trim();
    if(!original) continue;
    if(hindiMode && hindiWords[original]) node.nodeValue=node.__bskEnglish.replace(original,hindiWords[original]);
    else if(!hindiMode) node.nodeValue=node.__bskEnglish;
  }
  if ($("languageToggle")) { const label=hindiMode ? "English" : "हिन्दी"; if ($("languageToggle").textContent !== label) $("languageToggle").textContent=label; }
  document.documentElement.lang = hindiMode ? "hi" : "en";
}
$("languageToggle")?.addEventListener("click",()=>{hindiMode=!hindiMode;localStorage.setItem("bsk-language",hindiMode?"hi":"en");applyLanguage();});
const languageObserver = new MutationObserver(()=>{ if(hindiMode) applyLanguage(); });
languageObserver.observe(document.body,{childList:true,subtree:true});
if (hindiMode) applyLanguage();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => console.warn("BSK offline cache unavailable:", error));
  });
}

$("downloadDailyReports")?.addEventListener("click", () => {
  let reports = getFilteredReports();
  if (!reports.length) { alert("No daily reports available for this filter."); return; }
  const columns = ["Report Date","Power House","Feeder","Breaker Status","Event Type","Fault Details","Duration","Restoration Time","Remarks","Staff User ID"];
  const rows = [columns, ...reports.map(r=>[r.reportDate,r.houseName,r.feederName,r.breakerStatus,r.eventType,r.faultDetails,r.duration,r.restorationTime,r.remarks,r.createdByUserId])];
  const esc = v => String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const table = rows.map(row=>"<Row>"+row.map(v=>"<Cell><Data ss:Type=\"String\">"+esc(v)+"</Data></Cell>").join("")+"</Row>").join("");
  const xml = '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Daily Reports"><Table>'+table+'</Table></Worksheet></Workbook>';
  const blob=new Blob([xml],{type:"application/vnd.ms-excel"}), url=URL.createObjectURL(blob), link=document.createElement("a");
  link.href=url; link.download="BSK_Daily_Feeder_Reports.xls"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
});

onAuthStateChanged(auth, async user => {
  if (!user || currentProfile) return;
  try {
    const saved = JSON.parse(localStorage.getItem("bsk-profile") || "null");
    if (!saved || saved.uid !== user.uid || !["admin","staff"].includes(saved.role)) { localStorage.removeItem("bsk-profile"); return; }
    currentProfile = saved;
    $("loginCard")?.classList.add("hidden");
    $("appPanel")?.classList.remove("hidden");
    $("welcome").textContent = `${saved.userId} · ${saved.role}` + (saved.houseName ? ` · ${saved.houseName}` : "");
    $("staffPanel")?.classList.toggle("hidden", saved.role !== "staff");
    $("adminPanel")?.classList.toggle("hidden", saved.role !== "admin");
    if (saved.role === "staff") {
      await loadStaffFeeders();
      fillOperationalFeederLists();
    }
    await loadOperationalRecords();
    setOperationalDates();
    await syncOutbox();
    renderOfflineQueueStatus();
    if (saved.role === "admin") await refreshDashboard();
  } catch (error) {
    console.warn("BSK session restore failed:", error);
  }
});

window.setInterval(() => {
  if (!currentProfile || document.hidden || !navigator.onLine) return;
  syncOutbox();
  if (currentProfile.role === "admin") refreshDashboard();
  else loadOperationalRecords();
}, 60000);

$("notificationList")?.addEventListener("click", async event => {
  const button=event.target.closest("[data-notification-id]");
  if (!button) return;
  try {
    await recordsRequest("markNotificationRead",{id:button.dataset.notificationId});
    await loadOperationalRecords();
  } catch(error) { alert(error.message); }
});
