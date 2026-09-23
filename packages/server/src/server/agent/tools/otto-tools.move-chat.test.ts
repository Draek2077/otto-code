import { describe, expect, test, vi } from "vitest";
import { ottoToolGroupForName } from "@otto-code/protocol/provider-config";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentManager } from "../agent-manager.js";
import type { StoredAgentRecord } from "../agent-storage.js";
import type { AgentStorage } from "../agent-storage.js";
import type { AgentWorkspaceTransferResult } from "../agent-workspace-transfer.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { isOttoToolAllowedForAccess } from "../workspace-access.js";
import { createOttoToolCatalog } from "./otto-tools.js";

function catalog(callerAgentId?: string) {
  const moveChatToWorkspace = vi.fn(
    async (): Promise<AgentWorkspaceTransferResult> => ({
      status: "transferred" as const,
      workspaceId: "target",
      previousWorkspaceId: "source",
      live: true,
      record: { id: "chat", cwd: "/repo", workspaceId: "target" } as StoredAgentRecord,
    }),
  );
  const tools = createOttoToolCatalog({
    agentManager: { getAgent: () => null } as unknown as AgentManager,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    moveChatToWorkspace,
    callerAgentId,
    logger: createTestLogger(),
  });
  return { tools, moveChatToWorkspace };
}

describe("move_chat_to_workspace", () => {
  test("belongs to workspace tools and is withheld from no-workspace agents", () => {
    expect(ottoToolGroupForName("move_chat_to_workspace")).toBe("workspace");
    expect(isOttoToolAllowedForAccess("move_chat_to_workspace", "none")).toBe(false);
  });

  test("moves the calling chat by default and reports the ownership change", async () => {
    const { tools, moveChatToWorkspace } = catalog("chat");
    const result = await tools.executeTool("move_chat_to_workspace", { workspaceId: "target" });

    expect(moveChatToWorkspace).toHaveBeenCalledWith({ agentId: "chat", workspaceId: "target" });
    expect(result.structuredContent).toEqual({
      agentId: "chat",
      workspaceId: "target",
      previousWorkspaceId: "source",
      moved: true,
    });
  });

  test("accepts an explicit chat id outside a chat session", async () => {
    const { tools, moveChatToWorkspace } = catalog();
    await tools.executeTool("move_chat_to_workspace", {
      agentId: "other",
      workspaceId: "target",
    });
    expect(moveChatToWorkspace).toHaveBeenCalledWith({ agentId: "other", workspaceId: "target" });
  });

  test("requires a chat id when there is no calling chat", async () => {
    const { tools, moveChatToWorkspace } = catalog();
    await expect(
      tools.executeTool("move_chat_to_workspace", { workspaceId: "target" }),
    ).rejects.toThrow("agentId is required");
    expect(moveChatToWorkspace).not.toHaveBeenCalled();
  });

  test("surfaces destination refusal without claiming a move", async () => {
    const { tools, moveChatToWorkspace } = catalog("chat");
    moveChatToWorkspace.mockResolvedValueOnce({
      status: "refused",
      error: "That workspace has been archived",
    });
    await expect(
      tools.executeTool("move_chat_to_workspace", { workspaceId: "archived" }),
    ).rejects.toThrow("That workspace has been archived");
  });

  test("reports an already-correct destination as unchanged", async () => {
    const { tools, moveChatToWorkspace } = catalog("chat");
    moveChatToWorkspace.mockResolvedValueOnce({ status: "unchanged", workspaceId: "target" });
    const result = await tools.executeTool("move_chat_to_workspace", { workspaceId: "target" });
    expect(result.structuredContent).toEqual({
      agentId: "chat",
      workspaceId: "target",
      previousWorkspaceId: "target",
      moved: false,
    });
  });
});
