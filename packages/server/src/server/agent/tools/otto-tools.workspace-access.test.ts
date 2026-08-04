import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentManager } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { createOttoToolCatalog } from "./otto-tools.js";

// The workspace-access ceiling is enforced at catalog registration so every
// consumer - the MCP server serving CLI providers, openai-compat's native tool
// loop - inherits it identically. These tests build the catalog the way an
// agent session does and ask the enforcement question directly: is the tool
// even THERE?

function catalogToolNames(workspaceAccess?: string): Set<string> {
  const agentManager = {
    getAgent: vi.fn(() => ({
      cwd: process.cwd(),
      labels: {},
      config: workspaceAccess === undefined ? {} : { workspaceAccess },
    })),
  } as unknown as AgentManager;
  const catalog = createOttoToolCatalog({
    agentManager,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    callerAgentId: "caller-agent",
    logger: createTestLogger(),
  });
  return new Set(catalog.tools.keys());
}

describe("otto tool catalog workspace-access gate", () => {
  test("no declared access keeps the full catalog - pre-feature agents are unaffected", () => {
    const names = catalogToolNames();
    for (const tool of [
      "create_terminal",
      "send_terminal_keys",
      "create_worktree",
      "create_artifact",
    ]) {
      expect(names.has(tool)).toBe(true);
    }
  });

  test('"read" withholds the shell surface but keeps the rest', () => {
    const names = catalogToolNames("read");
    for (const tool of ["create_terminal", "send_terminal_keys", "kill_terminal"]) {
      expect(names.has(tool)).toBe(false);
    }
    for (const tool of ["capture_terminal", "create_worktree", "create_artifact", "create_agent"]) {
      expect(names.has(tool)).toBe(true);
    }
  });

  test('"none" withholds terminals and the workspace/worktree/artifact mutators', () => {
    const names = catalogToolNames("none");
    for (const tool of [
      "create_terminal",
      "send_terminal_keys",
      "kill_terminal",
      "list_terminals",
      "capture_terminal",
      "create_worktree",
      "archive_worktree",
      "list_worktrees",
      "create_workspace",
      "archive_workspace",
      "list_workspaces",
      "rename_workspace",
      "create_artifact",
      "update_artifact",
      "generate_artifact",
    ]) {
      expect(names.has(tool)).toBe(false);
    }
    // The orchestration axis is separate: a "none" reviewer node still
    // reports, coordinates, and reads artifact state.
    for (const tool of ["create_agent", "wait_for_agents", "list_artifacts", "inspect_artifact"]) {
      expect(names.has(tool)).toBe(true);
    }
  });
});
