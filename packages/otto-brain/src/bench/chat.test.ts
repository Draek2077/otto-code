import http from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { requestChat } from "./chat.js";

const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function endpoint(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture address");
  return { host: "127.0.0.1", port: address.port };
}

it("posts the supplied trial and preserves completion, tool, timing and archive metadata", async () => {
  let posted: unknown;
  const target = await endpoint(async (request, response) => {
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/v1/chat/completions");
    let body = "";
    for await (const chunk of request) body += chunk;
    posted = JSON.parse(body);
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "done",
              reasoning_content: "reason",
              tool_calls: [{ id: "call", function: { name: "read_file", arguments: "{}" } }],
            },
          },
        ],
        usage: { completion_tokens: 23 },
        timings: { predicted_per_second: 42 },
        fixture: "retained",
      }),
    );
  });
  const result = await requestChat({
    ...target,
    payload: { messages: [{ role: "user", content: "fixture" }] },
  });
  expect(posted).toEqual({ messages: [{ role: "user", content: "fixture" }] });
  expect(result).toMatchObject({
    fixture: "retained",
    usage: { completion_tokens: 23 },
    timings: { predicted_per_second: 42 },
  });
  expect(result.choices?.[0].message?.tool_calls?.[0].id).toBe("call");
});
it("rejects unsuccessful and malformed responses without reflecting their private content", async () => {
  for (const [status, body, expected] of [
    [500, "private-fixture-token", "failed (500)"],
    [200, "private-fixture-token", "invalid JSON"],
    [200, '{"choices":"private-fixture-token"}', "invalid shape"],
  ] as const) {
    const target = await endpoint((_request, response) => {
      response.writeHead(status);
      response.end(body);
    });
    await expect(requestChat({ ...target, payload: {} })).rejects.toThrow(expected);
  }
});
it("bounds streamed response storage before parsing it", async () => {
  const target = await endpoint((_request, response) =>
    response.end(JSON.stringify({ fixture: "x".repeat(1000) })),
  );
  await expect(requestChat({ ...target, payload: {}, maxResponseBytes: 32 })).rejects.toThrow(
    "size limit",
  );
});
it("cancels an in-flight request rather than waiting for a silent model", async () => {
  const controller = new AbortController();
  const target = await endpoint(() => controller.abort(new Error("fixture cancelled")));
  await expect(requestChat({ ...target, payload: {}, signal: controller.signal })).rejects.toThrow(
    "fixture cancelled",
  );
});
it("applies a whole-request deadline to a silent model", async () => {
  const target = await endpoint(() => {});
  await expect(requestChat({ ...target, payload: {}, timeoutMs: 100 })).rejects.toThrow();
});
