import { sendJson } from "../http.js";

/** GET /metrics — current gauge values plus buffer occupancy. */
export function handleMetrics(req, res, store) {
  sendJson(res, 200, {
    gauges: store.gaugeSnapshot(),
    eventsBuffered: store.size,
  });
}
