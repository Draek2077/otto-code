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
  sendJson(res, 202, { accepted: true, buffered: store.size });
}
