
import { getApps, getApp, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "node:crypto";

function getAdmin() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("Server not configured");

    initializeApp({
      credential: cert(JSON.parse(raw))
    });
  }
  return getApp();
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const setupKey = process.env.ADMIN_SETUP_KEY;
    if (!setupKey) {
      return Response.json({ error: "Setup is disabled" }, { status: 403 });
    }

    const { userId, pin, setupSecret } = await req.json();

    if (typeof setupSecret !== "string") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const a = Buffer.from(setupSecret);
    const b = Buffer.from(setupKey);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (
      typeof userId !== "string" ||
      !/^[A-Za-z0-9_-]{3,40}$/.test(userId) ||
      typeof pin !== "string" ||
      !/^[0-9]{4}$/.test(pin)
    ) {
      return Response.json({ error: "Invalid User ID or PIN" }, { status: 400 });
    }

    const fb = getAdmin();
    const db = getFirestore(fb);

    const pinSalt = crypto.randomBytes(16).toString("hex");
    const pinHash = crypto.scryptSync(pin, pinSalt, 64).toString("hex");
    const userRef = db.collection("users").doc();
    const setupGuardRef = db.collection("admin_setup_guard").doc("primary");

    await db.runTransaction(async tx => {
      const [existingAdmin, setupGuard] = await Promise.all([
        tx.get(db.collection("users").where("role", "==", "admin").limit(1)),
        tx.get(setupGuardRef)
      ]);

      if (!existingAdmin.empty || setupGuard.exists) {
        throw Object.assign(new Error("Admin already exists"), { status: 409 });
      }

      tx.create(userRef, {
        userId,
        pinSalt,
        pinHash,
        role: "admin",
        active: true,
        houseId: "",
        houseName: "",
        createdAt: FieldValue.serverTimestamp()
      });
      tx.create(setupGuardRef, {
        adminUid: userRef.id,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return Response.json({
      success: true,
      message: "Admin account created"
    });

  } catch (error) {
    return Response.json({
      error: error.status ? error.message : "Admin setup failed"
    }, { status: error.status || 500 });
  }
};
