import { afterEach, beforeEach, expect, test } from "vitest";
import { startTestServer } from "./helpers.js";

let api;

beforeEach(async () => {
  api = await startTestServer();
});

afterEach(async () => {
  await api.close();
});

test("GET /health reports ok with uptime", async () => {
  const res = await fetch(`${api.baseUrl}/health`);
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.uptimeSeconds).toBeTypeOf("number");
  expect(new Date(body.startedAt).getTime()).not.toBeNaN();
});

test("unknown routes return 404", async () => {
  const res = await fetch(`${api.baseUrl}/nope`);
  expect(res.status).toBe(404);

  const body = await res.json();
  expect(body.error).toBe("not_found");
});
