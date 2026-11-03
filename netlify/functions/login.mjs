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
    const snap = await db.collection("users").where("userId", "==", userId).limit(1).get();
    if (snap.empty) return Response.json({ error: "Invalid User ID or PIN" }, { status: 401 });
    const userDoc = snap.docs[0];
    const profile = userDoc.data();
    if (profile.active !== true || !profile.pinSalt || !profile.pinHash) {
      return Response.json({ error: "Account is not active. Contact Admin." }, { status: 403 });
    }
    const calculated = crypto.scryptSync(pin, profile.pinSalt, 64).toString("hex");
    const expected = Buffer.from(profile.pinHash, "hex");
    const actual = Buffer.from(calculated, "hex");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return Response.json({ error: "Invalid User ID or PIN" }, { status: 401 });
    }
    const uid = userDoc.id;
    const customToken = await fb.auth().createCustomToken(uid, {
      role: profile.role, houseId: profile.houseId || ""
    });
    return Response.json({
      token: customToken,
      profile: {
        userId: profile.userId, role: profile.role,
        houseId: profile.houseId || "", houseName: profile.houseName || ""
      }
    });
  } catch (error) {
    return Response.json({ error: "Login service is not configured correctly" }, { status: 500 });
  }
};
