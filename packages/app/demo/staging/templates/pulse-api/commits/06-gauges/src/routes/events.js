import { readJsonBody, sendJson } from "../http.js";

/** POST /events — ingest one telemetry event into the ring buffer. */
export async function handleIngest(req, res, store) {
  const event = await readJsonBody(req);
  const record = {
    name: event.name,
    value: typeof event.value === "number" ? event.value : null,
    tags: event.tags ?? {},
    receivedAt: new Date().toISOString(),
  };
  store.push(record);
  if (record.value !== null) {
    // Numeric events double as gauge updates, e.g. { name: "cpu.load", value: 0.42 }.
    store.recordGauge(record.name, record.value);
  }
  sendJson(res, 202, { accepted: true, buffered: store.size });
}

/** GET /events/recent — newest-first slice of the buffer. */
export function handleRecent(req, res, store) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  sendJson(res, 200, { events: store.recent(limit) });
}
