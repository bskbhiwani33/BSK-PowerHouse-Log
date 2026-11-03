
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getAuth,
  signInWithCustomToken,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp
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
  editRequests: []
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
    }

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

  $("appPanel").classList.add("hidden");
  $("loginCard").classList.remove("hidden");

  $("pin").value = "";
});

// Staff: Load assigned Power House feeders
async function loadStaffFeeders() {
  const feederField = $("feederName");
  if (!feederField || !currentProfile?.houseId) return;

  try {
    const feederQuery = query(
      collection(db, "feeders"),
      where("houseId", "==", currentProfile.houseId),
      where("active", "==", true)
    );

    const snapshot = await getDocs(feederQuery);

    // Convert the existing feeder input into a dropdown.
    const select = document.createElement("select");
    select.id = "feederName";
    select.name = "feederName";
    select.required = true;
    select.className = feederField.className;

    select.innerHTML = '<option value="">Select Feeder</option>';

    snapshot.forEach(doc => {
      const feeder = doc.data();
      const option = document.createElement("option");
      option.value = doc.id;
      option.textContent = feeder.name;
      option.dataset.name = feeder.name;
      select.appendChild(option);
    });

    feederField.replaceWith(select);

    if (snapshot.empty) {
      message(
        "reportMessage",
        "No active feeder found. Contact Admin.",
        true
      );
    }

  } catch (error) {
    message(
      "reportMessage",
      "Could not load feeders. Check database rules.",
      true
    );
  }
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

    await addDoc(collection(db, "daily_reports"), {
      houseId: currentProfile.houseId,
      houseName: currentProfile.houseName || "",
      feederId: selectedOption.value,
      feederName: selectedOption.dataset.name || selectedOption.textContent,
      reportDate: $("reportDate").value,
      breakerStatus: $("breakerStatus").value,
      eventType: $("eventType").value,
      faultDetails: $("faultDetails").value.trim(),
      duration: $("duration").value.trim(),
      restorationTime: $("restorationTime").value,
      remarks: $("remarks").value.trim(),
      submittedBy: auth.currentUser.uid,
      createdAt: serverTimestamp()
    });

    $("reportForm").reset();
    setToday();

    message("reportMessage", "Report submitted successfully.");

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
    message("houseMessage", "Dashboard updated.");

  } catch (error) {
    message("houseMessage", error.message, true);
  }
}

$("refreshDashboard")?.addEventListener("click", refreshDashboard);

// Admin: Render dashboard
function renderDashboard() {
  const {
    houses, feeders, users, reports, editRequests
  } = dashboardData;

  if ($("houseCount")) $("houseCount").textContent = houses.length;
  if ($("feederCount")) $("feederCount").textContent = feeders.length;
  if ($("staffCount")) {
    $("staffCount").textContent =
      users.filter(user => user.role === "staff" && user.active).length;
  }
  if ($("reportCount")) $("reportCount").textContent = reports.length;

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
  renderEditRequests();
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
  if ($("filterHouse")) $("filterHouse").value = "";
  if ($("filterDate")) $("filterDate").value = "";
  renderReports();
});

function getFilteredReports() {
  let reports = [...dashboardData.reports];

  const houseId = $("filterHouse")?.value || "";
  const date = $("filterDate")?.value || "";

  if (houseId) {
    reports = reports.filter(r => r.houseId === houseId);
  }

  if (date) {
    reports = reports.filter(r => r.reportDate === date);
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
        <hr>
      </div>
    `).join("")
    : "<p>No reports found.</p>";
}

// Admin: Edit request list
function renderEditRequests() {
  const list = $("editRequestList");
  if (!list) return;

  const requests = dashboardData.editRequests || [];

  list.innerHTML = requests.length
    ? requests.map(r => `
      <div>
        <p><strong>${safe(r.status || "pending")}</strong></p>
        <p>Power House: ${safe(r.houseId)}</p>
        <p>Staff: ${safe(r.submittedBy)}</p>
        <p>Reason: ${safe(r.reason || r.message || "")}</p>
        <hr>
      </div>
    `).join("")
    : "<p>No edit requests.</p>";
}

// Export filtered reports as Excel-compatible CSV
function exportReportsCSV() {
  const reports = getFilteredReports();

  if (!reports.length) {
    alert("No reports available to export.");
    return;
  }

  const columns = [
    "Report Date",
    "Power House",
    "Feeder",
    "Breaker Status",
    "Event Type",
    "Fault Details",
    "Duration",
    "Restoration Time",
    "Remarks"
  ];

  const rows = reports.map(r => [
    r.reportDate,
    r.houseName,
    r.feederName,
    r.breakerStatus,
    r.eventType,
    r.faultDetails,
    r.duration,
    r.restorationTime,
    r.remarks
  ]);

  const csv = [columns, ...rows]
    .map(row => row.map(value =>
      `"${String(value ?? "").replace(/"/g, '""')}"`
    ).join(","))
    .join("\r\n");

  const blob = new Blob(
    ["\uFEFF" + csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "BSK_Feeder_Reports.csv";
  link.click();

  URL.revokeObjectURL(url);
}

// Export button, if present in HTML
$("exportReports")?.addEventListener("click", exportReportsCSV);

// Initial setup
setToday();
