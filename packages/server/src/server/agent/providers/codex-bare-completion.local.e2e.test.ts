import { expect, test } from "vitest";
import { z } from "zod";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { CodexAppServerAgentClient } from "./codex-app-server-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { findExecutable } from "../../../executable-resolution/executable-resolution.js";

// Real Codex binary, isolated CODEX_HOME, and a local Responses endpoint. No
// provider account or remote model request is involved in this test.
function encodeEvent(event: { type: string }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function assertIntrinsicTools(value: unknown): void {
  const tools = z
    .array(z.object({ name: z.string(), tools: z.unknown().optional() }))
    .parse(value ?? []);
  for (const tool of tools) {
    expect(["functions", "exec", "wait", "request_user_input", "skills", "list", "read"]).toContain(
      tool.name,
    );
    if (tool.tools) assertIntrinsicTools(tool.tools);
  }
}

test.each(["gpt-5.6-luna", "gpt-5.4-mini"])(
  "Codex %s generates metadata without workspace tools, instructions, or persistent history",
  async (model, context) => {
    if (!(await findExecutable("codex"))) context.skip();
    const scratchRoot = path.resolve("../../.tmp");
    await mkdir(scratchRoot, { recursive: true });
    const scratch = await mkdtemp(path.join(scratchRoot, "codex-metadata-"));
    const codexHome = path.join(scratch, "home");
    const cwd = path.join(scratch, "project");
    await mkdir(codexHome);
    await mkdir(cwd);
    await writeFile(path.join(cwd, "AGENTS.md"), "WORKSPACE_INSTRUCTIONS_MUST_NOT_APPEAR");
    const requests: Record<string, unknown>[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        if (req.url !== "/v1/responses") {
          res.writeHead(404).end();
          return;
        }
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        const events = [
          { type: "response.created", response: { id: "resp-metadata" } },
          {
            type: "response.output_item.done",
            item: {
              type: "message",
              role: "assistant",
              id: "msg-metadata",
              phase: "final_answer",
              content: [{ type: "output_text", text: '{"title":"Fix metadata"}' }],
            },
          },
          {
            type: "response.completed",
            response: {
              id: "resp-metadata",
              usage: {
                input_tokens: 100,
                input_tokens_details: { cached_tokens: 40 },
                output_tokens: 12,
                total_tokens: 112,
              },
            },
          },
        ];
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(events.map(encodeEvent).join(""));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected local TCP server");
    try {
      await writeFile(
        path.join(codexHome, "config.toml"),
        `
model = "${model}"
model_provider = "metadata_test"
[model_providers.metadata_test]
name = "Local metadata test"
base_url = "http://127.0.0.1:${address.port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
[features]
enable_request_compression = false
[mcp_servers."should.not.start"]
command = "otto-metadata-test-must-not-start"
required = true
`,
      );
      const provider = new CodexAppServerAgentClient(createTestLogger(), {
        env: { CODEX_HOME: codexHome },
      });
      const result = await provider.generateBareCompletion({
        cwd,
        model,
        thinkingOptionId: "low",
        prompt: "Return JSON with a short title.",
        signal: AbortSignal.timeout(25_000),
      });
      expect(result.text).toBe('{"title":"Fix metadata"}');
      expect(requests).toHaveLength(1);
      assertIntrinsicTools(requests[0].tools);
      // Models using Responses Lite put intrinsic controls in additional_tools.
      // They must not gain shell, file, MCP, browser, or other environment tools.
      const items = z
        .array(z.object({ type: z.string(), tools: z.unknown().optional() }))
        .parse(requests[0].input);
      for (const item of items) {
        if (item.type === "additional_tools") assertIntrinsicTools(item.tools);
      }
      expect(JSON.stringify(requests[0].input)).not.toContain(
        "WORKSPACE_INSTRUCTIONS_MUST_NOT_APPEAR",
      );
      expect(JSON.stringify(requests[0].input).length).toBeLessThan(12_000);
      expect(result.usage).toMatchObject({
        inputTokens: 60,
        cachedInputTokens: 40,
        outputTokens: 12,
      });
      expect(await readdir(path.join(codexHome, "sessions")).catch(() => [])).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(scratch, { recursive: true, force: true });
    }
  },
  30_000,
);
