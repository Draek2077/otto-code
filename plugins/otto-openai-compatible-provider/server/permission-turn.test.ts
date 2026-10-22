import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { createOpenAiProvider } from "./provider.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});

it.each(["allow", "deny", "interrupt"] as const)(
  "honors %s before writing a file and continuing the tool loop",
  async (decision) => {
    const scratch = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
    await mkdir(scratch, { recursive: true });
    const cwd = await mkdtemp(path.join(scratch, "openai-permission-"));
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));
    const output = path.join(cwd, "proof.txt");
    const toolCatalogs: unknown[][] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body) as { messages: Array<{ role: string }>; tools: unknown[] };
      toolCatalogs.push(input.tools ?? []);
      const afterTool = input.messages.some((message) => message.role === "tool");
      const choice = afterTool
        ? { index: 0, delta: { content: "The file is saved." }, finish_reason: "stop" }
        : {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "write-1",
                  type: "function",
                  function: {
                    name: "otto_write_file",
                    arguments: JSON.stringify({ path: "proof.txt", content: "approved write" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          };
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ choices: [choice], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanup.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Missing endpoint");
    const provider = createOpenAiProvider(async () => ({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "local-model",
      apiKeyEnv: "OPENAI_API_KEY",
      maxToolRounds: 4,
      timeoutMs: 5000,
    }));
    const connection = await provider.connect({
      versions: [1],
      capabilities: [
        "prompt.message",
        "session.persistence",
        "permission",
        "permission.tool_policy",
      ],
    });
    cleanup.push(() => connection.close());
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "one",
      history: "skip",
      config: { cwd, env: {}, mcpServers: {}, model: "local-model", settings: {}, persist: true },
    });
    await expect.poll(() => events.some((event) => event.type === "session.ready")).toBe(true);
    await connection.send({
      type: "session.prompt",
      sessionId: "one",
      prompt: {
        clientMessageId: "prompt-1",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "Write proof.txt" }] },
      },
    });
    await expect
      .poll(() => events.find((event) => event.type === "session.permission"))
      .toMatchObject({ request: { kind: "tool", detail: { type: "write", filePath: output } } });
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const permission = events.find((event) => event.type === "session.permission");
    if (!permission || permission.type !== "session.permission") throw Error("Missing permission");
    if (decision === "interrupt") {
      await connection.send({ type: "session.interrupt", sessionId: "one", requestId: "stop" });
    } else
      await connection.send({
        type: "session.permission",
        sessionId: "one",
        permissionId: permission.request.id,
        response: { behavior: decision },
      });
    await expect
      .poll(() =>
        events.find(
          (event) =>
            event.type === "session.turn" &&
            event.state === (decision === "interrupt" ? "canceled" : "completed"),
        ),
      )
      .toBeDefined();
    if (decision === "allow") expect(await readFile(output, "utf8")).toBe("approved write");
    else await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(toolCatalogs.every((tools) => tools.length > 0)).toBe(true);
    expect(events.findLast((event) => event.type === "session.usage")).toMatchObject({
      usage: {
        inputTokens: decision === "interrupt" ? 10 : 20,
        outputTokens: decision === "interrupt" ? 2 : 4,
      },
    });
    expect(
      events.findLast((event) => event.type === "timeline.item" && event.item.type === "tool_call"),
    ).toMatchObject({
      item: { status: { allow: "completed", deny: "failed", interrupt: "canceled" }[decision] },
    });
    expect(
      events.filter((event) => event.type === "session.turn" && event.state !== "started"),
    ).toHaveLength(1);
    const persisted = events.findLast((event) => event.type === "session.persistence");
    expect(persisted).toMatchObject({
      persistence: {
        data: {
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "tool", tool_call_id: "write-1" }),
          ]),
        },
      },
    });
  },
);
