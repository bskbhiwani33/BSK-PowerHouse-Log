import admin from "firebase-admin";

function fbAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("Server configuration unavailable");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const json = (data, status = 200) => Response.json(data, { status });
const validText = (v, max = 160) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
const validDocId = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const validDate = v => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(v + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === v;
};
const validTime = v => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const clean = v => String(v ?? "").trim();

async function actorFor(req, fb, db) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) throw Object.assign(new Error("Login required"), { status: 401 });
  const decoded = await fb.auth().verifyIdToken(h.slice(7));
  const snap = await db.collection("users").doc(decoded.uid).get();
  if (!snap.exists || snap.data().active !== true) throw Object.assign(new Error("Account inactive"), { status: 403 });
  const user = snap.data();
  if (!["admin", "staff"].includes(user.role)) throw Object.assign(new Error("Access denied"), { status: 403 });
  return { uid: decoded.uid, role: user.role, userId: user.userId || "", houseId: user.houseId || "", houseName: user.houseName || "" };
}

function requireRole(actor, role) {
  if (actor.role !== role) throw Object.assign(new Error("Access denied"), { status: 403 });
}

async function validateFeeder(db, actor, feederId) {
  if (!validDocId(feederId)) throw Object.assign(new Error("Feeder select karein"), { status: 400 });
  const snap = await db.collection("feeders").doc(feederId).get();
  if (!snap.exists || snap.data().active !== true) throw Object.assign(new Error("Feeder nahi mila ya inactive hai"), { status: 404 });
  const f = snap.data();
  if (actor.role === "staff" && f.houseId !== actor.houseId) throw Object.assign(new Error("Is feeder ka access nahi hai"), { status: 403 });
  const house = await db.collection("powerhouses").doc(f.houseId).get();
  if (!house.exists || house.data().active !== true) throw Object.assign(new Error("Power House inactive hai"), { status: 409 });
  return { feederId, feederName: f.name, houseId: f.houseId, houseName: house.data().name };
}


async function createOutage(db, actor, body, type) {
  requireRole(actor, "staff");
  if (!validDate(body.date) || !validTime(body.startTime) || !validText(body.reason, 1000)) {
    throw Object.assign(new Error("Date, start time aur reason zaroori hain"), { status: 400 });
  }
  if (body.endTime && !validTime(body.endTime)) throw Object.assign(new Error("End time sahi nahi hai"), { status: 400 });
  const feeder = await validateFeeder(db, actor, body.feederId);
  const collectionName = type === "Breakdown" ? "breakdowns" : "shutdowns";
  const clientId = typeof body.clientEntryId === "string" && /^[A-Za-z0-9_-]{12,80}$/.test(body.clientEntryId) ? body.clientEntryId : "";
  const ref = clientId ? db.collection(collectionName).doc(clientId) : db.collection(collectionName).doc();
  const statusRef = db.collection("feeder_status").doc(feeder.feederId);
  const historyRef = db.collection("entry_history").doc();
  const notificationRef = db.collection("notifications").doc();
  const status = body.endTime ? "resolved" : "ongoing";
  const data = {
    ...feeder, date: body.date, startTime: body.startTime, endTime: body.endTime || null,
    reason: clean(body.reason), status, createdBy: actor.uid, createdByUserId: actor.userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  return db.runTransaction(async tx => {
    const [duplicate, activeBreakdowns, activeShutdowns] = await Promise.all([
      tx.get(ref),
      tx.get(db.collection("breakdowns").where("feederId", "==", feeder.feederId).where("status", "==", "ongoing")),
      tx.get(db.collection("shutdowns").where("feederId", "==", feeder.feederId).where("status", "==", "ongoing"))
    ]);
    if (duplicate.exists) {
      if (duplicate.data().houseId !== feeder.houseId) throw Object.assign(new Error("Entry ID already used"), { status: 409 });
      return { id: ref.id, status: duplicate.data().status, duplicate: true };
    }
    const hasActiveOutage = [...activeBreakdowns.docs, ...activeShutdowns.docs]
      .some(doc => doc.data().status === "ongoing");
    // The outage collections are the source of truth. A stale feeder_status
    // document must not permanently block new entries when no outage is active.
    if (!body.endTime && hasActiveOutage) {
      throw Object.assign(new Error("Is feeder par pehle se Breakdown ya Shutdown ongoing hai"), { status: 409 });
    }
    tx.set(ref, data);
    if (!body.endTime) {
      tx.set(statusRef, {
        houseId: feeder.houseId, feederId: feeder.feederId, feederName: feeder.feederName,
        status: type, activeRecordId: ref.id, activeCollection: collectionName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    tx.set(historyRef, {
      recordCollection: collectionName, recordId: ref.id, houseId: feeder.houseId,
      action: "created", before: null,
      after: { ...data, createdAt: null, updatedAt: null },
      actorUid: actor.uid, actorUserId: actor.userId, actorRole: actor.role,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.set(notificationRef, {
      houseId: feeder.houseId, type: "new_entry", title: type + " entry",
      message: feeder.feederName + " · " + body.date, recordCollection: collectionName,
      recordId: ref.id, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { id: ref.id, status };
  });
}

async function resolveOutage(db, actor, body, type) {
  if (!validDocId(body.id) || !validTime(body.endTime)) throw Object.assign(new Error("Record aur end time zaroori hain"), { status: 400 });
  const collectionName = type === "Breakdown" ? "breakdowns" : "shutdowns";
  const ref = db.collection(collectionName).doc(body.id);
  const historyRef = db.collection("entry_history").doc();
  const outcome = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error("Record nahi mila"), { status: 404 });
    const old = snap.data();
    if (actor.role === "staff" && old.houseId !== actor.houseId) throw Object.assign(new Error("Access denied"), { status: 403 });
    if (old.status !== "ongoing") throw Object.assign(new Error("Yeh event pehle hi close ho chuka hai"), { status: 409 });
    const statusRef = db.collection("feeder_status").doc(old.feederId);
    const statusSnap = await tx.get(statusRef);
    const after = { ...old, endTime: body.endTime, status: "resolved", resolvedBy: actor.uid, resolvedByUserId: actor.userId, updatedAt: null };
    tx.update(ref, { endTime: body.endTime, status: "resolved", resolvedBy: actor.uid, resolvedByUserId: actor.userId, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    if (statusSnap.exists && statusSnap.data().activeRecordId === ref.id) {
      tx.set(statusRef, { ...statusSnap.data(), status: "Running", activeRecordId: null, activeCollection: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    tx.set(historyRef, {
      recordCollection: collectionName, recordId: ref.id, houseId: old.houseId,
      action: "resolved", before: old, after,
      actorUid: actor.uid, actorUserId: actor.userId, actorRole: actor.role,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { id: ref.id, status: "resolved" };
  });
  return outcome;
}

async function updateRecord(db, actor, body) {
  requireRole(actor, "admin");
  const name=clean(body.recordCollection), allowed=["breakdowns","shutdowns","daily_reports","trippings","consumption_readings"];
  if(!allowed.includes(name)||!validDocId(body.id)||!body.changes||typeof body.changes!=="object")throw Object.assign(new Error("Invalid record details"),{status:400});
  const ref=db.collection(name).doc(clean(body.id)), snap=await ref.get();
  if(!snap.exists)throw Object.assign(new Error("Record not found"),{status:404});
  const old=snap.data(), input=body.changes, next={}, dateKey=name==="daily_reports"?"reportDate":"date";
  if(input[dateKey]!==undefined){if(!validDate(input[dateKey]))throw Object.assign(new Error("Invalid date"),{status:400});next[dateKey]=input[dateKey];}
  if(name==="breakdowns"||name==="shutdowns"){
    if(input.startTime!==undefined){if(!validTime(input.startTime))throw Object.assign(new Error("Invalid start time"),{status:400});next.startTime=input.startTime;}
    // Closing/reopening outages must use the dedicated resolve workflow so feeder_status and audit history stay consistent.
    if(input.endTime!==undefined)throw Object.assign(new Error("End time ko Resolve Breakdown/Shutdown action se hi badlein"),{status:400});
    if(input.reason!==undefined){if(!validText(input.reason,1000))throw Object.assign(new Error("Reason required"),{status:400});next.reason=clean(input.reason);}
  } else if(name==="trippings"){
    for(const k of ["trippingCount","feederCount"])if(input[k]!==undefined){const n=Number(input[k]);if(!Number.isInteger(n)||n<0||n>10000)throw Object.assign(new Error("Invalid count"),{status:400});next[k]=n;}
  } else if(name==="consumption_readings"){
    const keys=["apFeeder","ruralDomestic","urban","industrial","independent"];
    for(const k of keys)if(input[k]!==undefined){const n=Number(input[k]);if(!Number.isFinite(n)||n<0||n>1e12)throw Object.assign(new Error("Invalid reading"),{status:400});next[k]=n;}
    next.total=keys.reduce((sum,k)=>sum+Number(next[k]??old[k]??0),0);
  } else {
    if(input.breakerStatus!==undefined){if(!["ON","OFF","TRIPPED","UNDER MAINTENANCE"].includes(input.breakerStatus))throw Object.assign(new Error("Invalid breaker status"),{status:400});next.breakerStatus=input.breakerStatus;}
    for(const k of ["faultDetails","duration","restorationTime","remarks"])if(input[k]!==undefined)next[k]=clean(input[k]).slice(0,2000);
  }
  if(!Object.keys(next).length)throw Object.assign(new Error("No changes supplied"),{status:400});
  const history=db.collection("entry_history").doc();
  await db.runTransaction(async tx=>{
    const current=await tx.get(ref);if(!current.exists)throw Object.assign(new Error("Record not found"),{status:404});
    const before=current.data(), after={...before,...next};
    tx.update(ref,{...next,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedBy:actor.uid,updatedByUserId:actor.userId});
    tx.set(history,{recordCollection:name,recordId:ref.id,houseId:before.houseId,action:"updated",before,after,actorUid:actor.uid,actorUserId:actor.userId,actorRole:actor.role,createdAt:admin.firestore.FieldValue.serverTimestamp()});
  });
  return {id:ref.id,updated:true};
}

async function createDailyReport(db, actor, body) {
  requireRole(actor, "staff");
  if (!validDate(body.reportDate)) throw Object.assign(new Error("Report date zaroori hai"), { status: 400 });
  const breakerAllowed = ["ON", "OFF", "TRIPPED", "UNDER MAINTENANCE"];
  const eventAllowed = ["Normal"];
  if (!breakerAllowed.includes(body.breakerStatus) || !eventAllowed.includes(body.eventType)) {
    throw Object.assign(new Error("Breaker status ya event type sahi select karein"), { status: 400 });
  }
  const feeder = await validateFeeder(db, actor, body.feederId);
  const clientId = typeof body.clientEntryId === "string" && /^[A-Za-z0-9_-]{12,80}$/.test(body.clientEntryId) ? body.clientEntryId : "";
  const ref = clientId ? db.collection("daily_reports").doc(clientId) : db.collection("daily_reports").doc();
  const data = {
    ...feeder, reportDate: body.reportDate, breakerStatus: body.breakerStatus,
    eventType: body.eventType, faultDetails: clean(body.faultDetails).slice(0,2000),
    duration: clean(body.duration).slice(0,100), restorationTime: clean(body.restorationTime).slice(0,10),
    remarks: clean(body.remarks).slice(0,2000), submittedBy: actor.uid,
    createdByUserId: actor.userId, createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
  const historyRef = db.collection("entry_history").doc();
  const notificationRef = db.collection("notifications").doc();
  return db.runTransaction(async tx => {
    const duplicate = await tx.get(ref);
    if (duplicate.exists) {
      if (duplicate.data().houseId !== feeder.houseId) throw Object.assign(new Error("Entry ID already used"), { status: 409 });
      return { id: ref.id, duplicate: true };
    }
    tx.set(ref, data);
    tx.set(historyRef, { recordCollection:"daily_reports", recordId:ref.id, houseId:feeder.houseId, action:"created", before:null, after:{...data,createdAt:null}, actorUid:actor.uid, actorUserId:actor.userId, actorRole:actor.role, createdAt:admin.firestore.FieldValue.serverTimestamp() });
    tx.set(notificationRef, { houseId:feeder.houseId, type:"new_entry", title:"Daily feeder report", message:feeder.feederName+" · "+body.reportDate, recordCollection:"daily_reports", recordId:ref.id, read:false, createdAt:admin.firestore.FieldValue.serverTimestamp() });
    return { id: ref.id };
  });
}

async function createSimpleRecord(db, actor, body, collectionName) {
  requireRole(actor, "staff");
  if (!validText(actor.houseId, 128)) throw Object.assign(new Error("Staff Power House missing hai"), { status: 403 });
  const houseSnap = await db.collection("powerhouses").doc(actor.houseId).get();
  if (!houseSnap.exists || houseSnap.data().active !== true) throw Object.assign(new Error("Power House inactive hai"), { status: 409 });
  const houseName = houseSnap.data().name;
  if (!validDate(body.date)) throw Object.assign(new Error("Date zaroori hai"), { status: 400 });
  let data;
  if (collectionName === "trippings") {
    const trippingCount = Number(body.trippingCount), feederCount = Number(body.feederCount);
    if (body.trippingCount == null || body.feederCount == null || body.trippingCount === "" || body.feederCount === "" || !Number.isInteger(trippingCount) || trippingCount < 0 || trippingCount > 10000 ||
        !Number.isInteger(feederCount) || feederCount < 0 || feederCount > 10000) {
      throw Object.assign(new Error("Tripping aur feeder count sahi bharein"), { status: 400 });
    }
    data = { houseId: actor.houseId, houseName, date: body.date, trippingCount, feederCount };
  } else {
    const keys = ["apFeeder", "ruralDomestic", "urban", "industrial", "independent"];
    const values = {};
    for (const key of keys) {
      const n = Number(body[key]);
      if (body[key] == null || body[key] === "" || !Number.isFinite(n) || n < 0 || n > 1e12) throw Object.assign(new Error("Sabhi paanch consumption readings sahi bharein"), { status: 400 });
      values[key] = n;
    }
    data = { houseId: actor.houseId, houseName, date: body.date, ...values, total: keys.reduce((sum, key) => sum + values[key], 0) };
  }
  const clientId = typeof body.clientEntryId === "string" && /^[A-Za-z0-9_-]{12,80}$/.test(body.clientEntryId) ? body.clientEntryId : "";
  const ref = clientId ? db.collection(collectionName).doc(clientId) : db.collection(collectionName).doc();
  const saved = { ...data, createdBy: actor.uid, createdByUserId: actor.userId, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  const hist = db.collection("entry_history").doc();
  const note = db.collection("notifications").doc();
  return db.runTransaction(async tx => {
    const duplicate = await tx.get(ref);
    if (duplicate.exists) {
      if (duplicate.data().houseId !== actor.houseId) throw Object.assign(new Error("Entry ID already used"), { status: 409 });
      return { id: ref.id, duplicate: true, total: duplicate.data().total };
    }
    tx.set(ref, saved);
    tx.set(hist, { recordCollection: collectionName, recordId: ref.id, houseId: actor.houseId, action: "created", before: null, after: { ...saved, createdAt: null, updatedAt: null }, actorUid: actor.uid, actorUserId: actor.userId, actorRole: actor.role, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(note, { houseId: actor.houseId, type: "new_entry", title: collectionName === "trippings" ? "Tripping entry" : "Consumption entry", message: data.date, recordCollection: collectionName, recordId: ref.id, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { id: ref.id, total: data.total };
  });
}

export default async req => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const fb = fbAdmin();
    const db = fb.firestore();
    const actor = await actorFor(req, fb, db);
    const body = await req.json();
    switch (body.action) {
      case "createBreakdown": return json({ success: true, ...(await createOutage(db, actor, body, "Breakdown")) });
      case "createShutdown": return json({ success: true, ...(await createOutage(db, actor, body, "Shutdown")) });
      case "resolveBreakdown": return json({ success: true, ...(await resolveOutage(db, actor, body, "Breakdown")) });
      case "resolveShutdown": return json({ success: true, ...(await resolveOutage(db, actor, body, "Shutdown")) });
      case "updateRecord": return json({ success: true, ...(await updateRecord(db, actor, body)) });
      case "createDailyReport": return json({ success: true, ...(await createDailyReport(db, actor, body)) });
      case "createTripping": return json({ success: true, ...(await createSimpleRecord(db, actor, body, "trippings")) });
      case "createConsumption": return json({ success: true, ...(await createSimpleRecord(db, actor, body, "consumption_readings")) });
      case "exportBackupPage": {
        requireRole(actor, "admin");
        const allowed = ["powerhouses","feeders","users","breakdowns","shutdowns","trippings","consumption_readings","daily_reports","feeder_status","notifications","entry_history"];
        const name = clean(body.collection);
        if (!allowed.includes(name)) return json({ error: "Invalid backup collection" }, 400);
        const pageSize = 400;
        let q = db.collection(name).orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
        if (body.cursor !== undefined && body.cursor !== null && body.cursor !== "") {
          if (!validDocId(body.cursor)) {
            throw Object.assign(new Error("Invalid backup cursor"), { status: 400 });
          }
          const cursorSnap = await db.collection(name).doc(body.cursor).get();
          if (!cursorSnap.exists) {
            throw Object.assign(new Error("Backup cursor expired. Restart the backup."), { status: 409 });
          }
          q = q.startAfter(cursorSnap);
        }
        const snap = await q.get();
        const rows = snap.docs.map(d => {
          const data = { id: d.id, ...d.data() };
          if (name === "users") { delete data.pinSalt; delete data.pinHash; }
          return data;
        });
        return json({ success: true, rows, nextCursor: snap.size === pageSize ? snap.docs[snap.docs.length - 1].id : null });
      }
      case "getRecords": {
        const requestedHouse = clean(body.houseId);
        const houseId = actor.role === "admin" ? requestedHouse : actor.houseId;
        const names = ["breakdowns", "shutdowns", "trippings", "consumption_readings", "daily_reports", "feeder_status", "notifications", "entry_history"];
        const output = {};
        const pageSize = 500;
        const nextCursors = {};
        await Promise.all(names.map(async name => {
          // Staff only need their own audit trail. Admin receives the full
          // house-level history and notifications; do not expose coworkers'
          // audit metadata or admin notification feed to Staff clients.
          if (actor.role === "staff" && name === "notifications") {
            output[name] = [];
            nextCursors[name] = null;
            return;
          }
          let q = db.collection(name);
          if (houseId) q = q.where("houseId", "==", houseId);
          // Apply Staff ownership before pagination so other employees' audit
          // rows cannot consume pages and hide this Staff member's older history.
          if (actor.role === "staff" && name === "entry_history") {
            q = q.where("actorUid", "==", actor.uid);
          }
          if (name === "entry_history" || name === "notifications") q = q.orderBy("createdAt", "desc");
          else if (name !== "feeder_status") q = q.orderBy(name === "daily_reports" ? "reportDate" : "date", "desc");
          else q = q.orderBy(admin.firestore.FieldPath.documentId());

          const cursor = body.cursors && typeof body.cursors[name] === "string"
            ? body.cursors[name] : "";
          if (cursor) {
            if (!validDocId(cursor)) {
              throw Object.assign(new Error("Invalid history cursor"), { status: 400 });
            }
            const cursorSnap = await db.collection(name).doc(cursor).get();
            if (!cursorSnap.exists) {
              throw Object.assign(new Error("History cursor expired. Refresh records and try again."), { status: 409 });
            }
            if (houseId && cursorSnap.data().houseId !== houseId) {
              throw Object.assign(new Error("History cursor does not belong to this Power House."), { status: 403 });
            }
            if (actor.role === "staff" && name === "entry_history" && cursorSnap.data().actorUid !== actor.uid) {
              throw Object.assign(new Error("History cursor does not belong to this Staff account."), { status: 403 });
            }
            q = q.startAfter(cursorSnap);
          }

          const snap = await q.limit(pageSize).get();
          nextCursors[name] = snap.size === pageSize
            ? snap.docs[snap.docs.length - 1].id : null;

          const docs = new Map(snap.docs.map(d => [d.id, d]));
          // Keep every ongoing outage visible even when it falls on an older page.
          if (name === "breakdowns" || name === "shutdowns") {
            let ongoingQuery = db.collection(name).where("status", "==", "ongoing");
            if (houseId) ongoingQuery = ongoingQuery.where("houseId", "==", houseId);
            const ongoing = await ongoingQuery.get();
            ongoing.docs.forEach(d => docs.set(d.id, d));
          }
          output[name] = [...docs.values()]
            .filter(d => actor.role !== "staff" || name !== "entry_history" || d.data().actorUid === actor.uid)
            .map(d => ({ id: d.id, ...d.data() }));
        }));
        return json({ success: true, ...output, nextCursors });
      }
      case "markNotificationRead": {
        // New-entry notifications are an Admin inbox; Staff cannot acknowledge them.
        requireRole(actor, "admin");
        if (!validDocId(body.id)) return json({ error: "Notification ID required" }, 400);
        const ref = db.collection("notifications").doc(clean(body.id));
        const snap = await ref.get();
        if (!snap.exists) return json({ error: "Notification not found" }, 404);
        await ref.update({ read: true, readAt: admin.firestore.FieldValue.serverTimestamp(), readBy: actor.uid });
        return json({ success: true });
      }
      default: return json({ error: "Invalid action" }, 400);
    }
  } catch (error) {
    console.error("RECORDS FUNCTION ERROR:", error);
    return json({ error: error.status ? error.message : "Server error. Please try again." }, error.status || 500);
  }
};
