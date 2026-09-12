import { describe, expect, test, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { CodexAppServerAgentClient } from "./codex-app-server-agent.js";
import { createFakeCodexAppServer } from "./codex/test-utils/fake-app-server.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { asInternals } from "../../test-utils/class-mocks.js";

function setup(handlers: Parameters<typeof createFakeCodexAppServer>[0] = {}) {
  const server = createFakeCodexAppServer(handlers);
  const provider = new CodexAppServerAgentClient(createTestLogger());
  const spawn = vi.fn(async () => server.child);
  asInternals<{ spawnAppServer: () => Promise<ChildProcessWithoutNullStreams> }>(
    provider,
  ).spawnAppServer = spawn;
  const kill = vi.spyOn(server.child, "kill");
  return { server, provider, spawn, kill };
}

const options = { cwd: process.cwd(), model: "gpt-5.6-luna", prompt: "Return a short title." };

describe("Codex metadata completion", () => {
  test("returns completed text with usage from an ephemeral thread using the selected effort", async () => {
    const { server, provider, kill } = setup({
      "config/read": () => ({ config: { mcp_servers: { private: { command: "private-mcp" } } } }),
    });
    const result = provider.generateBareCompletion({ ...options, thinkingOptionId: "low" });
    await server.waitForTurnStart();
    server.says({ threadId: "other-thread", itemId: "other", text: "ignore" });
    server.says({ threadId: "thread-1", itemId: "answer", text: '{"title":"Fix metadata"}' });
    server.child.stdout.write(
      `${JSON.stringify({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-1",
          tokenUsage: { total: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 12 } },
        },
      })}\n`,
    );
    server.completeTurn();
    await expect(result).resolves.toMatchObject({
      text: '{"title":"Fix metadata"}',
      usage: { inputTokens: 60, cachedInputTokens: 40, outputTokens: 12 },
    });
    expect(
      server.requests().find((request) => request.method === "thread/start")?.params,
    ).toMatchObject({
      model: options.model,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: { project_doc_max_bytes: 0, mcp_servers: { private: { enabled: false } } },
    });
    expect(
      server.requests().find((request) => request.method === "turn/start")?.params,
    ).toMatchObject({ effort: "low" });
    expect(kill).toHaveBeenCalled();
    server.assertNoErrors();
  });

  test("preserves the provider failure instead of returning partial output", async () => {
    const { server, provider, kill } = setup();
    const result = provider.generateBareCompletion(options);
    const assertion = expect(result).rejects.toThrow("Model is unavailable");
    await server.waitForTurnStart();
    server.says({ threadId: "thread-1", text: "partial" });
    server.completeTurn({ status: "failed", error: { message: "Model is unavailable" } });
    await assertion;
    expect(kill).toHaveBeenCalled();
  });

  test("rejects empty completed output", async () => {
    const { server, provider } = setup();
    const result = provider.generateBareCompletion(options);
    const assertion = expect(result).rejects.toThrow("no text");
    await server.waitForTurnStart();
    server.completeTurn();
    await assertion;
  });

  test("cancels an in-flight completion and disposes its process", async () => {
    const { server, provider, kill } = setup();
    const controller = new AbortController();
    const result = provider.generateBareCompletion({ ...options, signal: controller.signal });
    const assertion = expect(result).rejects.toThrow("Canceled metadata");
    await server.waitForTurnStart();
    controller.abort(new Error("Canceled metadata"));
    await assertion;
    expect(kill).toHaveBeenCalled();
  });

  test("does not start a process for an already canceled request", async () => {
    const { provider, spawn } = setup();
    await expect(
      provider.generateBareCompletion({
        ...options,
        signal: AbortSignal.abort(new Error("Canceled")),
      }),
    ).rejects.toThrow("Canceled");
    expect(spawn).not.toHaveBeenCalled();
  });

  test("reports process exit while waiting for output", async () => {
    const { server, provider } = setup();
    const result = provider.generateBareCompletion(options);
    const assertion = expect(result).rejects.toThrow("exited");
    await server.waitForTurnStart();
    server.disconnect();
    await assertion;
  });

  test("stops immediately when a model attempts a tool", async () => {
    const { server, provider, kill } = setup();
    const result = provider.generateBareCompletion(options);
    const assertion = expect(result).rejects.toThrow("attempted a tool or action");
    await server.waitForTurnStart();
    server.child.stdout.write(
      `${JSON.stringify({
        method: "item/started",
        params: {
          threadId: "thread-1",
          item: { id: "tool", type: "commandExecution" },
        },
      })}\n`,
    );
    await assertion;
    expect(kill).toHaveBeenCalled();
  });

  test("cleans up when thread creation fails", async () => {
    const { provider, kill } = setup({
      "thread/start": () => ({
        __jsonRpcError: { code: -32602, message: "Invalid model selection" },
      }),
    });
    await expect(provider.generateBareCompletion(options)).rejects.toThrow(
      "Invalid model selection",
    );
    expect(kill).toHaveBeenCalled();
  });

  test("cancels while a startup RPC is still pending", async () => {
    const { server, provider, kill } = setup({ "config/read": () => new Promise(() => {}) });
    const controller = new AbortController();
    const result = provider.generateBareCompletion({ ...options, signal: controller.signal });
    const assertion = expect(result).rejects.toThrow("Canceled startup");
    await server.waitForRequest("config/read");
    controller.abort(new Error("Canceled startup"));
    await assertion;
    expect(kill).toHaveBeenCalled();
  });

  test("enforces the completion deadline after turn/start succeeds", async () => {
    vi.useFakeTimers();
    try {
      const { server, provider, kill } = setup();
      const result = provider.generateBareCompletion(options);
      const assertion = expect(result).rejects.toThrow("timed out after 90 seconds");
      await server.waitForTurnStart();
      await vi.advanceTimersByTimeAsync(90_000);
      await assertion;
      expect(kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
