import { expect, test, vi } from "vitest";
import type { AgentClient, AgentSession, AgentStreamEvent } from "../../agent/agent-sdk-types.js";
import { createArtifactGeneration } from "./generation.js";
import { cleanupArtifactOperation } from "./files.js";
const html = "<html><head><title>Report</title></head><body>Report</body></html>";
const capabilities = {
  supportsStreaming: true,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};
function fixture() {
  let listener: ((event: AgentStreamEvent) => void) | undefined;
  const close = vi.fn(async () => {}),
    interrupt = vi.fn(async () => {}),
    permission = vi.fn(async () => {});
  const run = vi.fn<AgentSession["run"]>(async () => ({
    sessionId: "fixture",
    finalText: JSON.stringify({ html }),
    timeline: [],
  }));
  const session: AgentSession = {
    provider: "fixture",
    id: "fixture",
    capabilities,
    run,
    startTurn: async () => {
      throw new Error("No background turn");
    },
    subscribe: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    async *streamHistory() {},
    getRuntimeInfo: async () => ({ provider: "fixture", sessionId: "fixture" }),
    getAvailableModes: async () => [],
    getCurrentMode: async () => null,
    setMode: async () => {},
    getPendingPermissions: () => [],
    respondToPermission: permission,
    describePersistence: () => null,
    interrupt,
    close,
  };
  const createSession = vi.fn<AgentClient["createSession"]>(async () => session);
  const client: AgentClient = {
    provider: "fixture",
    capabilities,
    createSession,
    resumeSession: async () => {
      throw new Error("Never resume a user chat");
    },
    fetchCatalog: async () => ({ models: [], modes: [] }),
    isAvailable: async () => true,
  };
  const resolveCreateConfig = vi.fn(async () => ({
    modeId: "unattended",
    featureValues: undefined,
  }));
  const candidates = vi.fn(async () => [{ provider: "fixture", model: "configured" }]);
  const generate = createArtifactGeneration({
    providers: {
      getAgentManagerProviderState: () => ({
        clients: { fixture: client },
        providerDefinitions: {},
      }),
      resolveCreateConfig,
    },
    candidates,
  });
  const controller = new AbortController();
  const request = { cwd: "/fixture", prompt: "Create a report", signal: controller.signal };
  return {
    session,
    generate,
    request,
    controller,
    run,
    createSession,
    close,
    interrupt,
    permission,
    resolveCreateConfig,
    candidates,
    emit: (event: AgentStreamEvent) => listener?.(event),
  };
}
test("selected provider owns a fresh nonpersistent session without a user-chat or Otto tool catalog", async () => {
  const f = fixture();
  const result = await f.generate({
    ...f.request,
    selection: { provider: "fixture", model: "chosen" },
  });
  expect(result).toEqual({ html, provider: "fixture", model: "chosen" });
  expect(f.candidates).not.toHaveBeenCalled();
  expect(f.createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "fixture",
      model: "chosen",
      internal: true,
      mcpServers: {},
      modeId: "unattended",
    }),
    {},
    { persistSession: false },
  );
  expect(f.resolveCreateConfig).toHaveBeenCalledWith(
    expect.objectContaining({ parent: null, unattended: true }),
  );
  expect(f.close).toHaveBeenCalledTimes(1);
});
test("an abort interrupts and closes the owned session and rejects a late deliverable", async () => {
  const f = fixture();
  let finish!: () => void;
  f.run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({ sessionId: "fixture", finalText: JSON.stringify({ html }), timeline: [] });
      }),
  );
  const pending = f.generate(f.request);
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
  f.controller.abort();
  finish();
  await expect(pending).rejects.toThrow();
  expect(f.interrupt).toHaveBeenCalledTimes(1);
  expect(f.close).toHaveBeenCalledTimes(1);
});
test("abort during startup closes the eventual session without starting generation", async () => {
  const f = fixture();
  f.createSession.mockImplementationOnce(async () => {
    f.controller.abort();
    return f.session;
  });
  await expect(f.generate(f.request)).rejects.toThrow();
  expect(f.run).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(1);
});
test("a pre-aborted request never discovers providers or opens a session", async () => {
  const f = fixture();
  f.controller.abort();
  await expect(f.generate(f.request)).rejects.toThrow();
  expect(f.candidates).not.toHaveBeenCalled();
  expect(f.createSession).not.toHaveBeenCalled();
});
test("an unconfigured default gives an actionable model-selection error without starting a provider", async () => {
  const f = fixture();
  f.candidates.mockResolvedValueOnce([]);
  await expect(f.generate(f.request)).rejects.toMatchObject({
    code: "unavailable",
    message:
      "Choose a generation model on the artifact form. This host has no usable generation default.",
  });
  expect(f.createSession).not.toHaveBeenCalled();
});
test("permissions are denied without prompting or granting broader tools", async () => {
  const f = fixture();
  f.run.mockImplementationOnce(async () => {
    f.emit({
      type: "permission_requested",
      provider: "fixture",
      request: { id: "permission", provider: "fixture", name: "write", kind: "tool" },
    });
    return { sessionId: "fixture", finalText: JSON.stringify({ html }), timeline: [] };
  });
  await f.generate(f.request);
  expect(f.permission).toHaveBeenCalledWith("permission", {
    behavior: "deny",
    message: "Artifact generation cannot request interactive approval.",
  });
});
test("failure retains both operation and cleanup errors without a silent model fallback", async () => {
  const primary = new Error("primary"),
    secondary = new Error("close");
  await expect(
    cleanupArtifactOperation(
      async () => {
        throw primary;
      },
      async () => {
        throw secondary;
      },
    ),
  ).rejects.toMatchObject({ cause: primary, errors: [primary, secondary] });
  const f = fixture();
  f.run.mockRejectedValueOnce(primary);
  await expect(f.generate(f.request)).rejects.toBe(primary);
  expect(f.run).toHaveBeenCalledTimes(1);
  expect(f.close).toHaveBeenCalledTimes(1);
});
