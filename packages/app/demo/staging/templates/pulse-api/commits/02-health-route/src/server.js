import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { sendJson } from "./http.js";
import { handleHealth } from "./routes/health.js";

const PORT = Number(process.env.PORT ?? 4600);

/**
 * Build the HTTP server. Exported as a factory so tests can run
 * isolated instances on ephemeral ports.
 */
export function createApp() {
  return createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && pathname === "/health") {
      return handleHealth(req, res);
    }

    sendJson(res, 404, { error: "not_found", path: pathname });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(PORT, () => {
    console.log(`pulse-api listening on http://localhost:${PORT}`);
  });
}
