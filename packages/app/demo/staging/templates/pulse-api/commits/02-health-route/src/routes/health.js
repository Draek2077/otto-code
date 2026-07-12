import { sendJson } from "../http.js";

const startedAt = Date.now();

/** GET /health — liveness snapshot for load balancers and dashboards. */
export function handleHealth(req, res) {
  sendJson(res, 200, {
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: new Date(startedAt).toISOString(),
  });
}
