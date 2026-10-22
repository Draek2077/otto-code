import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { createOpenAiProvider } from "./provider.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});

it.each([
  { transport: "http", preapproved: true },
  { transport: "http", preapproved: false },
  { transport: "stdio", preapproved: true },
  { transport: "stdio", preapproved: false },
])(
  "integrates daemon-injected $transport MCP tools with exact preapproval=$preapproved",
  async ({ transport, preapproved }) => {
    let calls = 0;
    const prompts: Array<{
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ function: { name: string; description: string } }>;
    }> = [];
    const server = createServer(async (request, response) => {
      if (request.method === "DELETE") {
        response.writeHead(204);
        response.end();
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      if (request.url === "/mcp") {
        if (input.method === "notifications/initialized") {
          response.writeHead(202);
          response.end();
          return;
        }
        response.setHeader("content-type", "application/json");
        let result: unknown;
        if (input.method === "initialize")
          result = {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
            instructions: "Use only this project's scope.",
          };
        else if (input.method === "tools/list")
          result = {
            tools: [
              {
                name: "project.inspect",
                description: "Inspect the current project only.",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          };
        else {
          calls += 1;
          result = { content: [{ type: "text", text: "Project proof" }] };
        }
        response.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
        return;
      }
      prompts.push(input);
      const afterTool = input.messages.some((message: { role: string }) => message.role === "tool");
      const name = input.tools.find((tool: { function: { name: string } }) =>
        tool.function.name.startsWith("mcp_"),
      ).function.name;
      response.setHeader("content-type", "text/event-stream");
      const delta = afterTool
        ? { content: "Inspected." }
        : {
            tool_calls: [
              { index: 0, id: "mcp-1", type: "function", function: { name, arguments: "{}" } },
            ],
          };
      response.end(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: afterTool ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
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
    const base = `http://127.0.0.1:${address.port}`;
    const provider = createOpenAiProvider(async () => ({
      baseUrl: `${base}/v1`,
      model: "fixture",
      apiKeyEnv: "OPENAI_API_KEY",
      timeoutMs: 5000,
      maxToolRounds: 4,
    }));
    const connection = await provider.connect({
      versions: [1],
      capabilities: ["prompt.message", "permission", "permission.tool_policy"],
    });
    cleanup.push(() => connection.close());
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send({
      type: "session.open",
      requestId: "open",
      sessionId: "one",
      history: "skip",
      config: {
        cwd: process.cwd(),
        env: {},
        model: "fixture",
        settings: {},
        persist: false,
        mcpServers: {
          "otto-host":
            transport === "http"
              ? { type: "http", url: `${base}/mcp` }
              : {
                  type: "stdio",
                  command: process.execPath,
                  args: [
                    "--input-type=module",
                    "-e",
                    `
            import {createInterface} from 'node:readline';
            const lines=createInterface({input:process.stdin});
            lines.on('line',async line=>{
              const response=await fetch(${JSON.stringify(`${base}/mcp`)},{method:'POST',body:line});
              if(response.status===200)process.stdout.write(await response.text()+'\\n');
            });
            lines.on('close',()=>process.exit(0));
          `,
                  ],
                },
        },
        toolPolicy: {
          preapproved: [
            { server: "otto-host", tool: preapproved ? "project.inspect" : "project.other" },
          ],
        },
      },
    });
    await expect.poll(() => events.some((event) => event.type === "session.ready")).toBe(true);
    await connection.send({
      type: "session.prompt",
      sessionId: "one",
      prompt: {
        clientMessageId: "hello",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "Inspect the project" }] },
      },
    });
    if (!preapproved) {
      await expect
        .poll(() => events.find((event) => event.type === "session.permission"))
        .toBeDefined();
      expect(calls).toBe(0);
      const permission = events.find((event) => event.type === "session.permission");
      if (permission?.type !== "session.permission") throw Error("Missing permission");
      await connection.send({
        type: "session.permission",
        sessionId: "one",
        permissionId: permission.request.id,
        response: { behavior: "allow" },
      });
    }
    await expect
      .poll(() =>
        events.find((event) => event.type === "session.turn" && event.state === "completed"),
      )
      .toBeDefined();
    expect(calls).toBe(1);
    expect(events.filter((event) => event.type === "session.permission")).toHaveLength(
      preapproved ? 0 : 1,
    );
    expect(prompts[0]?.messages[0]).toEqual({
      role: "system",
      content: "[otto-host]\nUse only this project's scope.",
    });
    expect(
      prompts[0]?.tools.find((tool) => tool.function.name.startsWith("mcp_"))?.function.description,
    ).toContain("Inspect the current project only.");
    expect(prompts[1]?.messages).toContainEqual({
      role: "tool",
      tool_call_id: "mcp-1",
      content: "Project proof",
    });
  },
);
