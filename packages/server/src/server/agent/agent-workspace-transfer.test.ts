import { describe, expect, test, vi } from "vitest";
import type { StoredAgentRecord } from "./agent-storage.js";
import {
  transferAgentWorkspaceCommand,
  type AgentWorkspaceTransferDependencies,
  type TransferTargetWorkspace,
} from "./agent-workspace-transfer.js";

function storedRecord(workspaceId: string): StoredAgentRecord {
  return { id: "agent_1", cwd: "/repos/otto", workspaceId } as StoredAgentRecord;
}

function deps(
  overrides: {
    agent?: { workspaceId: string | undefined } | null;
    workspace?: TransferTargetWorkspace | null;
  } = {},
) {
  const agent = overrides.agent === undefined ? { workspaceId: "wks_source" } : overrides.agent;
  const workspace =
    overrides.workspace === undefined
      ? { workspaceId: "wks_target", archivedAt: null }
      : overrides.workspace;
  const transfer = vi.fn(async (_agentId: string, workspaceId: string) => ({
    record: storedRecord(workspaceId),
    live: true,
  }));
  const dependencies: AgentWorkspaceTransferDependencies = {
    getAgentWorkspaceId: async () => agent,
    getWorkspace: async () => workspace,
    transfer,
  };
  return { dependencies, transfer };
}

const REQUEST = { agentId: "agent_1", workspaceId: "wks_target" };

describe("transferAgentWorkspaceCommand", () => {
  test("re-stamps ownership onto the target workspace", async () => {
    const { dependencies, transfer } = deps();

    const result = await transferAgentWorkspaceCommand(dependencies, REQUEST);

    expect(result).toMatchObject({
      status: "transferred",
      live: true,
      previousWorkspaceId: "wks_source",
      workspaceId: "wks_target",
    });
    expect(transfer).toHaveBeenCalledWith("agent_1", "wks_target");
  });

  test("moves into a workspace over a different directory, and into another project", async () => {
    // The whole point of the feature. A chat keeps running where it was started;
    // which workspace *shows* it is a separate question, and the daemon has never
    // required cwd and workspace directory to agree.
    const { dependencies, transfer } = deps({
      workspace: { workspaceId: "wks_other_project", archivedAt: null },
    });

    const result = await transferAgentWorkspaceCommand(dependencies, {
      agentId: "agent_1",
      workspaceId: "wks_other_project",
    });

    expect(result.status).toBe("transferred");
    expect(transfer).toHaveBeenCalledWith("agent_1", "wks_other_project");
  });

  test("treats a move to the workspace it already lives in as success, not an error", async () => {
    const { dependencies, transfer } = deps({ agent: { workspaceId: "wks_target" } });

    const result = await transferAgentWorkspaceCommand(dependencies, REQUEST);

    expect(result).toEqual({ status: "unchanged", workspaceId: "wks_target" });
    expect(transfer).not.toHaveBeenCalled();
  });

  test("moves a legacy chat that was never stamped with an owner", async () => {
    const { dependencies } = deps({ agent: { workspaceId: undefined } });

    const result = await transferAgentWorkspaceCommand(dependencies, REQUEST);

    expect(result).toMatchObject({ status: "transferred", previousWorkspaceId: null });
  });

  test("refuses when the chat does not exist", async () => {
    const { dependencies, transfer } = deps({ agent: null });

    const result = await transferAgentWorkspaceCommand(dependencies, REQUEST);

    expect(result).toEqual({ status: "refused", error: "Chat not found" });
    expect(transfer).not.toHaveBeenCalled();
  });

  test("refuses when the target workspace does not exist", async () => {
    const { dependencies, transfer } = deps({ workspace: null });

    const result = await transferAgentWorkspaceCommand(dependencies, REQUEST);

    expect(result).toEqual({ status: "refused", error: "Workspace not found" });
    expect(transfer).not.toHaveBeenCalled();
  });

  test("refuses an archived target", async () => {
    const { dependencies, transfer } = deps({
      workspace: { workspaceId: "wks_target", archivedAt: "2026-07-29T00:00:00.000Z" },
    });

    const result = await transferAgentWorkspaceCommand(dependencies, REQUEST);

    expect(result).toEqual({ status: "refused", error: "That workspace has been archived" });
    expect(transfer).not.toHaveBeenCalled();
  });

  test("refuses a hidden target so a chat cannot be stranded in schedule scaffolding", async () => {
    const { dependencies, transfer } = deps({
      workspace: { workspaceId: "wks_target", archivedAt: null, hidden: true },
    });

    const result = await transferAgentWorkspaceCommand(dependencies, REQUEST);

    expect(result).toEqual({ status: "refused", error: "That workspace is not available" });
    expect(transfer).not.toHaveBeenCalled();
  });
});
