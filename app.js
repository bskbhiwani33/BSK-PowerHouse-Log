
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
  const target = $(id);
  if (target) {
    target.textContent = text;
    const textNode = target.firstChild;
    if (textNode) {
      textNode.__bskEnglish = text;
      if (typeof hindiMode !== "undefined" && hindiMode && typeof hindiWords !== "undefined") {
        if (hindiWords[text]) textNode.nodeValue = hindiWords[text];
        else if (typeof text === "string" && text.startsWith("Backup failed: ")) {
          textNode.nodeValue = "बैकअप असफल हुआ: " + text.slice("Backup failed: ".length);
        }
      }
    }
    target.style.color = error ? "#dc2626" : "#15803d";
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

// Escape Excel SpreadsheetML text and remove characters forbidden by XML 1.0.
function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    resetOperationalSessionState();
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
  resetOperationalSessionState();
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
    // Refresh operational records immediately so a newly saved Staff report
    // appears in history and the Admin dashboard without waiting for polling.
    await refreshOperationalRecordsPreservingHistory();

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
    await refreshOperationalRecordsPreservingHistory();
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
  renderFeederStatusSearch();
  renderAlertsAndCharts();
});

function getFilteredReports() {
  let reports = [...(operational?.daily_reports || dashboardData.reports || [])];

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
let operational = { breakdowns: [], shutdowns: [], trippings: [], consumption_readings: [], daily_reports: [], feeder_status: [], notifications: [], entry_history: [], feeders: [] };
function resetOperationalSessionState() {
  operational = { breakdowns: [], shutdowns: [], trippings: [], consumption_readings: [], daily_reports: [], feeder_status: [], notifications: [], entry_history: [], feeders: [] };
  recordPageCursors = null;
  recordPagesLoaded = 0;
  historyLoadInProgress = false;
}
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

let recordPageCursors = null;
let recordPagesLoaded = 0;
let historyLoadInProgress = false;

async function loadOperationalRecords(options = {}) {
  const append = options.append === true;
  try {
    const result = await recordsRequest("getRecords", {
      cursors: append ? (recordPageCursors || {}) : {}
    });
    const assignedFeeders = operational.feeders || [];
    const keys = recordCollections.concat(["feeder_status","notifications","entry_history"]);

    if (append) {
      for (const key of keys) {
        const existing = operational[key] || [];
        const incoming = result[key] || [];
        const byId = new Map(existing.map(item => [item.id, item]));
        incoming.forEach(item => byId.set(item.id, item));
        operational[key] = [...byId.values()];
      }
    } else {
      operational = Object.fromEntries(keys.map(k => [k, result[k] || []]));
      recordPagesLoaded = 0;
    }

    operational.feeders = assignedFeeders;
    recordPageCursors = result.nextCursors || {};
    recordPagesLoaded += 1;
    const hasMore = Object.values(recordPageCursors).some(Boolean);
    const loadMoreButton = $("loadMoreHistory");
    if (loadMoreButton) {
      loadMoreButton.disabled = !hasMore;
      loadMoreButton.textContent = hasMore
        ? "Load Older Records (page " + (recordPagesLoaded + 1) + ")"
        : "All Records Loaded";
    }
    const staffLoadMore = $("loadMoreStaffHistory");
    if (staffLoadMore) {
      staffLoadMore.disabled = !hasMore;
      staffLoadMore.textContent = hasMore ? "Load Older Records" : "All Records Loaded";
    }

    // Browser storage can fill up after many history pages. A cache-write
    // failure must not discard the fresh records already received from server.
    try {
      localStorage.setItem(recordsCacheKey(), JSON.stringify(operational));
    } catch (cacheError) {
      console.warn("BSK records cache could not be updated; keeping fresh server data in memory.", cacheError);
    }
    renderOperational();
    if (append && $("adminMessage")) {
      message("adminMessage", hasMore
        ? "Older records loaded. More history is available."
        : "All available records are loaded.");
    }
    return true;
  } catch (error) {
    try {
      const cached = JSON.parse(localStorage.getItem(recordsCacheKey()) || "null");
      if (cached) { operational = cached; renderOperational(); }
    } catch {}
    const button = $("loadMoreHistory");
    if (button) { button.disabled = false; button.textContent = "Retry Loading History"; }
    if ($("adminMessage")) message("adminMessage", "Could not load the next history page. Check connection and retry.", true);
    return false;
  }
}

async function refreshAllOperationalHistory() {
  if (historyLoadInProgress) return;
  historyLoadInProgress = true;
  try {
    if (!await loadOperationalRecords()) return;
    while (Object.values(recordPageCursors || {}).some(Boolean)) {
      const before = JSON.stringify(recordPageCursors || {});
      if (!await loadOperationalRecords({ append: true })) break;
      if (JSON.stringify(recordPageCursors || {}) === before) break;
    }
  } finally {
    historyLoadInProgress = false;
  }
}

async function refreshOperationalRecordsPreservingHistory() {
  // Use the same lock as manual paging so periodic refreshes, saves and
  // explicit Load Older actions cannot overwrite each other's cursors.
  if (historyLoadInProgress) return;
  historyLoadInProgress = true;
  try {
    // Refresh only the newest page, then retain older pages already in memory.
    // The next cursor belongs to the refreshed first page; Load Older can
    // continue from there and deduplicate any overlap by document ID.
    const previous = operational;
    const firstPageLoaded = await loadOperationalRecords();
    if (!firstPageLoaded) return;
    const keys = recordCollections.concat(["feeder_status", "notifications", "entry_history"]);
    for (const key of keys) {
      const byId = new Map((operational[key] || []).map(item => [item.id, item]));
      const freshOngoingIds = new Set(
        (operational[key] || []).filter(item => item.status === "ongoing").map(item => item.id)
      );
      (previous[key] || []).forEach(item => {
        // The API includes every currently ongoing outage on every page.
        // If a previously cached ongoing event is absent now, it was resolved;
        // do not keep showing it as active from an older cached page.
        if ((key === "breakdowns" || key === "shutdowns") &&
            item.status === "ongoing" && !freshOngoingIds.has(item.id)) return;
        if (!byId.has(item.id)) byId.set(item.id, item);
      });
      operational[key] = [...byId.values()];
    }
    operational.feeders = previous.feeders || operational.feeders || [];
    // Only the newest page was refreshed from the server. Older cached pages
    // remain visible but are not re-fetched on every 60-second dashboard poll.
    recordPagesLoaded = 1;
    try {
      localStorage.setItem(recordsCacheKey(), JSON.stringify(operational));
    } catch (cacheError) {
      console.warn("BSK history cache could not be refreshed; keeping merged records in memory.", cacheError);
    }
    renderOperational();
  } finally {
    historyLoadInProgress = false;
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
  renderReports();
}


function renderFeederStatusSearch() {
  const output=$("feederStatusResult");
  if (!output) return;
  const query=($("feederStatusSearch")?.value||"").trim().toLowerCase();
  const from=$("recordsFrom")?.value||"", to=$("recordsTo")?.value||"";
  if (!query) { output.innerHTML="<p class='muted'>Search a feeder to see its current status and history.</p>"; return; }
  const feeders=(currentProfile?.role==="admin"?(dashboardData.feeders||[]):(operational.feeders||[])).filter(f=>f.active!==false && String(f.name||"").toLowerCase().includes(query));
  if (!feeders.length) { output.textContent="No matching feeder found."; return; }
  output.innerHTML=feeders.map(f=>{
    const inRange=x=>(!from||x.date>=from)&&(!to||x.date<=to);
    const breakdowns=operational.breakdowns.filter(x=>x.feederId===f.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const shutdowns=operational.shutdowns.filter(x=>x.feederId===f.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    // The records API includes every ongoing outage, even beyond the current history page.
    // Derive live status from those records so stale feeder_status data cannot hide an outage.
    const hasOngoingBreakdown=breakdowns.some(x=>x.status==="ongoing");
    const hasOngoingShutdown=shutdowns.some(x=>x.status==="ongoing");
    const status=hasOngoingBreakdown?"Breakdown":hasOngoingShutdown?"Shutdown":"Running";
    const dailySource=operational.daily_reports||dashboardData.reports||[];
    const daily=dailySource.filter(x=>x.feederId===f.id).map(x=>({...x,date:x.reportDate,kind:"Daily Report",reason:x.remarks||x.eventType}));
    const history=[...breakdowns.map(x=>({...x,kind:"Breakdown"})),...shutdowns.map(x=>({...x,kind:"Shutdown"})),...daily]
      .filter(inRange).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
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
  try{
    await recordsRequest("updateRecord",{recordCollection:collection,id,changes});
    await refreshAllOperationalHistory();
    message("adminMessage","Record updated. Edit history saved.");
  } catch(error){message("adminMessage",error.message,true);}
});

function renderRecordHistory() {
  const from = $("recordsFrom")?.value || "";
  const to = $("recordsTo")?.value || "";
  const search = ($("recordsSearch")?.value || "").toLowerCase().trim();
  const inside = x => (!from || x.date >= from) && (!to || x.date <= to) &&
    (!search || [x.feederName,x.createdByUserId,x.houseName].some(v => String(v || "").toLowerCase().includes(search)));
  const auditDate = h => {
    const record = h.after || h.before || {};
    const storedDate = record.date || record.reportDate;
    if (storedDate) return String(storedDate);
    const seconds = h.createdAt?.seconds ?? h.createdAt?._seconds;
    return Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleDateString("en-CA") : "";
  };
  const auditMatches = h => {
    const record = h.after || h.before || {};
    const date = auditDate(h);
    return (!from || (date && date >= from)) && (!to || (date && date <= to)) &&
      (!search || [h.actorUserId,record.feederName,record.houseName].some(v => String(v || "").toLowerCase().includes(search)));
  };
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
    const breakdownCounts = new Map();
    operational.breakdowns.filter(inside).forEach(x => {
      const key = x.feederId || x.feederName || "unknown";
      const current = breakdownCounts.get(key) || { name:x.feederName || "Unknown feeder", count:0 };
      current.count += 1;
      breakdownCounts.set(key, current);
    });
    const repeats = [...breakdownCounts.values()].filter(x=>x.count>=2).sort((a,b)=>b.count-a.count);
    const feederSummary = new Map();
    [...operational.breakdowns.map(x=>({...x,kind:"Breakdown"})),...operational.shutdowns.map(x=>({...x,kind:"Shutdown"}))]
      .filter(inside).forEach(x=>{
        const key=x.feederId||x.feederName||"unknown";
        const current=feederSummary.get(key)||{name:x.feederName||"Unknown feeder",breakdowns:0,shutdowns:0};
        if(x.kind==="Breakdown") current.breakdowns+=1; else current.shutdowns+=1;
        feederSummary.set(key,current);
      });
    const feederRows=[...feederSummary.values()].sort((a,b)=>(b.breakdowns+b.shutdowns)-(a.breakdowns+a.shutdowns));
    const daily = {};
    const monthly = {};
    const dailyReportRows = (operational.daily_reports||[]).filter(r=>(!from||r.reportDate>=from)&&(!to||r.reportDate<=to)&&(!search||[r.feederName,r.createdByUserId,r.houseName].some(v=>String(v||"").toLowerCase().includes(search)))).map(r=>({...r,date:r.reportDate,kind:"Daily Report"}));
    const trippingRows = operational.trippings.filter(inside).map(x=>({...x,kind:"Tripping"}));
    const consumptionRows = operational.consumption_readings.filter(inside).map(x=>({...x,kind:"Consumption"}));
    const summaryRows = [...outageRows, ...trippingRows, ...consumptionRows, ...dailyReportRows];
    summaryRows.forEach(x=>{
      const month=String(x.date||"").slice(0,7);
      if(!x.date)return;
      for(const [bucket,key] of [[daily,x.date],[monthly,month]]) {
        if(!key)continue;
        if(!bucket[key])bucket[key]={total:0};
        bucket[key].total+=1;
        bucket[key][x.kind]=(bucket[key][x.kind]||0)+1;
      }
    });
    const staffCounts = {};
    // Count actual created entries (not later resolve/edit audit actions) and
    // apply the same date/search filters used by the report views.
    operational.entry_history.filter(h => h.action === "created" && auditMatches(h)).forEach(x=>{
      const who=x.actorUserId||"Unknown";
      staffCounts[who]=(staffCounts[who]||0)+1;
    });
    const historyCoverageNote = recordPagesLoaded > 0 && allHistoryPagesLoaded()
      ? "<p class=\"muted\">All available history is loaded. Summaries include all records matching the selected filters.</p>"
      : "<p class=\"muted\">These summaries may be incomplete. Select Load All History above to include older records.</p>";
    $("recordsInsights").innerHTML = historyCoverageNote +
      "<h3>Repeat Breakdown Report</h3>" +
      (repeats.length ? repeats.map(x=>`<p>${safe(x.name)} · ${x.count} breakdowns</p>`).join("") : "<p>No repeat breakdown found in selected dates.</p>") +
      "<h3>Feeder-wise Report</h3>" +
      (feederRows.length ? feederRows.map(x=>`<p>${safe(x.name)} · Breakdown: ${x.breakdowns} · Shutdown: ${x.shutdowns} · Total: ${x.breakdowns+x.shutdowns}</p>`).join("") : "<p>No feeder outage records in selected dates.</p>") +
      "<h3>Daily Entry Summary</h3>" +
      (Object.keys(daily).length ? Object.entries(daily).sort((a,b)=>b[0].localeCompare(a[0])).map(([d,n])=>`<p>${safe(d)} · Total: ${n.total} · Breakdown: ${n.Breakdown||0} · Shutdown: ${n.Shutdown||0} · Tripping: ${n.Tripping||0} · Consumption: ${n.Consumption||0} · Daily Reports: ${n["Daily Report"]||0}</p>`).join("") : "<p>No daily records.</p>") +
      "<h3>Monthly Entry Summary</h3>" +
      (Object.keys(monthly).length ? Object.entries(monthly).sort((a,b)=>b[0].localeCompare(a[0])).map(([m,n])=>`<p>${safe(m)} · Total: ${n.total} · Breakdown: ${n.Breakdown||0} · Shutdown: ${n.Shutdown||0} · Tripping: ${n.Tripping||0} · Consumption: ${n.Consumption||0} · Daily Reports: ${n["Daily Report"]||0}</p>`).join("") : "<p>No monthly records.</p>") +
      "<h3>Staff-wise Entry History</h3>" +
      (Object.keys(staffCounts).length ? Object.entries(staffCounts).sort((a,b)=>b[1]-a[1]).map(([who,n])=>`<p>${safe(who)} · ${n} entries</p>`).join("") : "<p>No history loaded.</p>");
  }
  renderFeederStatusSearch();
  if ($("staffEntryHistory")) {
    const ownHistory = operational.entry_history
      .filter(h => h.actorUserId === currentProfile?.userId && auditMatches(h));
    $("staffEntryHistory").innerHTML = "<h3>My Entry History</h3>" +
      (ownHistory.length ? ownHistory.map(h => {
        const seconds = h.createdAt?.seconds ?? h.createdAt?._seconds;
        const when = Number.isFinite(seconds) ? new Date(seconds*1000).toLocaleString("en-IN") : "";
        return `<p>${safe(h.action)} · ${safe(h.recordCollection)} · ${safe(when)}</p>`;
      }).join("") : "<p>No entries found in your history.</p>");
  }
  if ($("historyList")) {
    const timeOf = h => {
      const seconds = h.createdAt?.seconds ?? h.createdAt?._seconds;
      if (Number.isFinite(seconds)) return new Date(seconds*1000).toLocaleString("en-IN");
      if (typeof h.createdAt === "string") return new Date(h.createdAt).toLocaleString("en-IN");
      return "";
    };
    $("historyList").innerHTML = "<h3>Recent Edit History (who / when)</h3>" +
      operational.entry_history.filter(auditMatches).slice(0,40).map(h => `<p>${safe(h.action)} · ${safe(h.recordCollection)} · Staff: ${safe(h.actorUserId)} · ${safe(timeOf(h))}</p>`).join("");
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
      await refreshOperationalRecordsPreservingHistory();
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
    await refreshOperationalRecordsPreservingHistory();
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

$("refreshRecords")?.addEventListener("click", refreshOperationalRecordsPreservingHistory);
const refreshFilteredRecordViews = () => { renderRecordHistory(); renderReports(); renderFeederStatusSearch(); renderAlertsAndCharts(); };
["recordsFrom","recordsTo"].forEach(id => $(id)?.addEventListener("change", refreshFilteredRecordViews));
$("recordsSearch")?.addEventListener("input", refreshFilteredRecordViews);

function allHistoryPagesLoaded() {
  // A missing cursor before the first successful server page is not proof
  // that the cache contains the complete history.
  return recordPagesLoaded > 0 && !Object.values(recordPageCursors || {}).some(Boolean);
}
function requireCompleteHistoryForExport() {
  if (allHistoryPagesLoaded()) return true;
  message("adminMessage", "Refresh records and load all history before downloading a complete report.", true);
  return false;
}
function downloadExcelXml(kind) {
  if (!requireCompleteHistoryForExport()) return;
  const from = $("recordsFrom")?.value || "", to = $("recordsTo")?.value || "";
  const search = ($("recordsSearch")?.value || "").toLowerCase().trim();
  const inRange = x => (!from || x.date >= from) && (!to || x.date <= to) && (!search || [x.feederName,x.createdByUserId,x.houseName].some(v=>String(v||"").toLowerCase().includes(search)));
  let rows = [], filename = "";
  const xml = xmlEscape;
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
$("downloadAllRecords")?.addEventListener("click",()=>{
  if (!requireCompleteHistoryForExport()) return;
  const from=$("recordsFrom")?.value||"",to=$("recordsTo")?.value||"";
  const search=($("recordsSearch")?.value||"").toLowerCase().trim();
  const xml=xmlEscape;
  const inRange=(x,dateKey="date")=>(!from||String(x[dateKey]||"")>=from)&&(!to||String(x[dateKey]||"")<=to)&&(!search||[x.feederName,x.createdByUserId,x.houseName].some(v=>String(v||"").toLowerCase().includes(search)));
  const sheets=[
    {name:"Breakdown",headers:["Date","Power House","Feeder","Start","End","Status","Reason"],rows:operational.breakdowns.filter(x=>inRange(x)).map(x=>[x.date,x.houseName,x.feederName,x.startTime,x.endTime,x.status,x.reason])},
    {name:"Shutdown",headers:["Date","Power House","Feeder","Start","End","Status","Reason"],rows:operational.shutdowns.filter(x=>inRange(x)).map(x=>[x.date,x.houseName,x.feederName,x.startTime,x.endTime,x.status,x.reason])},
    {name:"Tripping",headers:["Date","Power House","Trippings","Feeders","Staff"],rows:operational.trippings.filter(x=>inRange(x)).map(x=>[x.date,x.houseName,x.trippingCount,x.feederCount,x.createdByUserId])},
    {name:"Consumption",headers:["Date","Power House","AP Feeder","Rural Domestic","Urban","Industrial","Independent","Total"],rows:operational.consumption_readings.filter(x=>inRange(x)).map(x=>[x.date,x.houseName,x.apFeeder,x.ruralDomestic,x.urban,x.industrial,x.independent,x.total])},
    {name:"Daily Reports",headers:["Date","Power House","Feeder","Breaker","Event","Fault","Duration","Restoration","Remarks","Staff"],rows:operational.daily_reports.filter(x=>inRange(x,"reportDate")).map(x=>[x.reportDate,x.houseName,x.feederName,x.breakerStatus,x.eventType,x.faultDetails,x.duration,x.restorationTime,x.remarks,x.createdByUserId])}
  ];
  const worksheets=sheets.map(sheet=>{
    const rows=[sheet.headers,...sheet.rows];
    const table=rows.map(row=>"<Row>"+row.map(value=>"<Cell><Data ss:Type=\""+(typeof value==="number"?"Number":"String")+"\">"+xml(value)+"</Data></Cell>").join("")+"</Row>").join("");
    return "<Worksheet ss:Name=\""+sheet.name+"\"><Table>"+table+"</Table></Worksheet>";
  }).join("");
  const workbook='<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'+worksheets+"</Workbook>";
  const url=URL.createObjectURL(new Blob([workbook],{type:"application/vnd.ms-excel"}));
  const link=document.createElement("a");link.href=url;link.download="BSK_All_Records_"+new Date().toISOString().slice(0,10)+".xls";link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
});
$("downloadPdf")?.addEventListener("click",()=>{
  if (!requireCompleteHistoryForExport()) return;
  const content = ($("recordsInsights")?.innerHTML || "") + ($("recordsChart")?.innerHTML || "") + ($("adminRecordsList")?.innerHTML || "") + ($("reportList")?.innerHTML || "");
  const w=window.open("","_blank");
  if (!w) { bskAlert("Please allow pop-ups to create PDF."); return; }
  w.document.write("<html><head><title>BSK Report</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font:14px Arial,sans-serif;padding:24px;color:#172536}h1,h2,h3{break-after:avoid}article,.report-item{border-bottom:1px solid #ccc;padding:10px 0;break-inside:avoid}button{display:none!important}@page{margin:16mm}@media print{body{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><h1>BSK Power House Report</h1>"+content+"</body></html>");
  w.document.close();
  setTimeout(() => { if (!w.closed) { w.focus(); w.print(); } }, 250);
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
  // Staff accounts in one Power House must not share cached audit history.
  return "bsk-record-cache-staff-" + (auth.currentUser?.uid || "unknown");
}
function outboxKey() { return "bsk-operational-outbox-v1-" + (auth.currentUser?.uid || "signed-out"); }
function readOutbox() {
  try { return JSON.parse(localStorage.getItem(outboxKey()) || "[]"); }
  catch { return []; }
}
function writeOutbox(items) { localStorage.setItem(outboxKey(), JSON.stringify(items)); renderOfflineQueueStatus(); }
function renderOfflineQueueStatus() {
  const count=readOutbox().length;
  if ($("offlineQueueStatus")) {
    $("offlineQueueStatus").textContent = !count ? "" :
      (typeof hindiMode !== "undefined" && hindiMode
        ? count + " ऑफलाइन एंट्री सिंक होने की प्रतीक्षा में हैं।"
        : count + " offline entr" + (count===1?"y":"ies") + " waiting to sync.");
  }
}
function newClientEntryId() {
  return crypto.randomUUID ? crypto.randomUUID() : "bsk"+Date.now()+Math.random().toString(36).slice(2);
}
async function queueOffline(action, payload) {
  const clientEntryId = payload.clientEntryId || newClientEntryId();
  const item = { clientEntryId, ownerUid:auth.currentUser?.uid, action, payload:{...payload, clientEntryId}, queuedAt: new Date().toISOString() };
  const items = readOutbox();
  if (!items.some(x => x.clientEntryId === clientEntryId)) items.push(item);
  try {
    writeOutbox(items);
  } catch {
    throw new Error("Offline storage is full. Connect to internet and sync pending entries before adding more.");
  }
  return item;
}
let outboxSyncInProgress = false;
async function syncOutbox() {
  if (outboxSyncInProgress || !navigator.onLine || !auth.currentUser) return;
  outboxSyncInProgress = true;
  try {
    const items = readOutbox();
    if (!items.length) return;
    const syncedIds = new Set();
    for (const item of items) {
      if (!auth.currentUser || item.ownerUid !== auth.currentUser.uid) continue;
      try {
        await recordsRequest(item.action, {...item.payload, clientEntryId:item.clientEntryId});
        syncedIds.add(item.clientEntryId);
      } catch (error) {
        // Keep failed entries in the local outbox for a later retry.
      }
    }
    // Merge against the latest queue so entries added during this sync are never overwritten.
    const latestItems = readOutbox();
    const remaining = latestItems.filter(item => !syncedIds.has(item.clientEntryId));
    writeOutbox(remaining);
    if (syncedIds.size) {
      await refreshOperationalRecordsPreservingHistory();
      if ($("reportMessage")) message("reportMessage", remaining.length ? "Some offline entries are waiting to sync." : "Offline entries synced successfully.");
    }
  } finally {
    outboxSyncInProgress = false;
  }
}
window.addEventListener("online", syncOutbox);
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !currentProfile || !navigator.onLine) return;
  await syncOutbox();
  if (!currentProfile) return;
  if (currentProfile.role === "admin") await refreshDashboard();
  else await refreshOperationalRecordsPreservingHistory();
});
const originalRecordsRequest = recordsRequest;
recordsRequest = async (action, data = {}) => {
  const canQueue = ["createDailyReport","createBreakdown","createShutdown","createTripping","createConsumption"].includes(action);
  if (!canQueue) return originalRecordsRequest(action, data);
  const hadClientEntryId = Boolean(data.clientEntryId);
  const payload = hadClientEntryId ? data : {...data, clientEntryId:newClientEntryId()};
  if (!navigator.onLine) {
    if (hadClientEntryId) throw new Error("Offline; queued entry will retry when connection returns.");
    await queueOffline(action, payload);
    return { success:true, queued:true };
  }
  try {
    return await originalRecordsRequest(action, payload);
  } catch (error) {
    if (!error.status) {
      if (hadClientEntryId) throw error;
      await queueOffline(action, payload);
      return { success:true, queued:true };
    }
    throw error;
  }
};

$("loadMoreStaffHistory")?.addEventListener("click", async () => {
  const button=$("loadMoreStaffHistory");
  if(!button||button.disabled||historyLoadInProgress)return;
  historyLoadInProgress=true;
  button.disabled=true;button.textContent="Loading older records...";
  try {
    const before=JSON.stringify(recordPageCursors||{});
    await loadOperationalRecords({append:true});
    const hasMore=Object.values(recordPageCursors||{}).some(Boolean);
    if(button){button.disabled=!hasMore;button.textContent=hasMore?"Load Older Records":"All Records Loaded";}
    if(JSON.stringify(recordPageCursors||{})===before && hasMore) message("reportMessage","Could not load older history. Check connection and retry.",true);
  } finally {
    historyLoadInProgress=false;
  }
});
$("loadMoreHistory")?.addEventListener("click", async () => {
  const button = $("loadMoreHistory");
  if (!button || button.disabled || historyLoadInProgress) return;
  historyLoadInProgress = true;
  button.disabled = true;
  button.textContent = "Loading all history...";
  try {
    let previousCursor = "";
    while (Object.values(recordPageCursors || {}).some(Boolean)) {
      const before = JSON.stringify(recordPageCursors || {});
      if (before === previousCursor) break;
      previousCursor = before;
      await loadOperationalRecords({ append: true });
      if (button) { button.disabled = true; button.textContent = "Loading all history..."; }
      const after = JSON.stringify(recordPageCursors || {});
      if (after === before) break;
    }
    const hasMore = Object.values(recordPageCursors || {}).some(Boolean);
    if (button) {
      button.disabled = !hasMore;
      button.textContent = hasMore ? "Retry Loading History" : "All Records Loaded";
    }
  } finally {
    historyLoadInProgress = false;
  }
});

$("backupRecords")?.addEventListener("click", async () => {
  if (currentProfile?.role !== "admin") {
    message("adminMessage", "Admin only.", true);
    return;
  }
  const button = $("backupRecords");
  const label = button?.textContent || "Download Backup JSON";
  if (button) { button.disabled = true; button.textContent = "Preparing backup..."; }
  try {
    const collections = ["powerhouses","feeders","users","breakdowns","shutdowns","trippings","consumption_readings","daily_reports","feeder_status","notifications","entry_history"];
    const backup = {
      format: "BSK_FULL_BACKUP",
      schemaVersion: 1,
      firebaseProjectId: firebaseConfig.projectId,
      exportedAt: new Date().toISOString(),
      exportedBy: currentProfile?.userId || "admin",
      collectionCounts: {},
      collections: {}
    };
    for (const collection of collections) {
      const rows = [];
      const seenCursors = new Set();
      let cursor = null;
      do {
        const page = await recordsRequest("exportBackupPage", { collection, cursor });
        if (!page?.success || !Array.isArray(page.rows)) {
          throw new Error("Backup page was incomplete. Please retry.");
        }
        rows.push(...page.rows);
        const next = page.nextCursor || null;
        if (next && seenCursors.has(next)) throw new Error("Backup pagination stopped unexpectedly. Please restart the backup.");
        if (next) seenCursors.add(next);
        cursor = next;
      } while (cursor);
      backup.collections[collection] = rows;
      backup.collectionCounts[collection] = rows.length;
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
  const longBreakdowns = long.filter(x=>x.kind==="Breakdown");
  const longShutdowns = long.filter(x=>x.kind==="Shutdown");
  const alertRows = items => items.length
    ? items.map(x=>`<div class="alert-warning">${safe(x.feederName)} · ${safe(x.date)} ${safe(x.startTime)}</div>`).join("")
    : "<p class='muted'>None crossed the 24-hour threshold.</p>";
  if ($("longRunningAlerts")) $("longRunningAlerts").innerHTML =
    "<h3>Ongoing Breakdown Alert (24+ hours)</h3>"+alertRows(longBreakdowns)+
    "<h3>Ongoing Shutdown Alert (24+ hours)</h3>"+alertRows(longShutdowns);
  const from=$("recordsFrom")?.value||"",to=$("recordsTo")?.value||"";
  const search=($("recordsSearch")?.value||"").toLowerCase().trim();
  const chartFilter=x=>(!from||String(x.date||"")>=from)&&(!to||String(x.date||"")<=to)&&
    (!search||[x.feederName,x.createdByUserId,x.houseName].some(v=>String(v||"").toLowerCase().includes(search)));
  const breakdownRows=operational.breakdowns.filter(chartFilter);
  const shutdownRows=operational.shutdowns.filter(chartFilter);
  const trippingRows=operational.trippings.filter(chartFilter);
  const consumptionRows=operational.consumption_readings.filter(chartFilter);
  const counts = [
    {label:"Breakdown",value:breakdownRows.length},
    {label:"Shutdown",value:shutdownRows.length},
    {label:"Tripping",value:trippingRows.length},
    {label:"Consumption",value:consumptionRows.length}
  ];
  const max = Math.max(1,...counts.map(x=>x.value));
  const monthCounts = {};
  [...breakdownRows,...shutdownRows,...trippingRows,...consumptionRows].forEach(x=>{
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
  "Sign in with your User ID and 4-digit PIN.":"अपनी यूजर आईडी और 4 अंकों के पिन से लॉगिन करें।",
  "First-time setup is performed by the project administrator.":"पहली बार की सेटिंग प्रोजेक्ट एडमिन द्वारा की जाती है।",
  "Select status":"स्थिति चुनें","Select event":"घटना चुनें","Normal":"सामान्य",
  "Use the separate Breakdown / Shutdown forms below for outage entries.":"ब्रेकडाउन / शटडाउन दर्ज करने के लिए नीचे दिए गए अलग फॉर्म का उपयोग करें।",
  "End Time":"समाप्ति समय","Power House Feeder Log Management":"पावर हाउस फीडर लॉग प्रबंधन",
  "No data loaded.":"अभी कोई डेटा लोड नहीं हुआ।","All Power Houses":"सभी पावर हाउस","No reports loaded.":"अभी कोई रिपोर्ट लोड नहीं हुई।",
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
  "Save offline. It will sync when internet returns.":"ऑफलाइन सेव हुआ। इंटरनेट आने पर अपने आप सिंक होगा.",
  "All Records Excel":"सभी रिकॉर्ड एक्सेल","Load All History":"पूरा इतिहास लोड करें",
  "Load Older Records":"पुराना इतिहास लोड करें","Loading older records...":"पुराना इतिहास लोड हो रहा है...",
  "Loading all history...":"पूरा इतिहास लोड हो रहा है...",
  "All Records Loaded":"सभी रिकॉर्ड लोड हो गए","Retry Loading History":"इतिहास फिर से लोड करें",
  "Ongoing Breakdown Alert (24+ hours)":"चालू ब्रेकडाउन अलर्ट (24+ घंटे)",
  "Ongoing Shutdown Alert (24+ hours)":"चालू शटडाउन अलर्ट (24+ घंटे)",
  "Repeat Breakdown Report":"दोहराए गए ब्रेकडाउन की रिपोर्ट","Feeder-wise Report":"फीडर-वार रिपोर्ट",
  "Daily Entry Summary":"दैनिक एंट्री सारांश","Monthly Entry Summary":"मासिक एंट्री सारांश",
  "My Entry History":"मेरी एंट्री का इतिहास","Search a feeder to see its current status and history.":"स्थिति और इतिहास देखने के लिए फीडर खोजें।",
  "None crossed the 24-hour threshold.":"कोई भी 24 घंटे की सीमा पार नहीं हुआ।",
  "Signing in...":"लॉगिन हो रहा है...","Loading dashboard...":"डैशबोर्ड लोड हो रहा है...",
  "Offline mode: cached feeder list loaded.":"ऑफलाइन मोड: सेव की हुई फीडर सूची लोड हुई।",
  "No active feeder found. Contact Admin.":"कोई सक्रिय फीडर नहीं मिला। एडमिन से संपर्क करें।",
  "Submitting report...":"रिपोर्ट जमा हो रही है...","Creating Power House...":"पावर हाउस बनाया जा रहा है...",
  "Creating Feeder...":"फीडर बनाया जा रहा है...","Creating Staff account...":"स्टाफ खाता बनाया जा रहा है...",
  "Saving...":"सेव हो रहा है...","Could not load older history. Check connection and retry.":"पुराना इतिहास लोड नहीं हुआ। इंटरनेट जाँचकर फिर कोशिश करें।",
  "Admin only.":"केवल एडमिन के लिए।","Backup failed:":"बैकअप असफल हुआ:",
  "Dashboard updated.":"डैशबोर्ड अपडेट हो गया।","Power House created successfully.":"पावर हाउस सफलतापूर्वक बन गया।",
  "Feeder created successfully.":"फीडर सफलतापूर्वक बन गया।","Staff account created successfully.":"स्टाफ खाता सफलतापूर्वक बन गया।",
  "Report submitted successfully.":"रिपोर्ट सफलतापूर्वक जमा हो गई।",
  "Entry saved successfully and visible on dashboard.":"एंट्री सेव हो गई और डैशबोर्ड पर दिख रही है।",
  "Event resolved successfully.":"घटना सफलतापूर्वक समाप्त हुई।",
  "Record updated. Edit history saved.":"रिकॉर्ड अपडेट हुआ। बदलाव का इतिहास सेव हो गया।",
  "Offline: showing last synced records.":"ऑफलाइन: आखिरी सिंक किए गए रिकॉर्ड दिखाए जा रहे हैं।",
  "Could not load the next history page. Check connection and retry.":"पुराना इतिहास लोड नहीं हुआ। इंटरनेट जाँचकर फिर कोशिश करें।",
  "Complete backup downloaded.":"पूरा बैकअप डाउनलोड हो गया।",
  "All available records are loaded.":"सभी उपलब्ध रिकॉर्ड लोड हो गए।",
  "Please click Load All History before downloading a complete report.":"पूरी रिपोर्ट डाउनलोड करने से पहले Load All History पर क्लिक करें।",
  "Offline storage is full. Connect to internet and sync pending entries before adding more.":"ऑफलाइन स्टोरेज भर गया है। नई एंट्री से पहले इंटरनेट से कनेक्ट करके लंबित एंट्री सिंक करें।",
  "Please login again.":"कृपया दोबारा लॉगिन करें।",
  "Admin request failed":"एडमिन अनुरोध असफल हुआ।",
  "Login failed":"लॉगिन असफल हुआ।",
  "Please select a Feeder.":"कृपया फीडर चुनें।",
  "Request failed":"अनुरोध असफल हुआ।",
  "Select ongoing event.":"कृपया चालू घटना चुनें।",
  "Refresh records and load all history before downloading a complete report.":"पूरी रिपोर्ट डाउनलोड करने से पहले रिकॉर्ड रिफ्रेश करके पूरा इतिहास लोड करें।",
  "Please allow pop-ups to create PDF.":"PDF बनाने के लिए पॉप-अप की अनुमति दें।",
  "Saved on this device. It will sync when internet returns.":"इस डिवाइस पर सेव हुआ। इंटरनेट आने पर सिंक होगा।",
  "Some offline entries are waiting to sync.":"कुछ ऑफलाइन एंट्री सिंक होने की प्रतीक्षा में हैं।",
  "Offline entries synced successfully.":"ऑफलाइन एंट्री सफलतापूर्वक सिंक हो गईं।",
  "Offline; queued entry will retry when connection returns.":"ऑफलाइन; कनेक्शन लौटने पर लंबित एंट्री फिर भेजी जाएगी।",
  "Backup page was incomplete. Please retry.":"बैकअप पेज अधूरा था। कृपया फिर कोशिश करें।",
  "Backup pagination stopped unexpectedly. Please restart the backup.":"बैकअप पेजिंग अचानक रुक गई। कृपया बैकअप फिर शुरू करें।",
  "No daily reports available for this filter.":"इस फ़िल्टर के लिए कोई दैनिक रिपोर्ट उपलब्ध नहीं है।",
  "Server error. Please try again.":"सर्वर में त्रुटि हुई। कृपया फिर कोशिश करें।",
  "Server configuration unavailable":"सर्वर सेटिंग उपलब्ध नहीं है।",
  "Server not configured":"सर्वर कॉन्फ़िगर नहीं है।",
  "Method not allowed":"यह अनुरोध स्वीकार नहीं है।",
  "Login required":"लॉगिन आवश्यक है।",
  "Account inactive":"खाता निष्क्रिय है।",
  "Access denied":"आपको अनुमति नहीं है।",
  "Admin access required":"एडमिन अनुमति आवश्यक है।",
  "Invalid record details":"रिकॉर्ड का विवरण सही नहीं है।",
  "Record not found":"रिकॉर्ड नहीं मिला।",
  "Invalid date":"दिनांक सही नहीं है।",
  "Invalid start time":"शुरू समय सही नहीं है।",
  "Reason required":"कारण दर्ज करना आवश्यक है।",
  "Invalid count":"संख्या सही नहीं है।",
  "Invalid reading":"रीडिंग सही नहीं है।",
  "Invalid breaker status":"ब्रेकर की स्थिति सही नहीं है।",
  "No changes supplied":"कोई बदलाव दर्ज नहीं किया गया।",
  "Invalid backup collection":"बैकअप कलेक्शन सही नहीं है।",
  "Invalid backup cursor":"बैकअप कर्सर सही नहीं है।",
  "Backup cursor expired. Restart the backup.":"बैकअप कर्सर की अवधि समाप्त हो गई। बैकअप फिर शुरू करें।",
  "Invalid history cursor":"इतिहास कर्सर सही नहीं है।",
  "History cursor expired. Refresh records and try again.":"इतिहास कर्सर की अवधि समाप्त हो गई। रिकॉर्ड रिफ्रेश करके फिर कोशिश करें।",
  "History cursor does not belong to this Power House.":"यह इतिहास कर्सर इस पावर हाउस का नहीं है।",
  "History cursor does not belong to this Staff account.":"यह इतिहास कर्सर इस स्टाफ खाते का नहीं है।",
  "Notification ID required":"नोटिफिकेशन आईडी आवश्यक है।",
  "Notification not found":"नोटिफिकेशन नहीं मिला।",
  "Invalid action":"अनुरोध की कार्रवाई सही नहीं है।",
  "Invalid User ID or PIN":"यूजर आईडी या पिन सही नहीं है।",
  "Too many attempts. Please try again after 15 minutes.":"बहुत अधिक प्रयास हुए। कृपया 15 मिनट बाद फिर कोशिश करें।",
  "Account is not active. Contact Admin.":"खाता सक्रिय नहीं है। एडमिन से संपर्क करें।",
  "Login service error. Please try again.":"लॉगिन सेवा में त्रुटि हुई। कृपया फिर कोशिश करें।",
  "Invalid Power House name":"पावर हाउस का नाम सही नहीं है।",
  "Power House already exists":"यह पावर हाउस पहले से मौजूद है।",
  "Select a Power House":"पावर हाउस चुनें।",
  "Invalid Feeder name":"फीडर का नाम सही नहीं है।",
  "Power House not found or inactive":"पावर हाउस नहीं मिला या निष्क्रिय है।",
  "Feeder already exists":"यह फीडर पहले से मौजूद है।",
  "Invalid Staff details":"स्टाफ का विवरण सही नहीं है।",
  "User ID already exists":"यह यूजर आईडी पहले से मौजूद है।"
};
Object.assign(hindiWords, {
  "Preparing backup...":"बैकअप तैयार हो रहा है...",
  "No records in selected date range.":"चुनी गई दिनांक सीमा में कोई रिकॉर्ड नहीं है।",
  "All available history is loaded. Summaries include all records matching the selected filters.":"पूरा उपलब्ध इतिहास लोड है। सारांश में चुने गए फ़िल्टर के सभी रिकॉर्ड शामिल हैं।",
  "These summaries may be incomplete. Select Load All History above to include older records.":"ये सारांश अधूरे हो सकते हैं। पुराने रिकॉर्ड शामिल करने के लिए ऊपर पूरा इतिहास लोड करें।",
  "No repeat breakdown found in selected dates.":"चुनी गई तारीखों में दोहराया गया ब्रेकडाउन नहीं मिला।",
  "No feeder outage records in selected dates.":"चुनी गई तारीखों में इस फीडर का कोई आउटेज रिकॉर्ड नहीं है।",
  "No daily records.":"कोई दैनिक रिकॉर्ड नहीं है।",
  "No monthly records.":"कोई मासिक रिकॉर्ड नहीं है।",
  "No history loaded.":"इतिहास लोड नहीं हुआ।",
  "No entries found in your history.":"आपके इतिहास में कोई एंट्री नहीं मिली।",
  "No reports found.":"कोई रिपोर्ट नहीं मिली।",
  "None ongoing.":"अभी कोई घटना चालू नहीं है।",
  "Edit Record":"रिकॉर्ड संपादित करें",
  "Mark read":"पढ़ा हुआ चिन्हित करें",
  "Read":"पढ़ा गया",
  "New":"नया",
  "Breakdown":"ब्रेकडाउन",
  "Shutdown":"शटडाउन",
  "Tripping":"ट्रिपिंग",
  "Consumption":"खपत",
  "Daily Report":"दैनिक रिपोर्ट",
  "Status:":"स्थिति:",
  "Saved":"सेव हुआ",
  "Duration:":"अवधि:",
  "Staff:":"स्टाफ:",
  "Trippings:":"ट्रिपिंग:",
  "Feeders:":"फीडर:",
  "Total:":"कुल:",
  "BSK · Power House Feeder Log":"BSK · पावर हाउस फीडर लॉग"
});
 
const hindiPlaceholders = {
  "Enter User ID":"यूजर आईडी दर्ज करें","Feeder name":"फीडर का नाम",
  "e.g. 45 minutes":"जैसे 45 मिनट","Enter Power House name":"पावर हाउस का नाम दर्ज करें",
  "Enter Feeder name":"फीडर का नाम दर्ज करें","Example: Staff001":"उदाहरण: Staff001",
  "Enter 4-digit PIN":"4 अंकों का पिन दर्ज करें","Search feeder or staff ID":"फीडर या स्टाफ आईडी खोजें",
  "Enter feeder name":"फीडर का नाम दर्ज करें"
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
  document.querySelectorAll("[placeholder]").forEach(element => {
    if (!element.dataset.bskEnglishPlaceholder) element.dataset.bskEnglishPlaceholder = element.placeholder;
    const original = element.dataset.bskEnglishPlaceholder;
    element.placeholder = hindiMode ? (hindiPlaceholders[original] || original) : original;
  });
  if ($("languageToggle")) { const label=hindiMode ? "English" : "हिन्दी"; if ($("languageToggle").textContent !== label) $("languageToggle").textContent=label; }
  document.documentElement.lang = hindiMode ? "hi" : "en";
}
$("languageToggle")?.addEventListener("click",()=>{hindiMode=!hindiMode;localStorage.setItem("bsk-language",hindiMode?"hi":"en");applyLanguage();renderOfflineQueueStatus();});
const languageObserver = new MutationObserver(()=>{ if(hindiMode) applyLanguage(); });
languageObserver.observe(document.body,{childList:true,subtree:true});
if (hindiMode) applyLanguage();

function bskAlert(englishText) {
  const translated = hindiMode ? (hindiWords[englishText] || englishText) : englishText;
  alert(translated);
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => console.warn("BSK offline cache unavailable:", error));
  });
}

$("downloadDailyReports")?.addEventListener("click", () => {
  if (!requireCompleteHistoryForExport()) return;
  let reports = getFilteredReports();
  if (!reports.length) { bskAlert("No daily reports available for this filter."); return; }
  const columns = ["Report Date","Power House","Feeder","Breaker Status","Event Type","Fault Details","Duration","Restoration Time","Remarks","Staff User ID"];
  const rows = [columns, ...reports.map(r=>[r.reportDate,r.houseName,r.feederName,r.breakerStatus,r.eventType,r.faultDetails,r.duration,r.restorationTime,r.remarks,r.createdByUserId])];
  const esc = xmlEscape;
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
  else refreshOperationalRecordsPreservingHistory();
}, 60000);

$("notificationList")?.addEventListener("click", async event => {
  const button=event.target.closest("[data-notification-id]");
  if (!button) return;
  try {
    await recordsRequest("markNotificationRead",{id:button.dataset.notificationId});
    await refreshOperationalRecordsPreservingHistory();
  } catch(error) { bskAlert(error.message); }
});
