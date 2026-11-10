import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "node:crypto";

function getAdmin() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("Server is not configured");
    const serviceAccount = JSON.parse(raw);
    initializeApp({ credential: cert(serviceAccount) });
  }
  return admin;
}

async function rateLimit(db, userId, success = false, checkOnly = false) {
  const key = crypto.createHash("sha256").update(userId.toLowerCase()).digest("hex");
  const ref = db.collection("login_attempt_limits").doc(key);
  const now = Date.now();
  if (success) { await ref.delete().catch(() => {}); return true; }
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    if (Number(data.lockUntil || 0) > now) return false;
    if (checkOnly) return true;
    const withinWindow = now - Number(data.windowStart || 0) < 10 * 60 * 1000;
    const attempts = withinWindow ? Number(data.attempts || 0) + 1 : 1;
    const locked = attempts >= 5;
    tx.set(ref, {
      attempts: locked ? 0 : attempts,
      windowStart: locked ? now : (withinWindow ? data.windowStart : now),
      lockUntil: locked ? now + 15 * 60 * 1000 : 0,
      updatedAt: FieldValue.serverTimestamp()
    });
    return !locked;
  });
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let stage = "read_request";
  try {
    const { userId, pin } = await req.json();
    if (typeof userId !== "string" || !/^[A-Za-z0-9_-]{3,40}$/.test(userId) ||
        typeof pin !== "string" || !/^[0-9]{4}$/.test(pin)) {
      return Response.json({ error: "Invalid User ID or PIN" }, { status: 400 });
    }
    stage = "initialize_firebase";
    const fb = getAdmin();
    stage = "initialize_firestore";
    const db = getFirestore(fb);
    stage = "check_rate_limit";
    const allowed = await rateLimit(db, userId, false, true);
    if (!allowed) return Response.json({ error: "Too many attempts. Please try again after 15 minutes." }, { status: 429 });
    stage = "find_user";
    const snap = await db.collection("users").where("userId", "==", userId).limit(1).get();
    if (snap.empty) {
      await rateLimit(db, userId);
      return Response.json({ error: "Invalid User ID or PIN" }, { status: 401 });
    }
    stage = "read_user_profile";
    const userDoc = snap.docs[0];
    const profile = userDoc.data();
    if (profile.active !== true || !profile.pinSalt || !profile.pinHash) {
      return Response.json({ error: "Account is not active. Contact Admin." }, { status: 403 });
    }
    stage = "verify_pin";
    const calculated = crypto.scryptSync(pin, profile.pinSalt, 64).toString("hex");
    const expected = Buffer.from(profile.pinHash, "hex");
    const actual = Buffer.from(calculated, "hex");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      await rateLimit(db, userId);
      return Response.json({ error: "Invalid User ID or PIN" }, { status: 401 });
    }
    if (!["admin", "staff"].includes(profile.role)) {
      return Response.json({ error: "Account role is not configured. Contact Admin." }, { status: 403 });
    }
    const houseId = profile.houseId || "";
    if (profile.role === "staff") {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(houseId)) {
        return Response.json({ error: "Staff Power House assignment is missing. Contact Admin." }, { status: 403 });
      }
      const houseSnap = await db.collection("powerhouses").doc(houseId).get();
      if (!houseSnap.exists || houseSnap.data().active !== true) {
        return Response.json({ error: "Assigned Power House is inactive. Contact Admin." }, { status: 403 });
      }
    }

    stage = "clear_rate_limit";
    await rateLimit(db, userId, true);
    const uid = userDoc.id;
    stage = "create_custom_token";
    const customToken = await getAuth(fb).createCustomToken(uid, {
      role: profile.role, houseId
    });
    return Response.json({
      token: customToken,
      profile: {
        uid, userId: profile.userId, role: profile.role,
        houseId: profile.houseId || "", houseName: profile.houseName || ""
      }
    });
  
  } catch (error) {
    // Correlate a failed login attempt without exposing credentials or Firebase
    // service-account details to the browser.
    const requestId = crypto.randomUUID();
    console.error("LOGIN FUNCTION ERROR", {
      requestId,
      name: error?.name || "Error",
      code: error?.code || "UNKNOWN",
      message: error?.message || "Unknown login failure"
    });
    const diagnosticCode = String(error?.code || error?.name || "UNKNOWN")
      .replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "UNKNOWN";
    return Response.json({
      error: `Login service error. Please try again. Diagnostic: ${diagnosticCode}. Reference: ${requestId}`,
      requestId,
      diagnostic: { code: diagnosticCode, stage }
    }, { status: 500 });
  }

};
