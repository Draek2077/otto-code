import * as fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { AgentStreamEvent } from "../agent-sdk-types.js";
import { OpenAICompatAgentClient } from "./openai-compat-agent.js";

/**
 * The per-round assistant-text budget: a model round that streams past its
 * character budget while emitting no tool call is interrupted as a stall.
 *
 * These cover the shape the daemon-wide stall guard (agent-stall-guard.ts)
 * cannot see. That counter keys on `messageId` so a message arriving as a burst
 * of streamed deltas counts once - correct for its job, and the reason it reads
 * 1 for a single runaway generation. See the "unbounded tool-call announcement"
 * finding: 66,384 characters inside one completion over 5m40s, no tool call, no
 * stop token, ended only by the user typing /compact.
 */

const servers: Server[] = [];
const tempWorkspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    tempWorkspaces.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempCwd(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-round-budget-"));
  tempWorkspaces.push(dir);
  return dir;
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

interface RecordedRequest {
  messages: Array<Record<string, unknown>>;
}

interface TestEndpoint {
  baseUrl: string;
  requests: RecordedRequest[];
}

/**
 * Fake server that streams assistant content forever and never emits a
 * finish_reason or [DONE]. The only thing that can end a turn against it is the
 * round text budget (or an explicit interrupt).
 *
 * `mode` picks what precedes the endless text:
 * - "text": nothing, the runaway shape.
 * - "toolCallFirst": a tool call, so the round is going to act.
 * - "toolCallPerRound": a tool call plus a short burst of prose per round, then
 *   a normal end - the healthy interleaved working loop.
 */
async function startEndpoint(
  mode: "text" | "toolCallFirst" | "toolCallPerRound",
): Promise<TestEndpoint> {
  const requests: RecordedRequest[] = [];
  const chunkText = "I'll write the three tool calls now. ";
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test-model-a" }] }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body) as RecordedRequest);
      res.writeHead(200, { "Content-Type": "text/event-stream" });

      const toolCallChunk = sseChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call_${requests.length}`,
                  function: { name: "list_dir", arguments: JSON.stringify({ path: "." }) },
                },
              ],
            },
          },
        ],
      });

      if (mode === "toolCallPerRound") {
        // Prose well under any budget used here, then a tool call, then a
        // clean end. Every round starts the counter from zero.
        res.write(sseChunk({ choices: [{ delta: { content: chunkText } }] }));
        res.write(toolCallChunk);
        res.write(sseChunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }));
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      if (mode === "toolCallFirst") {
        res.write(toolCallChunk);
      }

      let closed = false;
      res.on("close", () => {
        closed = true;
      });
      const pump = (): void => {
        if (closed || res.writableEnded) return;
        // Bounded per tick so the event loop still turns between writes and an
        // abort can land; unbounded in total, which is the point. Writes after
        // a close are no-ops, so the tick does not need to re-check `closed`.
        for (let i = 0; i < 20; i += 1) {
          res.write(sseChunk({ choices: [{ delta: { content: chunkText } }] }));
        }
        setImmediate(pump);
      };
      pump();
    });
  });

  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

async function createSession(options: {
  baseUrl: string;
  maxRoundTextChars: number;
  maxToolRounds: number;
}) {
  const client = new OpenAICompatAgentClient({
    providerId: "lmstudio",
    label: "LM Studio",
    env: { OPENAI_BASE_URL: options.baseUrl },
    maxToolRounds: options.maxToolRounds,
    maxRoundTextChars: options.maxRoundTextChars,
  });
  return client.createSession({
    provider: "lmstudio",
    cwd: await makeTempCwd(),
    model: "test-model-a",
    modeId: "bypassPermissions",
  });
}

function errorMessages(events: AgentStreamEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "timeline" && event.item.type === "error" ? [event.item.message] : [],
  );
}

function streamedText(events: AgentStreamEvent[]): string {
  return events
    .flatMap((event) =>
      event.type === "timeline" && event.item.type === "assistant_message" ? [event.item.text] : [],
    )
    .join("");
}

describe("OpenAICompatAgentSession round text budget", () => {
  test("interrupts a round that streams text forever without emitting a tool call", async () => {
    const endpoint = await startEndpoint("text");
    const session = await createSession({
      baseUrl: endpoint.baseUrl,
      maxRoundTextChars: 2_000,
      maxToolRounds: 10,
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const result = await session.run("Verify the fix");

    // A clean interruption, not a crash: the turn settles canceled down the
    // existing cancel path, and the reason is on the timeline.
    expect(result.canceled).toBe(true);
    expect(events.at(-1)?.type).toBe("turn_canceled");
    expect(events.some((event) => event.type === "turn_failed")).toBe(false);

    const errors = errorMessages(events);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("without emitting a tool call or finishing");
    expect(errors[0]).toContain("maxRoundTextChars");

    // Tripped once and ended the whole turn - it did not let the tool loop
    // start a second round against the same runaway.
    expect(endpoint.requests).toHaveLength(1);

    // Partial output is preserved rather than discarded.
    expect(result.finalText.length).toBeGreaterThan(2_000);
    await session.close();
  });

  test("never interrupts a round that emitted a tool call, however long its preamble runs", async () => {
    // Same endless stream, but the model emits a tool call first: it is going
    // to act, so the budget must not fire no matter how much prose follows.
    const endpoint = await startEndpoint("toolCallFirst");
    const session = await createSession({
      baseUrl: endpoint.baseUrl,
      maxRoundTextChars: 2_000,
      maxToolRounds: 10,
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    // The stream never ends on its own, so prove the budget stayed silent by
    // interrupting well past it and reading how the turn settled.
    const run = session.run("Verify the fix");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await session.interrupt();
    await run;

    expect(streamedText(events).length).toBeGreaterThan(2_000);
    expect(errorMessages(events)).toEqual([]);
    await session.close();
  });

  test("a long working loop resets the budget every round and ends on the tool-round valve", async () => {
    const endpoint = await startEndpoint("toolCallPerRound");
    const session = await createSession({
      baseUrl: endpoint.baseUrl,
      maxRoundTextChars: 2_000,
      maxToolRounds: 4,
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const result = await session.run("Keep listing files");

    // Every round carried prose and a tool call, so the per-round counter
    // started from zero each time and the budget never fired. The turn ends on
    // the max-rounds valve, and the total text streamed across the turn is well
    // past the budget - proving the counter is per round, not per turn.
    expect(result.canceled).toBe(false);
    expect(endpoint.requests).toHaveLength(4);
    expect(errorMessages(events)).toEqual(["Stopped after 4 tool rounds without a final answer."]);
    await session.close();
  });

  test("maxRoundTextChars: 0 disables the guard", async () => {
    const endpoint = await startEndpoint("text");
    const session = await createSession({
      baseUrl: endpoint.baseUrl,
      maxRoundTextChars: 0,
      maxToolRounds: 10,
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const run = session.run("Verify the fix");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await session.interrupt();
    await run;

    expect(streamedText(events).length).toBeGreaterThan(2_000);
    expect(errorMessages(events)).toEqual([]);
    await session.close();
  });
});
