import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { createOpenAiProvider } from "./provider.js";

it("configures model/reasoning/output limits through the public contract and enforces Read only against an unadvertised write", async () => {
  const root = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  const cwd = await mkdtemp(path.join(root, "provider-configuration-"));
  const requests: Array<{
    model: string;
    reasoning_effort: string;
    max_completion_tokens?: number;
    max_tokens?: number;
    tools: Array<{ function: { name: string } }>;
  }> = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          data: [
            { id: "one", reasoning_efforts: ["low", "high"] },
            {
              id: "two",
              reasoning_efforts: ["low", "high"],
              supported_parameters: ["tools", "reasoning_effort", "max_completion_tokens"],
            },
          ],
        }),
      );
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const afterTool = input.messages.at(-1)?.role === "tool";
    const delta = afterTool
      ? { content: "Done." }
      : {
          tool_calls: [
            {
              index: 0,
              id: `write-${requests.length}`,
              type: "function",
              function: {
                name: "otto_write_file",
                arguments: JSON.stringify({ path: "proof.txt", content: "configured write" }),
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
  const provider = createOpenAiProvider(async () => ({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "",
    apiKeyEnv: "OPENAI_API_KEY",
    maxToolRounds: 3,
    timeoutMs: 5000,
  }));
  const connection = await provider.connect({
    versions: [1],
    capabilities: [
      "prompt.message",
      "session.configure",
      "session.persistence",
      "permission",
      "permission.tool_policy",
    ],
  });
  try {
    expect(connection.capabilities).toContain("session.configure");
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "one",
      history: "skip",
      config: {
        cwd,
        env: {},
        model: "one",
        mode: "plan",
        settings: {},
        mcpServers: {},
        persist: true,
      },
    });
    await expect.poll(() => events.some((event) => event.type === "session.ready")).toBe(true);
    await connection.send({
      type: "session.configure",
      requestId: "configure-one",
      sessionId: "one",
      changes: { thinkingOption: "low", settings: { output_limit: "4096" } },
    });
    await expect
      .poll(() =>
        events.some(
          (event) => event.type === "request.completed" && event.requestId === "configure-one",
        ),
      )
      .toBe(true);
    const prompt = (id: string) =>
      connection.send({
        type: "session.prompt",
        sessionId: "one",
        prompt: {
          clientMessageId: id,
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "Write proof.txt" }] },
        },
      });
    await prompt("first");
    await expect
      .poll(
        () =>
          events.filter((event) => event.type === "session.turn" && event.state === "completed")
            .length,
      )
      .toBe(1);
    expect(requests[0]!.tools.map((tool) => tool.function.name)).toEqual(["otto_read_file"]);
    await expect(readFile(path.join(cwd, "proof.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await connection.send({
      type: "session.configure",
      requestId: "configure-two",
      sessionId: "one",
      changes: { model: "two", mode: "acceptEdits", thinkingOption: "high" },
    });
    await expect
      .poll(() =>
        events.some(
          (event) => event.type === "request.completed" && event.requestId === "configure-two",
        ),
      )
      .toBe(true);
    await prompt("second");
    await expect
      .poll(
        () =>
          events.filter((event) => event.type === "session.turn" && event.state === "completed")
            .length,
      )
      .toBe(2);
    expect(await readFile(path.join(cwd, "proof.txt"), "utf8")).toBe("configured write");
    expect(requests[2]).toMatchObject({
      model: "two",
      reasoning_effort: "high",
      max_completion_tokens: 4096,
    });
    expect(requests[2]!.max_tokens).toBeUndefined();
    expect(events.filter((event) => event.type === "session.permission")).toHaveLength(0);
  } finally {
    await connection.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  }
});
