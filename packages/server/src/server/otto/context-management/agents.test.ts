import { expect, test, vi } from "vitest";
import { contextAgents } from "./agents.js";
import { parseStoredAgentRecord } from "../../agent/agent-storage.js";
function record(id: string, patch: Record<string, unknown> = {}) {
  return parseStoredAgentRecord({
    id,
    provider: "codex",
    cwd: "/fixture/worktree",
    workspaceId: "workspace",
    title: "Stored chat",
    createdAt: "2026-10-25T00:00:00Z",
    updatedAt: "2026-10-25T00:00:00Z",
    ...patch,
  });
}
test("closed chats remain inspectable from the canonical registry without pretending to retain a request", async () => {
  const current = record("stored", {
    persistence: { provider: "codex", sessionId: "historical-native-session" },
  });
  const registry = { get: vi.fn(async () => current), list: vi.fn(async () => [current]) };
  const projection = contextAgents({ getAgent: () => null, listAgents: () => [] }, registry);
  const expected = {
    id: "stored",
    provider: "codex",
    workspaceId: "workspace",
    title: "Stored chat",
    cwd: "/fixture/worktree",
    internal: false,
    sessionId: null,
    fromStorage: true,
  };
  expect(await projection.get("stored")).toEqual(expected);
  expect(await projection.list()).toEqual([expected]);
});
test("live metadata and actual cwd win once over a stale stored sibling", async () => {
  const old = record("same");
  const live = {
    id: "same",
    provider: "claude",
    workspaceId: "workspace",
    cwd: "/fixture/current",
    config: { title: "Current chat" },
    session: { id: "live-session" },
  };
  const registry = { get: vi.fn(async () => old), list: vi.fn(async () => [old]) };
  const projection = contextAgents({ getAgent: () => live, listAgents: () => [live] }, registry);
  const expected = {
    id: "same",
    provider: "claude",
    workspaceId: "workspace",
    title: "Current chat",
    cwd: "/fixture/current",
    internal: false,
    sessionId: "live-session",
  };
  expect(await projection.get("same")).toEqual(expected);
  expect(registry.get).not.toHaveBeenCalled();
  expect(await projection.list()).toEqual([expected]);
});
test("archived and missing records are not revived by Context browsing", async () => {
  const archived = record("archived", { archivedAt: "2026-10-25T01:00:00Z" });
  const projection = contextAgents(
    { getAgent: () => null, listAgents: () => [] },
    { get: async (id) => (id === "archived" ? archived : null), list: async () => [archived] },
  );
  expect(await projection.list()).toEqual([]);
  expect(await projection.get("archived")).toBeNull();
  expect(await projection.get("missing")).toBeNull();
});
test("projection retains internal/workspace authority flags and never returns persisted secrets or provider options", async () => {
  const current = record("internal", {
    internal: true,
    config: { providerOptions: { token: "PRIVATE_VALUE" }, systemPrompt: "PRIVATE_PROMPT" },
  });
  const projection = contextAgents(
    { getAgent: () => null, listAgents: () => [] },
    { get: async () => current, list: async () => [current] },
  );
  expect(await projection.get("internal")).toMatchObject({
    internal: true,
    workspaceId: "workspace",
  });
  const result = await projection.list();
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
