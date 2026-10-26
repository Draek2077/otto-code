import { expect, test, vi } from "vitest";
import type { AgentClient, AgentSession, AgentStreamEvent } from "../../agent/agent-sdk-types.js";
import type { AgentSessionConfig } from "../../agent/agent-sdk-types.js";
import { createNativeContextGeneration, nativeGenerationFamily } from "./native-generation.js";
import { NATIVE_CONTEXT_OUTPUT_LIMIT } from "./native-generation-policy.js";

const capabilities = {
  supportsStreaming: true,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};
const applyToolPolicy = (config: AgentSessionConfig) => config;
function fixture(text = '{"proposal":true}') {
  let listener: ((event: AgentStreamEvent) => void) | undefined;
  const close = vi.fn(async () => {});
  const session: AgentSession = {
    provider: "claude",
    id: "utility",
    capabilities,
    run: vi.fn(async () => ({ sessionId: "utility", finalText: text, timeline: [] })),
    startTurn: async () => {
      throw Error("No background turns");
    },
    subscribe: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    async *streamHistory() {},
    getRuntimeInfo: async () => ({ provider: "claude", sessionId: "utility" }),
    getAvailableModes: async () => [],
    getCurrentMode: async () => null,
    setMode: async () => {},
    getPendingPermissions: () => [],
    respondToPermission: vi.fn(async () => {}),
    describePersistence: () => null,
    interrupt: vi.fn(async () => {}),
    close,
  };
  const createSession = vi.fn<AgentClient["createSession"]>(async () => session);
  const client: AgentClient = {
    provider: "claude",
    capabilities,
    createSession,
    resumeSession: async () => {
      throw Error("Never resume a chat");
    },
    fetchCatalog: async () => ({ models: [], modes: [] }),
    isAvailable: async () => true,
  };
  const state = {
    providerDefinitions: {
      claude: { enabled: true, derivedFromProviderId: null, applyToolPolicy },
      alias: { enabled: true, derivedFromProviderId: "claude", applyToolPolicy },
    },
    clients: { alias: client },
  };
  return {
    state,
    client,
    session,
    createSession,
    close,
    emit: (event: AgentStreamEvent) => listener?.(event),
  };
}
const input = {
  provider: "alias",
  model: "selected",
  cwd: "/fixture",
  prompt: "Supplied prose only",
};
test("configured aliases use their canonical client in an unregistered, nonpersistent read-only session", async () => {
  const f = fixture();
  await expect(createNativeContextGeneration(() => f.state)(input)).resolves.toBe(
    '{"proposal":true}',
  );
  expect(f.createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "alias",
      cwd: "/fixture",
      model: "selected",
      internal: true,
      modeId: "plan",
      mcpServers: {},
    }),
    { ottoReadOnlyGeneration: true },
    { persistSession: false },
  );
  expect(f.close).toHaveBeenCalledOnce();
});
test("disabled, cyclic and unknown aliases never launch a utility session", async () => {
  const f = fixture();
  expect(
    nativeGenerationFamily(
      {
        providerDefinitions: {
          a: { enabled: true, derivedFromProviderId: "b", applyToolPolicy },
          b: { enabled: true, derivedFromProviderId: "a", applyToolPolicy },
        },
      },
      "a",
    ),
  ).toBeNull();
  f.state.providerDefinitions.alias.enabled = false;
  await expect(createNativeContextGeneration(() => f.state)(input)).rejects.toThrow("unavailable");
  expect(f.createSession).not.toHaveBeenCalled();
});
test("failed, empty and oversized native output releases its runtime without registering a chat", async () => {
  for (const text of ["", "x".repeat(NATIVE_CONTEXT_OUTPUT_LIMIT + 1)]) {
    const f = fixture(text);
    await expect(createNativeContextGeneration(() => f.state)(input)).rejects.toThrow(
      "empty or oversized",
    );
    expect(f.close).toHaveBeenCalledOnce();
  }
  const f = fixture();
  f.session.run = async () => {
    throw Error("private native diagnostics");
  };
  await expect(createNativeContextGeneration(() => f.state)(input)).rejects.toThrow();
  expect(f.close).toHaveBeenCalledOnce();
});
test("additional native permission requests are always denied", async () => {
  const f = fixture();
  f.session.run = async () => {
    f.emit({
      type: "permission_requested",
      provider: "claude",
      request: { id: "attempt", provider: "claude", kind: "tool", name: "Bash", input: {} },
    });
    return { sessionId: "utility", finalText: "result", timeline: [] };
  };
  await createNativeContextGeneration(() => f.state)(input);
  expect(f.session.respondToPermission).toHaveBeenCalledWith(
    "attempt",
    expect.objectContaining({ behavior: "deny" }),
  );
});
test("an enabled configured alias remains usable when its base provider is hidden", async () => {
  const f = fixture();
  f.state.providerDefinitions.claude.enabled = false;
  await expect(createNativeContextGeneration(() => f.state)(input)).resolves.toBe(
    '{"proposal":true}',
  );
  expect(f.createSession).toHaveBeenCalledOnce();
});
test("a provider-owned tool-free native operation is used without creating a normal session", async () => {
  const f = fixture();
  f.client.ottoGenerateContextText = vi.fn(async () => "native utility");
  await expect(createNativeContextGeneration(() => f.state)(input)).resolves.toBe("native utility");
  expect(f.createSession).not.toHaveBeenCalled();
});
