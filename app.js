// BSK starter frontend. Firebase config is added in the next setup step.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, signInWithCustomToken, signOut } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

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
const $ = (id) => document.getElementById(id);
let currentProfile = null;

$("reportDate").valueAsDate = new Date();

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginMessage").textContent = "Signing in…";
  const userId = $("userId").value.trim();
  const pin = $("pin").value.trim();
  try {
    const response = await fetch("/.netlify/functions/login", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ userId, pin })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Login failed");
    await signInWithCustomToken(auth, result.token);
    currentProfile = result.profile;
    $("loginCard").classList.add("hidden");
    $("appPanel").classList.remove("hidden");
    $("welcome").textContent = `${currentProfile.userId} · ${currentProfile.role}${currentProfile.houseName ? " · " + currentProfile.houseName : ""}`;
    $("staffPanel").classList.toggle("hidden", currentProfile.role !== "staff");
    $("adminPanel").classList.toggle("hidden", currentProfile.role !== "admin");
    $("loginMessage").textContent = "";
  } catch (error) {
    $("loginMessage").textContent = error.message || "Unable to login";
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  currentProfile = null;
  $("appPanel").classList.add("hidden");
  $("loginCard").classList.remove("hidden");
  $("pin").value = "";
});

$("reportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth.currentUser || currentProfile?.role !== "staff") return;
  $("reportMessage").textContent = "Submitting…";
  try {
    await addDoc(collection(db, "daily_reports"), {
      houseId: currentProfile.houseId,
      houseName: currentProfile.houseName || "",
      feederName: $("feederName").value.trim(),
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
    $("reportMessage").textContent = "Report submitted.";
  } catch (error) {
    $("reportMessage").textContent = "Report could not be submitted. Check database rules and setup.";
  }
});
