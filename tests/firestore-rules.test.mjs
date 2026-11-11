import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";

const rules = await readFile("firestore.rules", "utf8");
const env = await initializeTestEnvironment({
  projectId: "demo-bsk",
  firestore: { rules }
});

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "powerhouses", "house-1"), { name: "House 1", active: true });
    await setDoc(doc(db, "powerhouses", "house-2"), { name: "House 2", active: true });
    await setDoc(doc(db, "feeders", "feeder-1"), { houseId: "house-1", name: "Feeder 1", active: true });
    await setDoc(doc(db, "feeders", "feeder-2"), { houseId: "house-2", name: "Feeder 2", active: true });
    await setDoc(doc(db, "daily_reports", "report-1"), { houseId: "house-1" });
    await setDoc(doc(db, "daily_reports", "report-2"), { houseId: "house-2" });
    await setDoc(doc(db, "breakdowns", "outage-1"), { houseId: "house-1" });
    await setDoc(doc(db, "trippings", "tripping-1"), { houseId: "house-1" });
    await setDoc(doc(db, "consumption_readings", "consumption-1"), { houseId: "house-1" });
    await setDoc(doc(db, "feeder_status", "feeder-1"), { houseId: "house-1" });
    await setDoc(doc(db, "entry_history", "history-1"), { houseId: "house-1" });
    await setDoc(doc(db, "notifications", "notification-1"), { houseId: "house-1" });
    await setDoc(doc(db, "login_attempt_limits", "attempt-1"), { attempts: 1 });
    await setDoc(doc(db, "staff_house_assignments", "house-1"), { houseId: "house-1", staffUid: "staff-1" });
    await setDoc(doc(db, "staff_user_id_claims", "claim-1"), { userId: "staff1", staffUid: "staff-1" });
    await setDoc(doc(db, "admin_setup_guard", "primary"), { adminUid: "admin-1" });
    await setDoc(doc(db, "users", "staff-1"), { role: "staff" });
    await setDoc(doc(db, "edit_requests", "legacy-1"), { houseId: "house-1" });
  });

  const staffDb = env.authenticatedContext("staff-1", {
    role: "staff",
    houseId: "house-1"
  }).firestore();
  const adminDb = env.authenticatedContext("admin-1", {
    role: "admin"
  }).firestore();
  const otherStaffDb = env.authenticatedContext("staff-2", {
    role: "staff",
    houseId: "house-2"
  }).firestore();
  const anonDb = env.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(staffDb, "powerhouses", "house-1")));
  await assertFails(getDoc(doc(staffDb, "powerhouses", "house-2")));
  await assertSucceeds(getDoc(doc(staffDb, "feeders", "feeder-1")));
  await assertFails(getDoc(doc(staffDb, "feeders", "feeder-2")));
  await assertSucceeds(getDoc(doc(staffDb, "daily_reports", "report-1")));
  await assertFails(getDoc(doc(staffDb, "daily_reports", "report-2")));
  await assertFails(setDoc(doc(staffDb, "daily_reports", "new-report"), { houseId: "house-1" }));
  await assertFails(setDoc(doc(staffDb, "daily_reports", "report-1"), { houseId: "house-1", changed: true }));
  await assertFails(deleteDoc(doc(staffDb, "daily_reports", "report-1")));
  await assertFails(getDoc(doc(staffDb, "breakdowns", "outage-1")));
  // Operational collections are backend-only, even for authenticated Staff/Admin.
  for (const [collection, id] of [
    ["trippings", "tripping-1"],
    ["consumption_readings", "consumption-1"],
    ["feeder_status", "feeder-1"],
    ["entry_history", "history-1"],
    ["notifications", "notification-1"],
    ["login_attempt_limits", "attempt-1"],
    ["staff_house_assignments", "house-1"],
    ["staff_user_id_claims", "claim-1"],
    ["admin_setup_guard", "primary"]
  ]) {
    await assertFails(getDoc(doc(staffDb, collection, id)));
    await assertFails(setDoc(doc(staffDb, collection, "staff-write"), { houseId: "house-1" }));
    await assertFails(getDoc(doc(adminDb, collection, id)));
    await assertFails(setDoc(doc(adminDb, collection, "admin-write"), { houseId: "house-1" }));
  }
  await assertFails(getDoc(doc(staffDb, "users", "staff-1")));
  await assertFails(getDoc(doc(adminDb, "users", "staff-1")));
  await assertFails(getDoc(doc(staffDb, "edit_requests", "legacy-1")));
  await assertFails(getDoc(doc(adminDb, "edit_requests", "legacy-1")));
  await assertFails(getDoc(doc(anonDb, "powerhouses", "house-1")));
  await assertFails(setDoc(doc(anonDb, "powerhouses", "anonymous-house"), { name: "No Access" }));
  await assertSucceeds(getDoc(doc(otherStaffDb, "daily_reports", "report-2")));
  await assertSucceeds(getDoc(doc(adminDb, "daily_reports", "report-2")));
  await assertFails(setDoc(doc(adminDb, "daily_reports", "report-2"), { houseId: "house-2", changed: true }));
  await assertFails(getDoc(doc(anonDb, "daily_reports", "report-1")));

  console.log("Firestore rules access-control tests passed.");
} finally {
  await env.cleanup();
}
