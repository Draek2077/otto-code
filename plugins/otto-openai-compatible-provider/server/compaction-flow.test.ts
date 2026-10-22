import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import type { ProviderEvent, ProviderPersistence } from "@getpaseo/plugin/server/provider";
import { OpenAiSession } from "./session.js";
import type { ChatMessage } from "./completions.js";

async function fixture() {
  const requests: Array<{ messages: ChatMessage[]; tools?: unknown[] }> = [];
  let outcome: "success" | "empty" | "hang" = "success";
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const summary = input.messages[0]?.content?.startsWith("Summarize the supplied");
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (summary && outcome === "hang") {
      response.write(": waiting\n\n");
      return;
    }
    let content = "Answer.";
    if (summary) content = outcome === "empty" ? "" : "Remember the original objective and file A.";
    response.end(
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              content,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const settings = {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "fixture",
    apiKeyEnv: "OPENAI_API_KEY",
    maxToolRounds: 3,
    timeoutMs: 5000,
  };
  const config = {
    cwd: process.cwd(),
    env: {},
    model: "fixture",
    settings: { auto_compact: "off" },
    mcpServers: {},
    persist: true,
  };
  const events: ProviderEvent[] = [];
  let session = new OpenAiSession("one", config, settings, (event) => events.push(event));
  const message = async (id: string, text: string) => {
    session.start({
      clientMessageId: id,
      delivery: "auto",
      input: { type: "message", content: [{ type: "text", text }] },
    });
    await expect.poll(() => session.running).toBe(false);
  };
  const compact = () =>
    session.start({
      clientMessageId: "compact",
      delivery: "auto",
      input: { type: "command", name: "compact", arguments: "Keep file A" },
    });
  const summaries = () =>
    requests.filter(
      (value) =>
        typeof value.messages[0]?.content === "string" &&
        value.messages[0].content.startsWith("Summarize the supplied"),
    );
  return {
    requests,
    events,
    message,
    compact,
    summaries,
    session: () => session,
    outcome: (value: typeof outcome) => {
      outcome = value;
    },
    resume: async (persistence: ProviderPersistence) => {
      await session.close();
      session = new OpenAiSession(
        "resumed",
        config,
        settings,
        (event) => events.push(event),
        persistence,
      );
    },
    close: async () => {
      await session.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

it("compacts model context without deleting transcript history and resumes the summary after restart", async () => {
  const test = await fixture();
  try {
    const old = "Original objective and file A. ".repeat(300);
    await test.message("old", old);
    await test.message("recent", "Recent work remains verbatim.");
    const archive = structuredClone(test.session().messages);
    test.compact();
    await expect.poll(() => test.session().running).toBe(false);
    expect(test.session().messages).toEqual(archive);
    expect(test.summaries()).toHaveLength(1);
    expect(test.summaries()[0]!.tools).toBeUndefined();
    expect(test.events.findLast((event) => event.type === "session.usage")).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(test.events.findLast((event) => event.type === "session.turn")).toMatchObject({
      state: "completed",
    });
    const persisted = test.events.findLast((event) => event.type === "session.persistence");
    if (persisted?.type !== "session.persistence") throw Error("Missing persistence");
    await test.resume(persisted.persistence);
    await test.message("next", "Continue.");
    const wire = test.requests.at(-1)!.messages;
    expect(wire).not.toContainEqual({ role: "user", content: old });
    expect(wire).toContainEqual({ role: "user", content: "Recent work remains verbatim." });
    expect(JSON.stringify(wire)).toContain("Remember the original objective and file A.");
    expect(test.session().messages).toContainEqual({ role: "user", content: old });
  } finally {
    await test.close();
  }
});

it.each(["empty", "hang"] as const)(
  "retains original context when manual compaction returns %s",
  async (outcome) => {
    const test = await fixture();
    try {
      await test.message("old", "Important original context. ".repeat(300));
      const archive = structuredClone(test.session().messages);
      test.outcome(outcome);
      test.compact();
      await expect.poll(() => test.summaries().length).toBe(1);
      if (outcome === "hang") await test.session().interrupt();
      await expect.poll(() => test.session().running).toBe(false);
      expect(test.session().messages).toEqual(archive);
      expect(test.events.findLast((event) => event.type === "session.turn")).toMatchObject({
        state: outcome === "hang" ? "canceled" : "failed",
      });
      expect(
        test.events.findLast(
          (event) => event.type === "timeline.item" && event.item.type === "compaction",
        ),
      ).toMatchObject({ item: { status: "completed" } });
      test.outcome("success");
      await test.message("next", "Continue unchanged.");
      expect(test.requests.at(-1)!.messages.slice(0, archive.length)).toEqual(archive);
    } finally {
      await test.close();
    }
  },
);

it("automatically compacts older turns, includes summary usage and retains the current turn", async () => {
  const test = await fixture();
  try {
    const old = "OLD_ONLY".repeat(2500);
    const current = "NEW_ONLY".repeat(2500);
    await test.message("old", old);
    test.session().configure({ settings: { auto_compact: "80" } });
    await test.message("current", current);
    expect(test.summaries()).toHaveLength(1);
    const wire = test.requests.at(-1)!.messages;
    expect(wire).not.toContainEqual({ role: "user", content: old });
    expect(wire).toContainEqual({ role: "user", content: current });
    expect(test.session().messages).toContainEqual({ role: "user", content: old });
    expect(test.events.findLast((event) => event.type === "session.usage")).toMatchObject({
      usage: { inputTokens: 20, outputTokens: 10 },
    });
    expect(test.events.findLast((event) => event.type === "session.turn")).toMatchObject({
      state: "completed",
    });
  } finally {
    await test.close();
  }
});

it("continues with original context after an automatic failure without retrying every model request", async () => {
  const test = await fixture();
  try {
    const old = "OLD_ONLY".repeat(2500);
    await test.message("old", old);
    test.session().configure({ settings: { auto_compact: "80" } });
    test.outcome("empty");
    await test.message("current", "NEW_ONLY".repeat(2500));
    await test.message("continue", "Continue.");
    expect(test.summaries()).toHaveLength(1);
    expect(test.requests.at(-1)!.messages).toContainEqual({ role: "user", content: old });
    expect(test.events.findLast((event) => event.type === "session.turn")).toMatchObject({
      state: "completed",
    });
    expect(
      test.events.findLast(
        (event) => event.type === "timeline.item" && event.item.type === "notification",
      ),
    ).toMatchObject({ item: { level: "warning" } });
  } finally {
    await test.close();
  }
});
