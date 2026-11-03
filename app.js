
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
  serverTimestamp,
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
  editRequests: []
};

$("reportDate").valueAsDate = new Date();

// ---------------- ADMIN API ----------------

async function adminRequest(action, data = {}) {
  if (!auth.currentUser) throw new Error("Please login again.");

  const token = await auth.currentUser.getIdToken();

  const response = await fetch("/.netlify/functions/admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify({ action, ...data })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Request failed");
  }

  return result;
}

// ---------------- LOGIN ----------------

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  $("loginMessage").textContent = "Signing in...";

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
      (currentProfile.houseName ? " · " + currentProfile.houseName : "");

    $("staffPanel").classList.toggle(
      "hidden", currentProfile.role !== "staff"
    );

    $("adminPanel").classList.toggle(
      "hidden", currentProfile.role !== "admin"
    );

    $("loginMessage").textContent = "";

    if (currentProfile.role === "admin") {
      await loadDashboard();
    }

  } catch (error) {
    $("loginMessage").textContent = error.message;
  }
});

// ---------------- LOGOUT ----------------

$("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);

  currentProfile = null;

  $("appPanel").classList.add("hidden");
  $("loginCard").classList.remove("hidden");

  $("pin").value = "";
  $("userId").value = "";
});

// ---------------- STAFF REPORT ----------------

$("reportForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!auth.currentUser || currentProfile?.role !== "staff") return;

  $("reportMessage").textContent = "Submitting report...";

  try {
    const feederName = $("feederName").value.trim();

    const feederQuery = query(
      collection(db, "feeders"),
      where("houseId", "==", currentProfile.houseId),
      where("name", "==", feederName),
      where("active", "==", true)
    );

    const feederSnap = await getDocs(feederQuery);

    if (feederSnap.empty) {
      throw new Error("Feeder not found. Contact Admin.");
    }

    const feederId = feederSnap.docs[0].id;

    await addDoc(collection(db, "daily_reports"), {
      houseId: currentProfile.houseId,
      feederId,
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
    $("reportDate").valueAsDate = new Date();

    $("reportMessage").textContent = "Report submitted successfully.";

  } catch (error) {
    $("reportMessage").textContent = error.message ||
      "Report could not be submitted.";
  }
});

// ---------------- SAFE DISPLAY HELPERS ----------------

function addText(parent, text) {
  const span = document.createElement("span");
  span.textContent = text ?? "";
  parent.appendChild(span);
  return span;
}

function addLine(parent, text) {
  const div = document.createElement("div");
  div.style.padding = "7px 0";
  div.style.borderBottom = "1px solid #e5e7eb";
  div.textContent = text;
  parent.appendChild(div);
}

function houseName(houseId) {
  return dashboardData.houses.find(h => h.id === houseId)?.name || "Unknown";
}

function feederName(feederId) {
  return dashboardData.feeders.find(f => f.id === feederId)?.name || "Unknown";
}

// ---------------- LOAD DASHBOARD ----------------

async function loadDashboard() {
  $("adminMessage").textContent = "Loading dashboard...";

  try {
    dashboardData = await adminRequest("getDashboardData");

    $("houseCount").textContent = dashboardData.houses.length;
    $("feederCount").textContent = dashboardData.feeders.length;

    $("staffCount").textContent =
      dashboardData.users.filter(u => u.role === "staff" && u.active).length;

    $("reportCount").textContent = dashboardData.reports.length;

    fillHouseDropdowns();
    renderHouseList();
    renderFeederList();
    renderStaffList();
    renderReports();
    renderEditRequests();

    $("adminMessage").textContent = "Dashboard updated successfully.";

  } catch (error) {
    $("adminMessage").textContent = error.message;
  }
}

$("refreshDashboard").addEventListener("click", loadDashboard);

// ---------------- HOUSE DROPDOWNS ----------------

function fillHouseDropdowns() {
  const dropdowns = [
    "feederHouse",
    "staffHouse",
    "filterHouse"
  ];

  dropdowns.forEach(id => {
    const select = $(id);
    const oldValue = select.value;

    select.replaceChildren();

    const first = document.createElement("option");
    first.value = "";

    first.textContent = id === "filterHouse"
      ? "All Power Houses"
      : "Select Power House";

    select.appendChild(first);

    dashboardData.houses
      .filter(h => h.active === true)
      .forEach(house => {
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

// ---------------- CREATE HOUSE ----------------

$("houseForm").addEventListener("submit", async event => {
  event.preventDefault();

  $("houseMessage").textContent = "Adding Power House...";

  try {
    await adminRequest("createHouse", {
      houseName: $("houseName").value.trim()
    });

    $("houseForm").reset();
    $("houseMessage").textContent = "Power House added.";

    await loadDashboard();

  } catch (error) {
    $("houseMessage").textContent = error.message;
  }
});

// ---------------- CREATE FEEDER ----------------

$("feederForm").addEventListener("submit", async event => {
  event.preventDefault();

  $("feederMessage").textContent = "Adding Feeder...";

  try {
    await adminRequest("createFeeder", {
      houseId: $("feederHouse").value,
      feederName: $("newFeederName").value.trim()
    });

    $("feederForm").reset();
    $("feederMessage").textContent = "Feeder added.";

    await loadDashboard();

  } catch (error) {
    $("feederMessage").textContent = error.message;
  }
});

// ---------------- CREATE STAFF ----------------

$("staffForm").addEventListener("submit", async event => {
  event.preventDefault();

  $("staffMessage").textContent = "Creating Staff account...";

  try {
    await adminRequest("createStaff", {
      houseId: $("staffHouse").value,
      userId: $("newStaffId").value.trim(),
      pin: $("newStaffPin").value
    });

    $("staffForm").reset();

    $("staffMessage").textContent =
      "Staff account created successfully.";

    await loadDashboard();

  } catch (error) {
    $("staffMessage").textContent = error.message;
  }
});

// ---------------- HOUSE LIST ----------------

function renderHouseList() {
  const box = $("houseList");
  box.replaceChildren();

  if (!dashboardData.houses.length) {
    addText(box, "No Power Houses added yet.");
    return;
  }

  dashboardData.houses.forEach(h => {
    addLine(box, h.name + (h.active ? " · Active" : " · Inactive"));
  });
}

// ---------------- FEEDER LIST ----------------

function renderFeederList() {
  const box = $("feederList");
  box.replaceChildren();

  if (!dashboardData.feeders.length) {
    addText(box, "No Feeders added yet.");
    return;
  }

  dashboardData.feeders.forEach(f => {
    addLine(box, f.name + " · " + houseName(f.houseId));
  });
}

// ---------------- STAFF LIST ----------------

function renderStaffList() {
  const box = $("staffList");
  box.replaceChildren();

  const staff = dashboardData.users.filter(u => u.role === "staff");

  if (!staff.length) {
    addText(box, "No Staff accounts created.");
    return;
  }

  staff.forEach(u => {
    addLine(
      box,
      u.userId + " · " + u.houseName + " · " +
      (u.active ? "Active" : "Inactive")
    );
  });
}

// ---------------- REPORT LIST ----------------

function getFilteredReports() {
  const selectedHouse = $("filterHouse").value;
  const selectedDate = $("filterDate").value;

  return dashboardData.reports.filter(report => {
    const houseMatch =
      !selectedHouse || report.houseId === selectedHouse;

    const dateMatch =
      !selectedDate || report.reportDate === selectedDate;

    return houseMatch && dateMatch;
  });
}

function renderReports() {
  const box = $("reportList");
  box.replaceChildren();

  const reports = getFilteredReports();

  const heading = document.createElement("h3");
  heading.textContent = "Reports: " + reports.length;
  box.appendChild(heading);

  if (!reports.length) {
    addText(box, "No reports found.");
    return;
  }

  reports.forEach(r => {
    const card = document.createElement("div");
    card.style.padding = "12px";
    card.style.margin = "10px 0";
    card.style.border = "1px solid #ddd";
    card.style.borderRadius = "8px";

    const details = [
      "Date: " + r.reportDate,
      "Power House: " + houseName(r.houseId),
      "Feeder: " + feederName(r.feederId),
      "Breaker: " + r.breakerStatus,
      "Event: " + r.eventType,
      "Fault: " + r.faultDetails,
      "Duration: " + r.duration,
      "Restoration: " + r.restorationTime,
      "Remarks: " + r.remarks
    ];

    details.forEach(detail => addLine(card, detail));
    box.appendChild(card);
  });
}

$("applyReportFilter").addEventListener("click", renderReports);

$("clearReportFilter").addEventListener("click", () => {
  $("filterHouse").value = "";
  $("filterDate").value = "";
  renderReports();
});

// ---------------- CSV / EXCEL EXPORT ----------------

const exportButton = document.createElement("button");
exportButton.type = "button";
exportButton.textContent = "Export Reports to Excel";
exportButton.style.marginBottom = "15px";

$("reportList").parentElement.insertBefore(
  exportButton,
  $("reportList")
);

exportButton.addEventListener("click", () => {
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
    houseName(r.houseId),
    feederName(r.feederId),
    r.breakerStatus,
    r.eventType,
    r.faultDetails,
    r.duration,
    r.restorationTime,
    r.remarks
  ]);

  const escapeCSV = value =>
    '"' + String(value ?? "").replace(/"/g, '""') + '"';

  const csv = "\uFEFF" +
    [columns, ...rows]
      .map(row => row.map(escapeCSV).join(","))
      .join("\r\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "BSK_Feeder_Reports.csv";
  link.click();

  URL.revokeObjectURL(url);
});

// ---------------- EDIT REQUESTS ----------------

function renderEditRequests() {
  const box = $("editRequestList");
  box.replaceChildren();

  if (!dashboardData.editRequests.length) {
    addText(box, "No Edit Requests found.");
    return;
  }

  dashboardData.editRequests.forEach(request => {
    const details = [
      "Status: " + (request.status || "Pending"),
      "Power House: " + houseName(request.houseId),
      "Reason: " + (request.reason || request.message || "Not provided")
    ];

    details.forEach(detail => addLine(box, detail));
  });
}
