import { expect, test } from "vitest";
import { z } from "zod";
import { runCopilotGeneration, type CopilotGenerationRpc } from "./copilot-generation-protocol.js";
import { NATIVE_CONTEXT_OUTPUT_LIMIT } from "./native-generation-policy.js";

function fixture() {
  const calls: { method: string; params: object }[] = [];
  let notify: ((value: unknown) => void) | undefined;
  let request: ((method: string, params: unknown) => unknown) | undefined;
  let id = "";
  const controller = new AbortController();
  const emit = (type: string, data: object = {}, sessionId = id) =>
    notify?.({ sessionId, event: { type, data } });
  const f = {
    version: 3,
    foreignId: false,
    text: '{"proposal":true}',
    calls,
    controller,
    emit,
    onSend: () => {
      emit("assistant.message", { content: f.text });
      emit("session.idle");
    },
    hostRequest: (method: string, params: unknown) => request?.(method, params),
  };
  const rpc: CopilotGenerationRpc = {
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "ping") return { protocolVersion: f.version };
      if (method === "session.create") {
        id = z.object({ sessionId: z.string() }).parse(params).sessionId;
        return { sessionId: f.foreignId ? "foreign" : id };
      }
      if (method === "session.send") f.onSend();
      return { success: true };
    },
    notifications: (listener) => {
      notify = listener;
      return () => {
        notify = undefined;
      };
    },
    requests: (listener) => {
      request = listener;
      return () => {
        request = undefined;
      };
    },
  };
  return {
    ...f,
    rpc,
    run: () =>
      runCopilotGeneration(rpc, {
        cwd: "/fixture",
        model: "selected",
        prompt: "Supplied working set",
        signal: controller.signal,
      }),
    settings: f,
  };
}
test.each([2, 3])(
  "Copilot SDK protocol %s receives an explicit empty tool allowlist before any prompt",
  async (version) => {
    const f = fixture();
    f.settings.version = version;
    await expect(f.run()).resolves.toBe('{"proposal":true}');
    expect(f.calls.map((call) => call.method)).toEqual([
      "ping",
      "session.create",
      "session.send",
      "session.delete",
    ]);
    expect(f.calls[1]?.params).toMatchObject({
      model: "selected",
      workingDirectory: "/fixture",
      tools: [],
      availableTools: [],
      mcpServers: {},
      customAgents: [],
      requestPermission: true,
      requestUserInput: false,
      infiniteSessions: { enabled: false },
    });
    expect(f.calls[3]?.params).toEqual({
      sessionId: z.object({ sessionId: z.string() }).parse(f.calls[1]?.params).sessionId,
    });
  },
);
test("native permissions, tool requests and executable pre-tool hooks are denied", async () => {
  const f = fixture();
  f.settings.onSend = () => {
    expect(f.hostRequest("permission.request", {})).toMatchObject({
      result: { kind: "denied-no-approval-rule-and-could-not-request-from-user" },
    });
    expect(f.hostRequest("tool.call", {})).toMatchObject({ result: { resultType: "failure" } });
    expect(f.hostRequest("hooks.invoke", { hookType: "preToolUse" })).toMatchObject({
      output: { permissionDecision: "deny" },
    });
    f.emit("permission.requested", { requestId: "permission" });
    f.emit("external_tool.requested", { requestId: "tool" });
    f.emit("assistant.message", { content: "safe" });
    f.emit("session.idle");
  };
  await expect(f.run()).resolves.toBe("safe");
  expect(
    f.calls.find((call) => call.method === "session.permissions.handlePendingPermissionRequest")
      ?.params,
  ).toMatchObject({
    requestId: "permission",
    result: { kind: "denied-no-approval-rule-and-could-not-request-from-user" },
  });
  expect(
    f.calls.find((call) => call.method === "session.tools.handlePendingToolCall")?.params,
  ).toMatchObject({
    requestId: "tool",
    error: "Tools are unavailable during Context proposal generation.",
  });
});
test("foreign session events cannot supply output or finish the owned operation", async () => {
  const f = fixture();
  f.settings.onSend = () => {
    f.emit("assistant.message", { content: "foreign" }, "other");
    f.emit("session.idle", {}, "other");
    f.emit("assistant.message", { content: "own" });
    f.emit("session.idle");
  };
  await expect(f.run()).resolves.toBe("own");
});
test("unrecognized native protocol versions fail before creating a session", async () => {
  const f = fixture();
  f.settings.version = 99;
  await expect(f.run()).rejects.toThrow();
  expect(f.calls.map((call) => call.method)).toEqual(["ping"]);
});
test("a mismatched create response never deletes a foreign native chat", async () => {
  const f = fixture();
  f.settings.foreignId = true;
  await expect(f.run()).rejects.toThrow("identity");
  expect(f.calls.map((call) => call.method)).toEqual(["ping", "session.create"]);
});
test("cancel while waiting for completion releases only the utility session", async () => {
  const f = fixture();
  f.settings.onSend = () => f.controller.abort();
  await expect(f.run()).rejects.toThrow("canceled or timed out");
  expect(f.calls.at(-1)?.method).toBe("session.delete");
});
test.each(["", "x".repeat(NATIVE_CONTEXT_OUTPUT_LIMIT + 1)])(
  "empty or oversized output is rejected and its utility session released",
  async (text) => {
    const f = fixture();
    f.settings.text = text;
    await expect(f.run()).rejects.toThrow();
    expect(f.calls.at(-1)?.method).toBe("session.delete");
  },
);
test("private native errors are not returned as user-facing proposal failures", async () => {
  const f = fixture();
  f.settings.onSend = () => f.emit("session.error", { message: "private-key and native stderr" });
  await expect(f.run()).rejects.toThrow(/^Copilot Context generation failed\.$/);
  expect(f.calls.at(-1)?.method).toBe("session.delete");
});
