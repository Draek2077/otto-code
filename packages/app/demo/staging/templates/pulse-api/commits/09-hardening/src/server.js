import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { BadRequestError, sendJson } from "./http.js";
import { EventStore } from "./store.js";
import { handleHealth } from "./routes/health.js";
import { handleIngest, handleRecent } from "./routes/events.js";
import { handleMetrics } from "./routes/metrics.js";

const PORT = Number(process.env.PORT ?? 4600);

/**
 * Build the HTTP server around a store instance. Exported as a factory
 * so tests can run isolated instances on ephemeral ports.
 */
export function createApp(store = new EventStore()) {
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      if (req.method === "GET" && pathname === "/health") {
        return handleHealth(req, res);
      }
      if (req.method === "GET" && pathname === "/metrics") {
        return handleMetrics(req, res, store);
      }
      if (req.method === "POST" && pathname === "/events") {
        return await handleIngest(req, res, store);
      }
      if (req.method === "GET" && pathname === "/events/recent") {
        return handleRecent(req, res, store);
      }
      sendJson(res, 404, { error: "not_found", path: pathname });
    } catch (error) {
      if (error instanceof BadRequestError) {
        return sendJson(res, 400, { error: "bad_request", message: error.message });
      }
      sendJson(res, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(PORT, () => {
    console.log(`pulse-api listening on http://localhost:${PORT}`);
  });
}
