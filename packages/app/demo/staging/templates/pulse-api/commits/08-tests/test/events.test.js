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

test("POST /events buffers the event", async () => {
  const res = await postEvent({ name: "deploy.finished", tags: { env: "staging" } });
  expect(res.status).toBe(202);

  const body = await res.json();
  expect(body).toEqual({ accepted: true, buffered: 1 });
});

test("GET /events/recent returns newest first", async () => {
  await postEvent({ name: "first" });
  await postEvent({ name: "second" });

  const res = await fetch(`${api.baseUrl}/events/recent?limit=10`);
  const { events } = await res.json();
  expect(events.map((event) => event.name)).toEqual(["second", "first"]);
});
