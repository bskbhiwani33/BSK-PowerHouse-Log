import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const app = read("app.js");
const html = read("index.html");
const admin = read("functions/handlers/admin.mjs");
const records = read("functions/handlers/records.mjs");
const functionsIndex = read("functions/index.js");

const expectedAdmin = [
  "getDashboardData", "updateHouse", "setHouseActive", "updateFeeder",
  "setFeederActive", "createHouse", "createFeeder", "createStaff"
];
const expectedRecords = [
  "createBreakdown", "createShutdown", "resolveBreakdown", "resolveShutdown",
  "updateRecord", "createDailyReport", "createTripping", "createConsumption",
  "createSupplyPosition", "exportBackupPage", "getRecords", "markNotificationRead"
];

const adminActions = new Set([...admin.matchAll(/body\\.action\\s*===\\s*["']([^"']+)["']/g)].map(m => m[1]));
const recordActions = new Set([...records.matchAll(/case\\s+["']([^"']+)["']/g)].map(m => m[1]));
const frontendActions = new Set([...app.matchAll(/["'](getDashboardData|updateHouse|setHouseActive|updateFeeder|setFeederActive|createHouse|createFeeder|createStaff|createBreakdown|createShutdown|resolveBreakdown|resolveShutdown|updateRecord|createDailyReport|createTripping|createConsumption|createSupplyPosition|exportBackupPage|getRecords|markNotificationRead)["']/g)].map(m => m[1]));

const missingAdmin = expectedAdmin.filter(x => !adminActions.has(x));
const missingRecords = expectedRecords.filter(x => !recordActions.has(x));
const missingFrontend = [...expectedAdmin, ...expectedRecords].filter(x => !frontendActions.has(x));
for (const [label, missing] of [["admin backend", missingAdmin], ["records backend", missingRecords], ["frontend", missingFrontend]]) {
  if (missing.length) throw new Error(label + " missing actions: " + missing.join(", "));
}
for (const route of ["login", "admin", "records"]) {
  if (!app.includes(`bskFunctionUrl("${route}")`)) throw new Error("Frontend route missing: " + route);
  if (!functionsIndex.includes(`export const ${route} =`)) throw new Error("Firebase HTTPS export missing: " + route);
}
if (!(html.indexOf("/bsk-config.js") < html.indexOf('/app.js'))) {
  throw new Error("Runtime config must load before app.js");
}
for (const collection of ["breakdowns", "shutdowns", "trippings", "consumption_readings", "supply_positions", "daily_reports", "feeder_status", "notifications", "entry_history"]) {
  if (!records.includes(`"${collection}"`)) throw new Error("Records collection missing: " + collection);
}
console.log("BSK API contract OK: " + expectedAdmin.length + " admin actions, " + expectedRecords.length + " records actions, 3 API routes, 9 operational collections.");
