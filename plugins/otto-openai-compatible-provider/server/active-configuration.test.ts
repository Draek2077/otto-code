import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { ProviderEvent, ProviderSessionConfig } from "@getpaseo/plugin/server/provider";
import { OpenAiSession } from "./session.js";
import type { ChatMessage } from "./completions.js";

it("keeps an admitted turn's permissions and model, then restores desired settings and opaque reasoning", async () => {
  const root = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  const cwd = await mkdtemp(path.join(root, "provider-active-config-"));
  const requests: Array<{
    model: string;
    messages: ChatMessage[];
    max_tokens?: number;
    prompt_cache_key?: string;
  }> = [];
  const opaque = [{ type: "reasoning.encrypted", index: 7, data: "unchanged-signature" }];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const afterTool = input.messages.at(-1).role === "tool";
    const delta = afterTool
      ? { content: "Done." }
      : {
          reasoning_details: opaque,
          reasoning_content: "Checking file permissions.",
          tool_calls: [
            {
              index: 0,
              id: `write-${requests.length}`,
              type: "function",
              function: {
                name: "otto_write_file",
                arguments: JSON.stringify({ path: "proof.txt", content: "next turn" }),
              },
            },
          ],
        };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: afterTool ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const settings = {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "one",
    apiKeyEnv: "OPENAI_API_KEY",
    maxToolRounds: 4,
    timeoutMs: 5000,
  };
  const config: ProviderSessionConfig = {
    cwd,
    env: {},
    model: "one",
    mcpServers: {},
    settings: {},
    persist: true,
  };
  const events: ProviderEvent[] = [];
  const models = [
    { id: "one", label: "One" },
    { id: "two", label: "Two" },
  ];
  let session = new OpenAiSession(
    "first",
    config,
    settings,
    (event) => events.push(event),
    undefined,
    true,
    undefined,
    models,
  );
  const prompt = (id: string) =>
    session.start({
      clientMessageId: id,
      delivery: "auto",
      input: { type: "message", content: [{ type: "text", text: "Write proof.txt" }] },
    });
  try {
    prompt("first");
    // Configure synchronously, before the admitted turn's microtask starts.
    session.configure({
      mode: "bypassPermissions",
      model: "two",
      settings: { output_limit: "4096" },
    });
    await expect.poll(() => events.some((event) => event.type === "session.permission")).toBe(true);
    expect(requests[0]).toMatchObject({ model: "one" });
    expect(requests[0]!.max_tokens).toBeUndefined();
    await expect(readFile(path.join(cwd, "proof.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    const permission = events.find((event) => event.type === "session.permission");
    if (permission?.type !== "session.permission") throw Error("Missing permission");
    session.configure({ mode: "bypassPermissions" });
    expect(events.filter((event) => event.type === "session.permission_resolved")).toHaveLength(0);
    session.respond(permission.request.id, { behavior: "deny" });
    await expect.poll(() => session.running).toBe(false);
    expect(requests[1]).toMatchObject({ model: "one" });
    expect(requests[1]!.messages[1]).toMatchObject({
      reasoning_details: opaque,
      reasoning_content: "Checking file permissions.",
    });
    const persisted = events.findLast((event) => event.type === "session.persistence");
    if (persisted?.type !== "session.persistence") throw Error("Missing persistence");
    const cacheKey = requests[0]!.prompt_cache_key;
    const firstHistory = structuredClone(session.messages);
    await session.close();
    session = new OpenAiSession(
      "resumed",
      { ...config, model: undefined },
      settings,
      (event) => events.push(event),
      persisted.persistence,
      true,
      undefined,
      models,
    );
    prompt("second");
    await expect.poll(() => session.running).toBe(false);
    expect(await readFile(path.join(cwd, "proof.txt"), "utf8")).toBe("next turn");
    expect(events.filter((event) => event.type === "session.permission")).toHaveLength(1);
    expect(requests[2]).toMatchObject({
      model: "two",
      max_tokens: 4096,
      prompt_cache_key: cacheKey,
    });
    expect(requests[2]!.messages[1]).toMatchObject({ reasoning_details: opaque });
    const target = events.findLast(
      (event) =>
        event.type === "timeline.item" &&
        event.sessionId === "resumed" &&
        event.item.type === "user_message",
    );
    if (target?.type !== "timeline.item") throw Error("Missing rewind target");
    const requestCount = requests.length;
    session.revert(target.item.revertToken);
    expect(session.messages).toEqual(firstHistory);
    expect(await readFile(path.join(cwd, "proof.txt"), "utf8")).toBe("next turn");
    expect(requests).toHaveLength(requestCount);
    const rewound = events.findLast((event) => event.type === "session.persistence");
    if (rewound?.type !== "session.persistence") throw Error("Missing rewound persistence");
    await session.close();
    session = new OpenAiSession(
      "rewound",
      { ...config, model: undefined },
      settings,
      (event) => events.push(event),
      rewound.persistence,
      true,
      undefined,
      models,
    );
    expect(session.messages).toEqual(firstHistory);
  } finally {
    await session.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  }
});
