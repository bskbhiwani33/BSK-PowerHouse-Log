import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

import loginHandler from "./handlers/login.mjs";
import adminHandler from "./handlers/admin.mjs";
import createAdminHandler from "./handlers/create-admin.mjs";
import recordsHandler from "./handlers/records.mjs";

const ADMIN_SETUP_KEY = defineSecret("ADMIN_SETUP_KEY");

function toWebRequest(req) {
  return {
    method: req.method,
    headers: {
      get(name) {
        const value = req.get?.(name) ?? req.headers?.[String(name).toLowerCase()];
        return Array.isArray(value) ? value[0] : (value ?? null);
      }
    },
    async json() {
      if (req.body !== undefined) {
        if (typeof req.body === "string") return JSON.parse(req.body);
        return req.body;
      }
      if (req.rawBody) return JSON.parse(req.rawBody.toString("utf8"));
      return {};
    }
  };
}

function expose(handler) {
  return async (req, res) => {
    try {
      const result = await handler(toWebRequest(req));
      res.status(result.status || 200);
      result.headers?.forEach((value, key) => res.set(key, value));
      res.send(await result.text());
    } catch (error) {
      console.error("BSK HTTP adapter error", error);
      res.status(500).json({ error: "Server error. Please try again." });
    }
  };
}

const common = {
  region: "asia-south1",
  memory: "256MiB",
  timeoutSeconds: 60,
  cors: true,
  maxInstances: 20
};

export const login = onRequest(common, expose(loginHandler));
export const admin = onRequest(common, expose(adminHandler));
export const records = onRequest(common, expose(recordsHandler));

// One-time bootstrap endpoint remains disabled until ADMIN_SETUP_KEY is set.
// Existing Admin accounts do not need to be recreated during migration.
export const createAdmin = onRequest(
  { ...common, secrets: [ADMIN_SETUP_KEY] },
  expose(createAdminHandler)
);
