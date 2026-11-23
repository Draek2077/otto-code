import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { AgentManager } from "../../agent/agent-manager.js";
import { AgentStorage } from "../../agent/agent-storage.js";
import type { AgentClient, AgentSession, AgentSessionConfig } from "../../agent/agent-sdk-types.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

const parent = fileURLToPath(new URL("../../../../../../.tmp/knowledge-session/", import.meta.url));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const capabilities = {
  supportsStreaming: false,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};
/** Typed provider adapter only. Any model turn is an immediate fixture failure. */
function session(): AgentSession {
  const id = randomUUID();
  return {
    provider: "codex",
    id,
    capabilities,
    run: async () => {
      throw new Error("No model turns are allowed");
    },
    startTurn: async () => {
      throw new Error("No model turns are allowed");
    },
    subscribe: () => () => {},
    async *streamHistory() {},
    getRuntimeInfo: async () => ({ provider: "codex", sessionId: id }),
    getAvailableModes: async () => [],
    getCurrentMode: async () => null,
    setMode: async () => {},
    getPendingPermissions: () => [],
    respondToPermission: async () => {},
    describePersistence: () => ({ provider: "codex", sessionId: id }),
    interrupt: async () => {},
    close: async () => {},
  };
}
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const launches: Partial<AgentSessionConfig>[] = [];
  const selected: string[] = [];
  let version = "first catalog";
  const client: AgentClient = {
    provider: "codex",
    capabilities,
    createSession: async (config) => {
      launches.push(config);
      return session();
    },
    resumeSession: async (_handle, config) => {
      launches.push(config ?? {});
      return session();
    },
    importSession: async (_input, context) => {
      launches.push(context.config);
      const imported = session();
      if (!imported.id) throw new Error("Missing fixture session identity");
      // Intentionally return the launch config to prove the manager strips all
      // ephemeral instructions even when a provider returns them on import.
      return {
        session: imported,
        config: { ...context.config, systemPrompt: "Imported user instructions" },
        persistence: { provider: "codex", sessionId: imported.id },
        timeline: [],
      };
    },
    fetchCatalog: async () => ({ models: [], modes: [] }),
    isAvailable: async () => true,
  };
  const manager = new AgentManager({
    clients: { codex: client },
    logger,
    registry: storage,
    appendSystemPrompt: "Daemon instructions",
    ottoKnowledgePrompt: async (workspaceId) => {
      selected.push(workspaceId);
      return version;
    },
  });
  cleanup.push(async () => {
    for (const agent of manager.listAgents()) await manager.closeAgent(agent.id);
    await storage.flush();
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    manager,
    storage,
    launches,
    selected,
    update: (value: string) => {
      version = value;
    },
  };
}
it("opens a real manager session with canonical workspace metadata and refreshes it without persisting or accumulating indexes", async () => {
  const f = await fixture();
  const agent = await f.manager.createAgent(
    { provider: "codex", cwd: f.root, model: "fixture", systemPrompt: "User instructions" },
    undefined,
    { workspaceId: "canonical-workspace" },
  );
  expect(f.selected).toEqual(["canonical-workspace"]);
  expect(f.launches[0]).toMatchObject({
    systemPrompt: "User instructions",
    daemonAppendSystemPrompt: "Daemon instructions\n\nfirst catalog",
  });
  expect(agent.config).not.toHaveProperty("daemonAppendSystemPrompt");
  expect((await f.storage.get(agent.id))?.config).not.toHaveProperty("daemonAppendSystemPrompt");
  f.update("current catalog");
  const refreshed = await f.manager.reloadAgentSession(agent.id);
  expect(f.selected).toEqual(["canonical-workspace", "canonical-workspace"]);
  expect(f.launches.at(-1)?.daemonAppendSystemPrompt).toBe(
    "Daemon instructions\n\ncurrent catalog",
  );
  expect(refreshed.config).not.toHaveProperty("daemonAppendSystemPrompt");
});
it("uses the authoritative resume workspace and skips Knowledge for archived history reads", async () => {
  const f = await fixture();
  const agent = await f.manager.createAgent(
    { provider: "codex", cwd: f.root, model: "fixture" },
    undefined,
    { workspaceId: "saved-workspace" },
  );
  if (!agent.persistence) throw new Error("Missing fixture persistence");
  await f.manager.closeAgent(agent.id);
  f.update("resumed catalog");
  const resumed = await f.manager.resumeAgentFromPersistence(
    agent.persistence,
    { cwd: f.root, model: "fixture" },
    agent.id,
    { workspaceId: "saved-workspace" },
  );
  expect(f.selected).toEqual(["saved-workspace", "saved-workspace"]);
  expect(resumed.workspaceId).toBe("saved-workspace");
  expect(f.launches.at(-1)?.daemonAppendSystemPrompt).toBe(
    "Daemon instructions\n\nresumed catalog",
  );
  await f.manager.closeAgent(resumed.id);
  const history = await f.manager.resumeAgentFromPersistence(
    { provider: "codex", sessionId: "archived-fixture" },
    { cwd: path.join(f.root, "removed-worktree"), model: "fixture" },
    undefined,
    { workspaceId: "archived-workspace" },
    { purpose: "history" },
  );
  expect(f.selected).toEqual(["saved-workspace", "saved-workspace"]);
  expect(history.config).not.toHaveProperty("daemonAppendSystemPrompt");
});
it("adds the selected import workspace index but strips provider-returned runtime instructions before storage", async () => {
  const f = await fixture();
  const imported = await f.manager.importProviderSession({
    provider: "codex",
    providerHandleId: "fixture-import",
    cwd: f.root,
    workspaceId: "import-workspace",
  });
  expect(f.selected).toEqual(["import-workspace"]);
  expect(f.launches.at(-1)?.daemonAppendSystemPrompt).toBe("Daemon instructions\n\nfirst catalog");
  expect(imported.config).not.toHaveProperty("daemonAppendSystemPrompt");
  expect(imported.config.systemPrompt).toBe("Imported user instructions");
  expect((await f.storage.get(imported.id))?.config).not.toHaveProperty("daemonAppendSystemPrompt");
});
