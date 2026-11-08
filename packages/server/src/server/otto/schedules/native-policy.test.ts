import path from "node:path";
import { mkdir } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { parseStoredAgentRecord } from "../../agent/agent-storage.js";
import type { ProviderSnapshotEntry } from "../../agent/agent-sdk-types.js";
import { createPersistedWorkspaceRecord } from "../../workspace-registry.js";
import { workflowFixture } from "../workflows/test-utils/fixture.js";
import { ScheduleNativePolicy, type ScheduleNativePolicyPorts } from "./native-policy.js";
import type { StoredSchedule } from "./types.js";

async function fixture() {
  const f = await workflowFixture();
  let record = parseStoredAgentRecord({
    id: "00000000-0000-4000-8000-000000000001",
    provider: "fixture-provider",
    cwd: f.repo,
    workspaceId: "workspace-1",
    title: "Saved chat",
    createdAt: "now",
    updatedAt: "now",
    config: { model: "fixture-model", modeId: "default" },
  });
  let provider: ProviderSnapshotEntry = {
    provider: "fixture-provider",
    enabled: true,
    status: "ready",
    models: [{ provider: "fixture-provider", id: "fixture-model", label: "Model" }],
    modes: [{ id: "default", label: "Ask", description: "Ask" }],
  };
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-1",
    projectId: f.scope.projectId,
    cwd: f.repo,
    kind: "directory",
    displayName: "Fixture",
    createdAt: "now",
    updatedAt: "now",
  });
  const hasProvider = vi.fn(() => true);
  const getProvider = vi.fn<ScheduleNativePolicyPorts["providers"]["getProvider"]>(
    async () => provider,
  );
  const policy = new ScheduleNativePolicy({
    home: f.home,
    hostId: f.scope.hostId,
    hostLabel: "Fixture",
    metadata: f.metadata,
    storage: { get: async () => record },
    workspaces: { get: async () => workspace, list: async () => [workspace] },
    providers: { hasProvider, getProvider },
  });
  const target = { type: "agent" as const, agentId: record.id };
  const fresh = {
    type: "new-agent" as const,
    config: { provider: record.provider, cwd: f.repo, model: "fixture-model", modeId: "default" },
  };
  return {
    ...f,
    policy,
    target,
    fresh,
    hasProvider,
    getProvider,
    setRecord: (patch: Partial<typeof record>) => {
      record = { ...record, ...patch };
    },
    setProvider: (patch: Partial<ProviderSnapshotEntry>) => {
      provider = { ...provider, ...patch };
    },
    setWorkspace: (patch: Partial<typeof workspace>) => {
      workspace = { ...workspace, ...patch };
    },
  };
}
test("existing chats and new agents resolve through canonical project/workspace and provider owners", async () => {
  const f = await fixture();
  try {
    expect(await f.policy.validate(f.target, f.scope)).toBe("Saved chat");
    expect(await f.policy.validate(f.fresh, f.scope)).toBe("New agent");
    expect(f.getProvider).toHaveBeenLastCalledWith({
      provider: "fixture-provider",
      cwd: f.repo,
      wait: true,
    });
    const sub = path.join(f.repo, "subdirectory");
    await mkdir(sub);
    await f.policy.validate({ ...f.fresh, config: { ...f.fresh.config, cwd: sub } }, f.scope);
    f.setWorkspace({ cwd: f.other, kind: "worktree" });
    await f.policy.validate({ ...f.fresh, config: { ...f.fresh.config, cwd: f.other } }, f.scope);
  } finally {
    await f.cleanup();
  }
});
test("wrong host, archived projects/workspaces and cross-project chat identity fail before provider discovery", async () => {
  const f = await fixture();
  try {
    await expect(f.policy.validate(f.target, { ...f.scope, hostId: "other" })).rejects.toThrow(
      "owning Schedule host",
    );
    f.setWorkspace({ projectId: "project-2" });
    await expect(f.policy.validate(f.target, f.scope)).rejects.toThrow("active chat/workspace");
    f.setWorkspace({ projectId: f.scope.projectId, archivedAt: "now" });
    await expect(f.policy.validate(f.target, f.scope)).rejects.toThrow("active chat/workspace");
    f.put(f.scope.projectId, f.repo, { archivedAt: "now" });
    await expect(f.policy.validate(f.fresh, f.scope)).rejects.toThrow("Restore");
    expect(f.getProvider).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
test("directories and saved chat paths cannot escape a canonical project/workspace binding", async () => {
  const f = await fixture();
  try {
    await expect(
      f.policy.validate({ ...f.fresh, config: { ...f.fresh.config, cwd: f.other } }, f.scope),
    ).rejects.toThrow("canonical project");
    await expect(
      f.policy.validate(
        { ...f.fresh, config: { ...f.fresh.config, cwd: path.join(f.repo, "missing") } },
        f.scope,
      ),
    ).rejects.toThrow("Restore the selected working directory");
    f.setRecord({ cwd: f.other });
    await expect(f.policy.validate(f.target, f.scope)).rejects.toThrow("recorded workspace");
    expect(f.getProvider).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
test("provider and model changes produce safe repair or next-cadence errors without exposing diagnostics", async () => {
  const f = await fixture();
  try {
    f.hasProvider.mockReturnValueOnce(false);
    await expect(f.policy.validate(f.fresh, f.scope)).rejects.toMatchObject({ kind: "invalid" });
    f.setProvider({ enabled: false });
    await expect(f.policy.validate(f.fresh, f.scope)).rejects.toThrow(
      "Enable the selected provider",
    );
    f.setProvider({ enabled: true, status: "error", error: "secret diagnostic /unrelated/path" });
    await expect(f.policy.validate(f.fresh, f.scope)).rejects.toMatchObject({
      kind: "unavailable",
      message: expect.not.stringContaining("secret diagnostic"),
    });
    f.setProvider({ status: "ready", models: [] });
    await expect(f.policy.validate(f.fresh, f.scope)).rejects.toThrow("current provider catalog");
    f.setRecord({ archivedAt: "now" });
    await expect(f.policy.validate(f.target, f.scope)).rejects.toThrow("active target chat");
  } finally {
    await f.cleanup();
  }
});
test("unassigned legacy records stay host-owned while assigned records enforce their persisted project", async () => {
  const f = await fixture();
  try {
    const schedule: StoredSchedule = {
      id: "legacy",
      name: "Legacy",
      prompt: "Work",
      target: f.fresh,
      cadence: { type: "every", everyMs: 60000 },
      status: "active",
      createdAt: "now",
      updatedAt: "now",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      maxRuns: null,
      expiresAt: null,
      runs: [],
    };
    await f.policy.validateStored({
      ...schedule,
      target: { ...f.fresh, config: { ...f.fresh.config, cwd: f.other } },
    });
    await expect(
      f.policy.validateStored({
        ...schedule,
        otto: {
          version: 1,
          scope: { ...f.scope, hostId: "other" },
          location: "repository",
          storeKey: "origin",
        },
      }),
    ).rejects.toThrow("another host");
    await expect(
      f.policy.validateStored({
        ...schedule,
        otto: {
          version: 1,
          scope: { ...f.scope, projectId: "project-2" },
          location: "repository",
          storeKey: "origin",
        },
      }),
    ).rejects.toThrow("canonical project");
  } finally {
    await f.cleanup();
  }
});
test("Artifact instruction model validation uses the selected canonical project directory", async () => {
  const f = await fixture();
  try {
    await f.policy.validateSelection(
      { provider: "fixture-provider", model: "fixture-model" },
      { ...f.scope, projectId: "project-2" },
    );
    expect(f.getProvider).toHaveBeenLastCalledWith({
      provider: "fixture-provider",
      cwd: f.other,
      wait: true,
    });
    await expect(
      f.policy.validateSelection({ provider: "fixture-provider", model: "missing" }, f.scope),
    ).rejects.toThrow("current provider catalog");
  } finally {
    await f.cleanup();
  }
});
