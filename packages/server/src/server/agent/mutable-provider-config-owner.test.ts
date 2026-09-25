import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { DaemonConfigStore } from "../daemon-config-store.js";
import { loadPersistedConfig, type PersistedConfig } from "../persisted-config.js";
import type {
  AgentClient,
  AgentMode,
  AgentModelDefinition,
  FetchCatalogOptions,
} from "./agent-sdk-types.js";
import { attachMutableProviderConfigOwner } from "./mutable-provider-config-owner.js";
import {
  type ProviderSnapshotTransition,
  ProviderSnapshotManager,
} from "./provider-snapshot-manager.js";

const tempDirs: string[] = [];
const CONTROLLED_PROVIDERS = {
  claude: { enabled: false },
  codex: { enabled: true },
  copilot: { enabled: false },
  omp: { enabled: false },
  opencode: { enabled: false },
  pi: { enabled: false },
  "otto-brain": { enabled: false },
} as const;

interface Catalog {
  models: AgentModelDefinition[];
  modes: AgentMode[];
}

function controlledCodexClient(fetchCatalog: (options: FetchCatalogOptions) => Promise<Catalog>) {
  return {
    provider: "codex",
    capabilities: {
      supportsStreaming: false,
      supportsSessionPersistence: false,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    async createSession() {
      throw new Error("not implemented");
    },
    async resumeSession() {
      throw new Error("not implemented");
    },
    isAvailable: async () => true,
    fetchCatalog,
  } satisfies AgentClient;
}

function catalog(modelId: string): Catalog {
  return {
    models: [{ provider: "codex", id: modelId, label: modelId }],
    modes: [],
  };
}

function recordCodexEvent(events: string[]): (transition: ProviderSnapshotTransition) => void {
  return ({ current }) => {
    const codex = current.records.find(({ entry }) => entry.provider === "codex")?.entry;
    const next = `${codex?.status}:${codex?.models?.[0]?.id ?? "none"}`;
    // Otto registers more providers than upstream, and every one of them
    // emits the shared snapshot as its own probe settles. Only Codex's
    // transitions are under test here, so a repeat of its current state is
    // another provider's news, not a Codex event.
    if (events.at(-1) === next) return;
    events.push(next);
  };
}

function getCodexSnapshot(manager: ProviderSnapshotManager, cwd: string) {
  return manager.getSnapshot(cwd).records.find(({ entry }) => entry.provider === "codex")?.entry;
}

function mutableConfig(persisted: PersistedConfig): MutableDaemonConfig {
  return {
    relay: { enabled: false },
    mcp: { enabled: true, injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: CONTROLLED_PROVIDERS,
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
    cors: { allowedOrigins: persisted.daemon?.cors?.allowedOrigins ?? [] },
    trustedProxies: ["loopback"],
    git: {
      maxProcessesPerSecond: persisted.daemon?.git?.maxProcessesPerSecond ?? 64,
      maxProcessConcurrency: persisted.daemon?.git?.maxProcessConcurrency ?? 8,
    },
    app: { baseUrl: persisted.app?.baseUrl ?? "https://app.otto-code.me" },
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) rmSync(tempDir, { recursive: true, force: true });
});

describe("mutable provider config owner", () => {
  test("restamps a loaded model when its tier or visibility changes", async () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-provider-config-owner-"));
    tempDirs.push(ottoHome);
    const store = new DaemonConfigStore(ottoHome, mutableConfig({ version: 1 }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: CONTROLLED_PROVIDERS,
      extraClients: { codex: controlledCodexClient(async () => catalog("local-model")) },
    });
    const unsubscribe = attachMutableProviderConfigOwner({
      store,
      providerSnapshotManager: manager,
      updateProviderRegistry: () => undefined,
    });
    const cwd = path.resolve("/tmp/provider-tier-override");

    try {
      await manager.getProvider({ cwd, provider: "codex", wait: true });
      expect(getCodexSnapshot(manager, cwd)?.models?.[0]?.tier).toBeUndefined();

      store.patch({
        modelTierOverrides: [{ provider: "codex", modelId: "local-model", tier: "deep" }],
        modelVisibilityOverrides: [{ provider: "codex", modelId: "local-model", visible: false }],
      });
      expect(getCodexSnapshot(manager, cwd)?.models?.[0]).toMatchObject({
        tier: "deep",
        isVisible: false,
      });
      expect(loadPersistedConfig(ottoHome).agents?.modelTierOverrides).toEqual([
        { provider: "codex", modelId: "local-model", tier: "deep" },
      ]);

      store.patch({ modelTierOverrides: [], modelVisibilityOverrides: [] });
      expect(getCodexSnapshot(manager, cwd)?.models?.[0]?.tier).toBeUndefined();
      expect(getCodexSnapshot(manager, cwd)?.models?.[0]?.isVisible).toBeUndefined();
    } finally {
      unsubscribe();
      manager.destroy();
    }
  });

  test("restores a partially applied agent registry without publishing the prepared catalog", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-provider-config-owner-"));
    tempDirs.push(ottoHome);
    const store = new DaemonConfigStore(ottoHome, mutableConfig({ version: 1 }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: CONTROLLED_PROVIDERS,
    });
    const cwd = path.resolve("/tmp/provider-config-partial-apply");
    const before = manager.getSnapshot(cwd);
    const previousState = manager.getAgentManagerProviderState();
    const previousConfig = store.get();
    const events: ProviderSnapshotTransition[] = [];
    manager.on("change", (event) => events.push(event));
    let agentManagerState = previousState;
    const appliedStates: boolean[] = [];
    const unsubscribe = attachMutableProviderConfigOwner({
      store,
      providerSnapshotManager: manager,
      updateProviderRegistry: (state) => {
        agentManagerState = state;
        appliedStates.push(state.providerDefinitions.codex.enabled);
        if (!state.providerDefinitions.codex.enabled) throw new Error("partial registry apply");
      },
    });

    try {
      expect(() => store.patch({ providers: { codex: { enabled: false } } })).toThrow(
        "partial registry apply",
      );
      expect(appliedStates).toEqual([false, true]);
      expect(agentManagerState).toEqual(previousState);
      expect(agentManagerState.clients.codex).toBe(previousState.clients.codex);
      expect(manager.getSnapshot(cwd)).toBe(before);
      expect(store.get()).toEqual(previousConfig);
      expect(events).toEqual([]);
      // A later unrelated successful notification must not commit rejected work.
      store.patch({ autoArchiveAfterMerge: true });
      expect(manager.getSnapshot(cwd)).toBe(before);
      expect(events).toEqual([]);
    } finally {
      unsubscribe();
      manager.destroy();
    }
  });

  test("restores providers even when another live owner's rollback fails", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-provider-config-owner-"));
    tempDirs.push(ottoHome);
    const store = new DaemonConfigStore(ottoHome, mutableConfig({ version: 1 }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: CONTROLLED_PROVIDERS,
    });
    const cwd = path.resolve("/tmp/provider-config-multiple-owner-failure");
    const before = manager.getSnapshot(cwd);
    const previousState = manager.getAgentManagerProviderState();
    const previousConfig = store.get();
    let agentManagerState = previousState;
    const events: ProviderSnapshotTransition[] = [];
    manager.on("change", (event) => events.push(event));
    const unsubscribe = attachMutableProviderConfigOwner({
      store,
      providerSnapshotManager: manager,
      updateProviderRegistry: (state) => {
        agentManagerState = state;
      },
    });
    const rollbackFailure = new Error("other owner rollback failed");
    const applyFailure = new Error("third owner apply failed");
    const unsubscribeOther = store.onApply(() => () => {
      throw rollbackFailure;
    });
    const unsubscribeFailure = store.onApply(() => {
      throw applyFailure;
    });

    try {
      expect(() => store.patch({ providers: { codex: { enabled: false } } })).toThrow(
        expect.objectContaining({ cause: applyFailure, rollbackErrors: [rollbackFailure] }),
      );
      expect(agentManagerState).toEqual(previousState);
      expect(agentManagerState.clients.codex).toBe(previousState.clients.codex);
      expect(manager.getSnapshot(cwd)).toBe(before);
      expect(store.get()).toEqual(previousConfig);
      expect(events).toEqual([]);
      unsubscribeFailure();
      unsubscribeOther();
      store.patch({ autoArchiveAfterMerge: true });
      expect(manager.getSnapshot(cwd)).toBe(before);
      expect(events).toEqual([]);
    } finally {
      unsubscribeFailure();
      unsubscribeOther();
      unsubscribe();
      manager.destroy();
    }
  });

  test("commits all provider targets despite config and catalog notification failures", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-provider-config-owner-"));
    tempDirs.push(ottoHome);
    const store = new DaemonConfigStore(ottoHome, mutableConfig({ version: 1 }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: CONTROLLED_PROVIDERS,
    });
    const targets = [
      path.resolve("/tmp/provider-config-notify-a"),
      path.resolve("/tmp/provider-config-notify-b"),
    ];
    for (const cwd of targets) manager.getSnapshot(cwd);
    let agentManagerState = manager.getAgentManagerProviderState();
    const unsubscribeFirst = store.onChange(() => {
      throw new Error("first notification failed");
    });
    const unsubscribe = attachMutableProviderConfigOwner({
      store,
      providerSnapshotManager: manager,
      updateProviderRegistry: (state) => {
        agentManagerState = state;
      },
    });
    manager.on("change", () => {
      throw new Error("catalog notification failed");
    });
    const events: string[] = [];
    manager.on("change", ({ current }) => {
      // All memberships must be installed before the first listener runs.
      for (const cwd of targets)
        expect(getCodexSnapshot(manager, cwd)).toMatchObject({
          status: "unavailable",
          enabled: false,
        });
      events.push(current.cwd);
    });
    let lastNotificationCount = 0;
    const unsubscribeLast = store.onChange(() => {
      lastNotificationCount += 1;
    });

    try {
      expect(() => store.patch({ providers: { codex: { enabled: false } } })).not.toThrow();
      expect(events).toEqual(targets);
      expect(lastNotificationCount).toBe(1);
      expect(agentManagerState.providerDefinitions.codex.enabled).toBe(false);
      expect(store.get().providers.codex.enabled).toBe(false);
      for (const cwd of targets)
        expect(getCodexSnapshot(manager, cwd)).toMatchObject({
          status: "unavailable",
          enabled: false,
        });
    } finally {
      unsubscribeLast();
      unsubscribe();
      unsubscribeFirst();
      manager.destroy();
    }
  });

  test("publishes provider changes after commit and emits nothing on rollback", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-provider-config-owner-"));
    tempDirs.push(ottoHome);
    const store = new DaemonConfigStore(ottoHome, mutableConfig({ version: 1 }));
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { codex: { enabled: true } },
    });
    const cwd = path.resolve("/tmp/provider-config-owner");
    manager.getSnapshot(cwd);
    const events: string[] = [];
    manager.on("change", ({ current }) => events.push(current.cwd));
    let agentManagerState = manager.getAgentManagerProviderState();
    const unsubscribe = attachMutableProviderConfigOwner({
      store,
      providerSnapshotManager: manager,
      updateProviderRegistry: (state) => {
        agentManagerState = state;
      },
    });
    const unsubscribeTimingCheck = store.onApply(() => {
      expect(events).toEqual([]);
      return () => undefined;
    });

    try {
      store.patch({ providers: { codex: { enabled: false } } });
      expect(events).toEqual([cwd]);
      expect(agentManagerState.providerDefinitions.codex).toMatchObject({ enabled: false });

      events.length = 0;
      const unsubscribeFailure = store.onApply(() => {
        throw new Error("later owner failed");
      });
      expect(() => store.patch({ providers: { codex: { enabled: true } } })).toThrow(
        "later owner failed",
      );
      unsubscribeFailure();

      expect(events).toEqual([]);
      expect(manager.getAgentManagerProviderState().providerDefinitions.codex).toMatchObject({
        enabled: false,
      });
      expect(agentManagerState.providerDefinitions.codex).toMatchObject({ enabled: false });
    } finally {
      unsubscribeTimingCheck();
      unsubscribe();
      manager.destroy();
    }
  });

  test("does no provider work for unrelated CORS, Git, and app URL reloads", () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-provider-config-owner-"));
    tempDirs.push(ottoHome);
    const initial: PersistedConfig = {
      version: 1,
      daemon: {
        cors: { allowedOrigins: ["https://before.example.test"] },
        git: { maxProcessesPerSecond: 64, maxProcessConcurrency: 8 },
      },
      app: { baseUrl: "https://before.example.test" },
    };
    const configPath = path.join(ottoHome, "config.json");
    writeFileSync(configPath, `${JSON.stringify(initial, null, 2)}\n`, "utf-8");
    const store = new DaemonConfigStore(ottoHome, mutableConfig(initial), undefined, {
      startupPersisted: initial,
      reloadSource: {
        resolve: (persisted) => ({
          mutable: mutableConfig(persisted),
          overrideControlledPaths: [],
        }),
      },
    });
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: { codex: { enabled: true } },
    });
    manager.getSnapshot("/tmp/provider-config-owner");
    const events: string[] = [];
    manager.on("change", ({ current }) => events.push(current.cwd));
    let registryUpdates = 0;
    const unsubscribe = attachMutableProviderConfigOwner({
      store,
      providerSnapshotManager: manager,
      updateProviderRegistry: () => {
        registryUpdates += 1;
      },
    });

    try {
      const reloaded: PersistedConfig = {
        ...initial,
        daemon: {
          ...initial.daemon,
          cors: { allowedOrigins: ["https://after.example.test"] },
          git: { maxProcessesPerSecond: 5, maxProcessConcurrency: 1 },
        },
        app: { baseUrl: "https://after.example.test" },
      };
      writeFileSync(configPath, `${JSON.stringify(reloaded, null, 2)}\n`, "utf-8");

      expect(store.reload().appliedPaths).toEqual([
        "app.baseUrl",
        "daemon.cors.allowedOrigins",
        "daemon.git.maxProcessConcurrency",
        "daemon.git.maxProcessesPerSecond",
      ]);
      expect(events).toEqual([]);
      expect(registryUpdates).toBe(0);
      expect(manager.getAgentManagerProviderState().providerDefinitions.codex).toMatchObject({
        enabled: true,
      });
    } finally {
      unsubscribe();
      manager.destroy();
    }
  });

  test("replaces an in-flight catalog after provider config commits", async () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-provider-config-owner-"));
    tempDirs.push(ottoHome);
    const store = new DaemonConfigStore(ottoHome, mutableConfig({ version: 1 }));
    const catalogResolvers: Array<(value: Catalog) => void> = [];
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: CONTROLLED_PROVIDERS,
      extraClients: {
        codex: controlledCodexClient(
          () => new Promise((resolve) => catalogResolvers.push(resolve)),
        ),
      },
    });
    const cwd = path.resolve("/tmp/provider-config-commit");
    const events: string[] = [];
    manager.on("change", recordCodexEvent(events));
    const unsubscribe = attachMutableProviderConfigOwner({
      store,
      providerSnapshotManager: manager,
      updateProviderRegistry: () => undefined,
    });

    try {
      const originalRead = manager.getProvider({ cwd, provider: "codex", wait: true });
      await vi.waitFor(() => expect(catalogResolvers).toHaveLength(1));
      expect(events).toEqual([]);

      store.patch({ providers: { codex: { enabled: true, label: "Reloaded Codex" } } });
      expect(events).toEqual(["loading:none"]);
      await vi.waitFor(() => expect(catalogResolvers).toHaveLength(2));

      catalogResolvers[0]?.(catalog("stale-model"));
      await originalRead;
      expect(events).toEqual(["loading:none"]);

      catalogResolvers[1]?.(catalog("current-model"));
      await vi.waitFor(() =>
        expect(getCodexSnapshot(manager, cwd)).toMatchObject({
          status: "ready",
          models: [{ id: "current-model" }],
        }),
      );
      expect(events).toEqual(["loading:none", "ready:current-model"]);
    } finally {
      unsubscribe();
      manager.destroy();
    }
  });

  test("lets the original in-flight catalog publish after provider config rolls back", async () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-provider-config-owner-"));
    tempDirs.push(ottoHome);
    const store = new DaemonConfigStore(ottoHome, mutableConfig({ version: 1 }));
    const catalogResolvers: Array<(value: Catalog) => void> = [];
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      providerOverrides: CONTROLLED_PROVIDERS,
      extraClients: {
        codex: controlledCodexClient(
          () => new Promise((resolve) => catalogResolvers.push(resolve)),
        ),
      },
    });
    const cwd = path.resolve("/tmp/provider-config-rollback");
    const events: string[] = [];
    manager.on("change", recordCodexEvent(events));
    const previousState = manager.getAgentManagerProviderState();
    let agentManagerState = previousState;
    const unsubscribe = attachMutableProviderConfigOwner({
      store,
      providerSnapshotManager: manager,
      updateProviderRegistry: (state) => {
        agentManagerState = state;
      },
    });
    const observedDuringApply: Array<{
      label: string;
      snapshot: ReturnType<ProviderSnapshotManager["getSnapshot"]>;
    }> = [];
    const unsubscribeFailure = store.onApply(() => {
      observedDuringApply.push({
        label: manager.getProviderLabel("codex"),
        snapshot: manager.getSnapshot(cwd),
      });
      throw new Error("later owner failed");
    });

    try {
      const originalRead = manager.getProvider({ cwd, provider: "codex", wait: true });
      await vi.waitFor(() => expect(catalogResolvers).toHaveLength(1));
      expect(events).toEqual([]);

      const before = manager.getSnapshot(cwd);
      expect(() =>
        store.patch({ providers: { codex: { enabled: true, label: "Rejected Codex" } } }),
      ).toThrow("later owner failed");
      expect(events).toEqual([]);
      expect(observedDuringApply).toEqual([{ label: "Codex", snapshot: before }]);
      expect(observedDuringApply[0]!.snapshot).toBe(before);
      expect(manager.getSnapshot(cwd)).toBe(before);
      expect(agentManagerState).toEqual(previousState);
      expect(agentManagerState.clients.codex).toBe(previousState.clients.codex);

      catalogResolvers[0]?.(catalog("original-model"));
      await expect(originalRead).resolves.toMatchObject({
        status: "ready",
        models: [{ id: "original-model" }],
      });
      expect(getCodexSnapshot(manager, cwd)).toMatchObject({
        status: "ready",
        models: [{ id: "original-model" }],
      });
      expect(events).toEqual(["ready:original-model"]);
      expect(catalogResolvers).toHaveLength(1);
    } finally {
      unsubscribeFailure();
      unsubscribe();
      manager.destroy();
    }
  });
});
