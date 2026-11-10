import admin from "firebase-admin";
import crypto from "node:crypto";

function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("Server is not configured");
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
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
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return !locked;
  });
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const { userId, pin } = await req.json();
    if (typeof userId !== "string" || !/^[A-Za-z0-9_-]{3,40}$/.test(userId) ||
        typeof pin !== "string" || !/^[0-9]{4}$/.test(pin)) {
      return Response.json({ error: "Invalid User ID or PIN" }, { status: 400 });
    }
    const fb = getAdmin();
    const db = fb.firestore();
    const allowed = await rateLimit(db, userId, false, true);
    if (!allowed) return Response.json({ error: "Too many attempts. Please try again after 15 minutes." }, { status: 429 });
    const snap = await db.collection("users").where("userId", "==", userId).limit(1).get();
    if (snap.empty) {
      await rateLimit(db, userId);
      return Response.json({ error: "Invalid User ID or PIN" }, { status: 401 });
    }
    const userDoc = snap.docs[0];
    const profile = userDoc.data();
    if (profile.active !== true || !profile.pinSalt || !profile.pinHash) {
      return Response.json({ error: "Account is not active. Contact Admin." }, { status: 403 });
    }
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

    await rateLimit(db, userId, true);
    const uid = userDoc.id;
    const customToken = await fb.auth().createCustomToken(uid, {
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
    return Response.json({
      error: `Login service error. Please try again. Reference: ${requestId}`,
      requestId,
      diagnostic: {
        name: error?.name || "Error",
        code: error?.code || "UNKNOWN"
      }
    }, { status: 500 });
  }

};
