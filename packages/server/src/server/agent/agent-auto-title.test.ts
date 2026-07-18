import { afterEach, describe, expect, test, vi } from "vitest";
import type pino from "pino";

import { AgentAutoTitle, type AgentAutoTitleRequest } from "./agent-auto-title.js";
import type { generateAgentTitleFromFirstAgentContext } from "./agent-title-generator.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import type { StoredAgentRecord } from "./agent-storage.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";

interface Harness {
  autoTitle: AgentAutoTitle;
  setTitle: ReturnType<typeof vi.fn>;
  generate: ReturnType<typeof vi.fn>;
}

function createHarness(options: {
  generatedTitle: string | null;
  storedTitle: string | null | undefined; // undefined => agent record missing
}): Harness {
  const setTitle = vi.fn(async () => {});
  const generate = vi.fn(
    async () => options.generatedTitle,
  ) as unknown as typeof generateAgentTitleFromFirstAgentContext;

  const agentManager = { setTitle } as unknown as AgentManager;
  const agentStorage: Pick<AgentStorage, "get"> = {
    get: async () =>
      options.storedTitle === undefined
        ? null
        : ({ id: "agent-1", title: options.storedTitle } as StoredAgentRecord),
  };
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as pino.Logger;

  const autoTitle = new AgentAutoTitle({
    agentManager,
    agentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    workspaceGitService: { resolveRepoRoot: async (cwd: string) => cwd } as Pick<
      WorkspaceGitService,
      "resolveRepoRoot"
    >,
    logger,
    generateAgentTitle: generate,
  });
  return { autoTitle, setTitle, generate: generate as unknown as ReturnType<typeof vi.fn> };
}

const REQUEST: AgentAutoTitleRequest = {
  agentId: "agent-1",
  cwd: "/tmp/repo",
  firstAgentContext: { prompt: "Fix the login flow" },
  provisionalTitle: "Fix the login flow",
};

afterEach(() => {
  vi.useRealTimers();
});

async function runScheduled(harness: Harness, request: AgentAutoTitleRequest): Promise<void> {
  vi.useFakeTimers();
  harness.autoTitle.schedule(request);
  await vi.runAllTimersAsync();
}

describe("AgentAutoTitle", () => {
  test("overwrites the provisional first-line title with the generated short title", async () => {
    const harness = createHarness({
      generatedTitle: "Login flow",
      storedTitle: "Fix the login flow",
    });
    await runScheduled(harness, REQUEST);
    expect(harness.setTitle).toHaveBeenCalledWith("agent-1", "Login flow");
  });

  test("writes a title even when the chat has no title yet", async () => {
    const harness = createHarness({ generatedTitle: "Login flow", storedTitle: null });
    await runScheduled(harness, { ...REQUEST, provisionalTitle: null });
    expect(harness.setTitle).toHaveBeenCalledWith("agent-1", "Login flow");
  });

  test("does NOT overwrite a title the user renamed away from the provisional", async () => {
    const harness = createHarness({ generatedTitle: "Login flow", storedTitle: "My careful name" });
    await runScheduled(harness, REQUEST);
    expect(harness.setTitle).not.toHaveBeenCalled();
  });

  test("does nothing when generation yields no title", async () => {
    const harness = createHarness({ generatedTitle: null, storedTitle: "Fix the login flow" });
    await runScheduled(harness, REQUEST);
    expect(harness.setTitle).not.toHaveBeenCalled();
  });

  test("skips the write when the generated title already matches the current one", async () => {
    const harness = createHarness({
      generatedTitle: "Fix the login flow",
      storedTitle: "Fix the login flow",
    });
    await runScheduled(harness, REQUEST);
    expect(harness.setTitle).not.toHaveBeenCalled();
  });

  test("does nothing when the chat record no longer exists", async () => {
    const harness = createHarness({ generatedTitle: "Login flow", storedTitle: undefined });
    await runScheduled(harness, REQUEST);
    expect(harness.setTitle).not.toHaveBeenCalled();
  });
});
