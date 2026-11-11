import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const adminSetupKey = defineSecret("ADMIN_SETUP_KEY");
import loginHandler from "./handlers/login.mjs";
import adminHandler from "./handlers/admin.mjs";
import createAdminHandler from "./handlers/create-admin.mjs";
import recordsHandler from "./handlers/records.mjs";

// Adapt the existing, already validated Netlify-style handlers to Firebase
// HTTPS Functions without changing their request bodies, response bodies,
// authorization checks, or Firestore document formats.
function adaptRequest(req) {
  return {
    method: req.method,
    headers: {
      get(name) {
        return req.get(name) || "";
      }
    },
    async json() {
      if (req.body && typeof req.body === "object") return req.body;
      if (typeof req.body === "string") return JSON.parse(req.body);
      if (req.rawBody?.length) return JSON.parse(req.rawBody.toString("utf8"));
      return {};
    }
  };
}

function expose(handler, extraOptions = {}) {
  return onRequest(
    { region: "asia-south1", cors: true, maxInstances: 10, ...extraOptions },
    async (req, res) => {
      try {
        const result = await handler(adaptRequest(req));
        const contentType = result.headers?.get("content-type") || "application/json; charset=utf-8";
        res.status(result.status || 200).set("Content-Type", contentType);
        res.send(await result.text());
      } catch (error) {
        console.error("BSK HTTPS adapter error:", error);
        res.status(500).json({ error: "Server error. Please try again." });
      }
    }
  );
}

export const login = expose(loginHandler);
export const admin = expose(adminHandler);
export const createAdmin = expose(createAdminHandler, { secrets: [adminSetupKey] });
export const records = expose(recordsHandler);
