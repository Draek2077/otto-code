import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { ProviderEvent, ProviderPersistence } from "@getpaseo/plugin/server/provider";
import { createOpenAiProvider } from "./provider.js";
import { providerSettings } from "../shared/settings.js";

test("large archived conversations keep opaque handles small and recover authoritative host history", async () => {
  const root = await mkdtemp(
    path.join(fileURLToPath(new URL("../../../.tmp/", import.meta.url)), "otto-session-store-"),
  );
  const directory = path.join(root, "sessions");
  const text = "retained project history ".repeat(24000);
  const original: ProviderPersistence = {
    version: 1,
    data: {
      format: "otto-openai-compatible-v1",
      endpoint: "http://localhost:1234/v1/chat/completions",
      messages: [
        { role: "user", content: text },
        { role: "assistant", content: "Archived answer." },
      ],
      timeline: [
        { id: "original-user", type: "user_message", text },
        { id: "original-answer", type: "assistant_message", text: "Archived answer." },
      ],
      context: { turns: [{ id: "original-user", offset: 0 }] },
    },
  };
  const open = async (persistence: ProviderPersistence) => {
    const provider = createOpenAiProvider(
      async () =>
        providerSettings.schema.parse({ baseUrl: "http://localhost:1234/v1", model: "fixture" }),
      { sessionDirectory: directory },
    );
    const connection = await provider.connect({
      versions: [1],
      capabilities: [
        "prompt.message",
        "session.persistence",
        "session.configure",
        "session.revert.conversation",
      ],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "fixture",
      history: "replay",
      persistence,
      config: { cwd: root, env: {}, mcpServers: {}, settings: {}, persist: true, model: "fixture" },
    });
    try {
      await expect
        .poll(() =>
          events.find(
            (event) => event.type === "session.opened" || event.type === "request.failed",
          ),
        )
        .toMatchObject({ type: "session.opened" });
    } catch (error) {
      await connection.close();
      throw error;
    }
    return { connection, events };
  };
  const first = await open(original);
  let pointer: ProviderPersistence;
  try {
    await first.connection.send({
      type: "session.configure",
      requestId: "configure",
      sessionId: "fixture",
      changes: { settings: { auto_compact: "off" } },
    });
    await expect
      .poll(() => first.events.filter((event) => event.type === "session.config").length)
      .toBe(2);
    const checkpoint = first.events.findLast((event) => event.type === "session.persistence");
    if (checkpoint?.type !== "session.persistence") throw Error("Missing checkpoint");
    const bytes = Buffer.byteLength(JSON.stringify(checkpoint.persistence));
    expect(
      bytes,
      `Opaque persistence is ${bytes} bytes for a ${text.length}-character archive`,
    ).toBeLessThan(1024);
    pointer = checkpoint.persistence;
  } finally {
    await first.connection.close();
  }
  const resumed = await open(pointer);
  try {
    expect(resumed.events).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({ id: "original-user", text }),
      }),
    );
    const data = pointer.data as { id: string };
    const file = path.join(directory, `${data.id}.json`);
    expect((await readFile(file, "utf8")).length).toBeGreaterThan(text.length);
    const stale = await open(pointer);
    try {
      await resumed.connection.send({
        type: "session.revert",
        requestId: "rewind",
        scope: "conversation",
        sessionId: "fixture",
        token: { format: "otto-openai-revert-v1", id: "original-user" },
      });
      await expect
        .poll(() =>
          resumed.events.find(
            (event) => event.type === "request.completed" && event.requestId === "rewind",
          ),
        )
        .toMatchObject({ type: "request.completed" });
      const after = await readFile(file, "utf8");
      await stale.connection.send({
        type: "session.configure",
        requestId: "stale",
        sessionId: "fixture",
        changes: { mode: "plan" },
      });
      await expect
        .poll(() =>
          stale.events.find(
            (event) => event.type === "request.failed" && event.requestId === "stale",
          ),
        )
        .toMatchObject({ error: { message: expect.stringContaining("changed") } });
      expect(await readFile(file, "utf8")).toBe(after);
      await writeFile(file, "malformed");
      await expect(open(pointer)).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe("malformed");
    } finally {
      await stale.connection.close();
    }
  } finally {
    await resumed.connection.close();
  }
});

test("a storage conflict fails the turn before tool effects and prevents another model request", async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { access } = await import("node:fs/promises");
  const root = await mkdtemp(
    path.join(fileURLToPath(new URL("../../../.tmp/", import.meta.url)), "otto-session-conflict-"),
  );
  const directory = path.join(root, "sessions");
  let file = "";
  let preserved = "";
  let requests = 0;
  const server = createServer(async (_request, response) => {
    requests += 1;
    const saved = JSON.parse(await readFile(file, "utf8"));
    saved.cacheKey = "changed-by-another-session";
    preserved = JSON.stringify(saved);
    await writeFile(file, preserved);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "write", type: "function", function: { name: "otto_write_file", arguments: JSON.stringify({ path: "must-not-exist.txt", content: "unsafe after storage conflict" }) } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const provider = createOpenAiProvider(
    async () =>
      providerSettings.schema.parse({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "fixture",
      }),
    { sessionDirectory: directory },
  );
  const connection = await provider.connect({
    versions: [1],
    capabilities: ["prompt.message", "permission", "session.persistence"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "conflict",
      history: "skip",
      config: {
        cwd: root,
        env: {},
        mcpServers: {},
        settings: {},
        persist: true,
        model: "fixture",
        mode: "bypassPermissions",
      },
    });
    await expect
      .poll(() => events.find((event) => event.type === "session.ready"))
      .toMatchObject({ type: "session.ready" });
    const pointer = events.find((event) => event.type === "session.persistence");
    if (pointer?.type !== "session.persistence") throw Error("Missing checkpoint");
    file = path.join(directory, `${(pointer.persistence.data as { id: string }).id}.json`);
    const prompt = {
      clientMessageId: "first",
      delivery: "auto" as const,
      input: {
        type: "message" as const,
        content: [{ type: "text" as const, text: "Try a tool." }],
      },
    };
    await connection.send({ type: "session.prompt", sessionId: "conflict", prompt });
    await expect
      .poll(() => events.find((event) => event.type === "session.turn" && event.state === "failed"))
      .toMatchObject({ error: { message: expect.stringContaining("changed") } });
    expect(await readFile(file, "utf8")).toBe(preserved);
    await expect(access(path.join(root, "must-not-exist.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await connection.send({
      type: "session.prompt",
      sessionId: "conflict",
      prompt: { ...prompt, clientMessageId: "second" },
    });
    await expect
      .poll(() =>
        events.find(
          (event) => event.type === "session.prompt_result" && event.clientMessageId === "second",
        ),
      )
      .toMatchObject({ result: { type: "failed" } });
    expect(requests).toBe(1);
  } finally {
    await connection.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
