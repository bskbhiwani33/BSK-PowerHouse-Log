
import admin from "firebase-admin";
import crypto from "node:crypto";

function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("Server not configured");

    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw))
    });
  }
  return admin;
}

function response(data, status = 200) {
  return Response.json(data, { status });
}

function validName(value) {
  return typeof value === "string" &&
    value.trim().length >= 2 &&
    value.trim().length <= 80;
}

function cleanDate(value) {
  return value?.toDate ? value.toDate().toISOString() : value || "";
}

export default async (req) => {
  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  try {
    const fb = getAdmin();
    const db = fb.firestore();

    const authHeader = req.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7) : "";

    if (!idToken) {
      return response({ error: "Login required" }, 401);
    }

    const decoded = await fb.auth().verifyIdToken(idToken);
    const adminDoc = await db.collection("users").doc(decoded.uid).get();

    if (!adminDoc.exists ||
        adminDoc.data().role !== "admin" ||
        adminDoc.data().active !== true) {
      return response({ error: "Admin access required" }, 403);
    }

    const body = await req.json();

    if (body.action === "getDashboardData") {
      const [housesSnap, feedersSnap, usersSnap, reportsSnap] =
        await Promise.all([
          db.collection("powerhouses").get(),
          db.collection("feeders").get(),
          db.collection("users").get(),
          db.collection("daily_reports")
            .orderBy("reportDate", "desc").limit(500).get()
        ]);

      const houses = housesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const feeders = feedersSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const users = usersSnap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          userId: d.userId || "",
          role: d.role || "",
          houseId: d.houseId || "",
          houseName: d.houseName || "",
          active: d.active === true
        };
      });

      const reports = reportsSnap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          houseId: d.houseId || "",
          houseName: d.houseName || "",
          feederId: d.feederId || "",
          feederName: d.feederName || "",
          reportDate: d.reportDate || "",
          breakerStatus: d.breakerStatus || "",
          eventType: d.eventType || "",
          faultDetails: d.faultDetails || "",
          duration: d.duration || "",
          restorationTime: d.restorationTime || "",
          remarks: d.remarks || "",
          submittedBy: d.submittedBy || "",
          createdByUserId: d.createdByUserId || "",
          createdAt: cleanDate(d.createdAt)
        };
      });

      return response({
        success: true,
        houses,
        feeders,
        users,
        reports
      });
    }

    if (body.action === "createHouse") {
      if (!validName(body.houseName)) {
        return response({ error: "Invalid Power House name" }, 400);
      }

      const houseName = body.houseName.trim();
      const existing = await db.collection("powerhouses")
        .where("name", "==", houseName).limit(1).get();

      if (!existing.empty) {
        return response({ error: "Power House already exists" }, 409);
      }

      const ref = db.collection("powerhouses").doc();

      await ref.set({
        name: houseName,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return response({
        success: true,
        message: "Power House created",
        houseId: ref.id
      });
    }

    if (body.action === "createFeeder") {
      const { houseId } = body;

      if (typeof houseId !== "string" || !houseId) {
        return response({ error: "Select a Power House" }, 400);
      }

      if (!validName(body.feederName)) {
        return response({ error: "Invalid Feeder name" }, 400);
      }

      const houseDoc = await db.collection("powerhouses").doc(houseId).get();

      if (!houseDoc.exists || houseDoc.data().active !== true) {
        return response({ error: "Power House not found or inactive" }, 404);
      }

      const feederName = body.feederName.trim();
      const existing = await db.collection("feeders")
        .where("houseId", "==", houseId)
        .where("name", "==", feederName).limit(1).get();

      if (!existing.empty) {
        return response({ error: "Feeder already exists" }, 409);
      }

      const ref = db.collection("feeders").doc();

      await ref.set({
        name: feederName,
        houseId,
        houseName: houseDoc.data().name,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return response({
        success: true,
        message: "Feeder created",
        feederId: ref.id
      });
    }

    if (body.action === "createStaff") {
      const { userId, pin, houseId } = body;

      if (typeof userId !== "string" ||
          !/^[A-Za-z0-9_-]{3,40}$/.test(userId) ||
          typeof pin !== "string" ||
          !/^[0-9]{4}$/.test(pin) ||
          typeof houseId !== "string" || !houseId) {
        return response({ error: "Invalid Staff details" }, 400);
      }

      const houseDoc = await db.collection("powerhouses").doc(houseId).get();

      if (!houseDoc.exists || houseDoc.data().active !== true) {
        return response({ error: "Power House not found or inactive" }, 404);
      }

      const existingUser = await db.collection("users")
        .where("userId", "==", userId).limit(1).get();

      if (!existingUser.empty) {
        return response({ error: "User ID already exists" }, 409);
      }

      const existingStaff = await db.collection("users")
        .where("houseId", "==", houseId)
        .where("role", "==", "staff")
        .where("active", "==", true).limit(1).get();

      if (!existingStaff.empty) {
        return response({
          error: "This Power House already has an active Staff member"
        }, 409);
      }

      const pinSalt = crypto.randomBytes(16).toString("hex");
      const pinHash = crypto.scryptSync(pin, pinSalt, 64).toString("hex");
      const ref = db.collection("users").doc();

      await ref.set({
        userId,
        pinSalt,
        pinHash,
        role: "staff",
        active: true,
        houseId,
        houseName: houseDoc.data().name,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return response({
        success: true,
        message: "Staff account created"
      });
    }

    return response({ error: "Invalid action" }, 400);

  
  } catch (error) {
    console.error("ADMIN FUNCTION ERROR:", error);

    return response({ error: "Server error. Please try again." }, 500);
  }

};
