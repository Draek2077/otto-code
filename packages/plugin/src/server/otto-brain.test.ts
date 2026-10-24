/** Synthetic HTTP owner and scratch files only. No native runtime, model or installed data. */
import { createServer } from "node:http";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import type { ProviderEvent, ProviderConnection } from "./provider.js";
import { createBrainProvider } from "./otto-brain.js";
import { SessionArchive } from "../otto/openai/server/session-store.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});
function home() {
  const parent = fileURLToPath(new URL("../../../../.tmp/", import.meta.url));
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, "brain-provider-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function frame(delta: unknown, finish: string) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`;
}
async function owner(root: string) {
  const summaryLimits: number[] = [];
  const state = {
    revision: 0,
    requests: 0,
    hold: false,
    disconnected: false,
    prompts: 0,
    summaryLimits,
  };
  const server = createServer(async (request, response) => {
    state.requests++;
    if (request.url === "/health") {
      response.end('{"status":"ok"}');
      return;
    }
    if (request.url === "/__host/status") {
      response.end(
        JSON.stringify({
          instanceId: "owner",
          libraryRevision: state.revision,
          ownerSettingsRevision: "config",
        }),
      );
      return;
    }
    if (request.url === "/v1/models") {
      response.end(
        JSON.stringify({
          data: [
            {
              id: "model",
              name: "Owner model",
              context_length: 32768,
              reasoning: { supported_efforts: [] },
              architecture: { input_modalities: ["text"] },
            },
          ],
        }),
      );
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = z
      .object({
        messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })),
        max_tokens: z.number().optional(),
      })
      .parse(JSON.parse(body));
    state.prompts++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (
      typeof input.messages[0]?.content === "string" &&
      input.messages[0].content.startsWith("Summarize the supplied")
    ) {
      if (input.max_tokens !== undefined) state.summaryLimits.push(input.max_tokens);
      response.end(frame({ content: "Historical Brain context." }, "stop"));
      return;
    }
    if (state.hold) {
      response.once("close", () => {
        state.disconnected = true;
      });
      response.write(": waiting\n\n");
      return;
    }
    if (!input.messages.some((message) => message.role === "tool")) {
      response.end(
        frame(
          {
            tool_calls: [
              {
                index: 0,
                id: "write",
                type: "function",
                function: {
                  name: "otto_write_file",
                  arguments: JSON.stringify({ path: "proof.txt", content: "Brain tool proof" }),
                },
              },
            ],
          },
          "tool_calls",
        ),
      );
      return;
    }
    response.end(frame({ content: "Completed by Brain" }, "stop"));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address missing");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  writeFileSync(
    path.join(root, "otto-config.json"),
    JSON.stringify({
      brain: {
        enabled: true,
        mode: "remote",
        remote: { host: "127.0.0.1", port: address.port, secure: false },
      },
      untouched: { value: true },
    }),
  );
  return state;
}
async function connect(provider: ReturnType<typeof createBrainProvider>) {
  const connection = await provider.connect({
    versions: [1],
    capabilities: [
      "prompt.message",
      "prompt.command",
      "session.persistence",
      "permission",
      "permission.tool_policy",
    ],
  });
  cleanup.push(() => connection.close());
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  return { connection, events };
}
function prompt(connection: ProviderConnection, id: string, text: string) {
  return connection.send({
    type: "session.prompt",
    sessionId: id,
    prompt: {
      clientMessageId: text,
      delivery: "auto",
      input: { type: "message", content: [{ type: "text", text }] },
    },
  });
}
function config(root: string) {
  return {
    cwd: root,
    env: {},
    mcpServers: {},
    model: "model",
    settings: { auto_compact: "off" },
    persist: true,
  };
}
function archived(root: string, events: ProviderEvent[]) {
  const saved = events.findLast((event) => event.type === "session.persistence");
  if (!saved || saved.type !== "session.persistence")
    throw new Error("Fixture archive pointer missing");
  return new SessionArchive(path.join(root, "otto-brain", "agent-sessions"), saved.persistence)
    .restored;
}

test("Brain registration and disabled availability are inert and preserve an empty owning home", async () => {
  const root = home();
  const provider = createBrainProvider(root);
  expect(provider).toMatchObject({ id: "otto-brain", label: "Otto Brain" });
  expect(readdirSync(root)).toEqual([]);
  expect(await provider.status?.({})).toMatchObject({ available: false });
  expect(readdirSync(root)).toEqual([]);
});

test("Brain discovers real owner metadata, invalidates catalog by owner revision and keeps native permission/history behavior", async () => {
  const root = home();
  const state = await owner(root);
  const original = readFileSync(path.join(root, "otto-config.json"), "utf8");
  const provider = createBrainProvider(root);
  expect(await provider.status?.({})).toEqual({ available: true });
  const key = await provider.getCatalogCacheKey?.({ scope: "global" });
  state.revision++;
  expect(await provider.getCatalogCacheKey?.({ scope: "global" })).not.toBe(key);
  const first = await connect(provider);
  await first.connection.send({ type: "catalog", requestId: "catalog" });
  await expect
    .poll(() => first.events.find((event) => event.type === "catalog"))
    .toMatchObject({
      catalog: {
        models: [
          { id: "model", label: "Owner model", contextWindowMaxTokens: 32768, thinkingOptions: [] },
        ],
      },
    });
  await first.connection.send({
    type: "session.open",
    requestId: "open",
    sessionId: "first",
    history: "skip",
    config: config(root),
  });
  await expect.poll(() => first.events.some((event) => event.type === "session.ready")).toBe(true);
  await prompt(first.connection, "first", "Write proof");
  await expect
    .poll(() => first.events.find((event) => event.type === "session.permission"))
    .toBeDefined();
  expect(existsSync(path.join(root, "proof.txt"))).toBe(false);
  const permission = first.events.find((event) => event.type === "session.permission");
  if (!permission || permission.type !== "session.permission")
    throw new Error("Fixture permission missing");
  await first.connection.send({
    type: "session.permission",
    sessionId: "first",
    permissionId: permission.request.id,
    response: { behavior: "allow" },
  });
  await expect
    .poll(() =>
      first.events.find((event) => event.type === "session.turn" && event.state === "completed"),
    )
    .toBeDefined();
  expect(readFileSync(path.join(root, "proof.txt"), "utf8")).toBe("Brain tool proof");
  const saved = first.events.findLast((event) => event.type === "session.persistence");
  if (!saved || saved.type !== "session.persistence")
    throw new Error("Fixture persistence missing");
  await first.connection.close();
  const resumed = await connect(provider);
  await resumed.connection.send({
    type: "session.open",
    requestId: "resume",
    sessionId: "resumed",
    history: "replay",
    config: config(root),
    persistence: saved.persistence,
  });
  await expect
    .poll(() => resumed.events.some((event) => event.type === "session.ready"))
    .toBe(true);
  await prompt(resumed.connection, "resumed", "Continue");
  await expect
    .poll(() =>
      resumed.events.find((event) => event.type === "session.turn" && event.state === "completed"),
    )
    .toBeDefined();
  expect(state.prompts).toBe(3);
  await resumed.connection.send({
    type: "session.prompt",
    sessionId: "resumed",
    prompt: {
      clientMessageId: "compact",
      delivery: "auto",
      input: { type: "command", name: "compact", arguments: "Keep the tool proof" },
    },
  });
  await expect
    .poll(
      () =>
        resumed.events.filter(
          (event) => event.type === "session.turn" && event.state === "completed",
        ).length,
    )
    .toBe(2);
  expect(state.summaryLimits).toEqual([4000]);
  expect(archived(root, resumed.events)).toMatchObject({
    data: {
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "tool", tool_call_id: "write" }),
      ]),
      context: { compaction: { summary: "Historical Brain context." } },
    },
  });
  expect(readFileSync(path.join(root, "otto-config.json"), "utf8")).toBe(original);
});

test.each(["otto-brain", "local-ai"])(
  "preserved %s history imports through its original Brain identity without altering source settings",
  async (id) => {
    const root = home();
    await owner(root);
    const filename = path.join(root, "otto-config.json");
    const original = JSON.parse(readFileSync(filename, "utf8"));
    original.agents = {
      providers: { "local-ai": { extends: "otto-brain", label: "My local AI", model: "model" } },
    };
    const preserved = JSON.stringify(original);
    writeFileSync(filename, preserved);
    writeFileSync(path.join(root, "config.json.otto-0.9.bak"), preserved);
    const provider = createBrainProvider(root, { id, label: "Brain alias" });
    const live = await connect(provider);
    await live.connection.send({
      type: "session.open",
      requestId: "legacy",
      sessionId: "legacy",
      history: "replay",
      config: config(root),
      persistence: {
        version: 1,
        data: {
          format: "otto-openai-0.9-handle-v1",
          handle: {
            provider: id,
            sessionId: "old-native",
            metadata: {
              model: "model",
              messages: [
                { role: "user", content: "Original objective", messageId: "old-user" },
                { role: "assistant", content: "Historical answer" },
              ],
            },
          },
        },
      },
    });
    await expect.poll(() => live.events.some((event) => event.type === "session.ready")).toBe(true);
    expect(archived(root, live.events)).toMatchObject({
      data: {
        legacyOrigin: { provider: id, sessionId: "old-native" },
        messages: [
          { role: "user", content: "Original objective" },
          { role: "assistant", content: "Historical answer" },
        ],
      },
    });
    expect(readFileSync(filename, "utf8")).toBe(preserved);
    expect(readFileSync(path.join(root, "config.json.otto-0.9.bak"), "utf8")).toBe(preserved);
  },
);

test("interrupting a Brain turn cancels its actual owner stream without stopping the host", async () => {
  const root = home();
  const state = await owner(root);
  const provider = createBrainProvider(root);
  const live = await connect(provider);
  await live.connection.send({
    type: "session.open",
    requestId: "open",
    sessionId: "live",
    history: "skip",
    config: config(root),
  });
  await expect.poll(() => live.events.some((event) => event.type === "session.ready")).toBe(true);
  state.hold = true;
  await prompt(live.connection, "live", "Wait");
  await expect.poll(() => state.prompts).toBe(1);
  await live.connection.send({
    type: "session.interrupt",
    sessionId: "live",
    requestId: "interrupt",
  });
  await expect
    .poll(() =>
      live.events.find((event) => event.type === "session.turn" && event.state === "canceled"),
    )
    .toBeDefined();
  await expect.poll(() => state.disconnected).toBe(true);
  expect(await provider.status?.({})).toEqual({ available: true });
});
