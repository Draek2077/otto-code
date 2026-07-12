import { afterEach, beforeEach, expect, test } from "vitest";
import { startTestServer } from "./helpers.js";

let api;

beforeEach(async () => {
  api = await startTestServer();
});

afterEach(async () => {
  await api.close();
});

async function postEvent(body) {
  return fetch(`${api.baseUrl}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("numeric events surface as gauges", async () => {
  await postEvent({ name: "cpu.load", value: 0.42 });
  await postEvent({ name: "cpu.load", value: 0.61 });

  const res = await fetch(`${api.baseUrl}/metrics`);
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.gauges["cpu.load"].value).toBe(0.61);
  expect(body.eventsBuffered).toBe(2);
});

test("metrics start empty", async () => {
  const res = await fetch(`${api.baseUrl}/metrics`);
  const body = await res.json();
  expect(body).toEqual({ gauges: {}, eventsBuffered: 0 });
});
