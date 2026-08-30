import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { createOttoToolCatalog } from "./otto-tools.js";

describe("Architectural View authoring tools", () => {
  it("exposes a bound chat's draft specification and updates only that draft", async () => {
    const updateDraftSpecification = vi.fn().mockResolvedValue({
      id: "draft-one",
      viewId: "workflows",
      title: "Workflows overview",
      updatedAt: "2026-08-29T00:00:00.000Z",
    });
    const catalog = createOttoToolCatalog({
      agentManager: {
        getAgent: vi.fn(() => ({ cwd: "/project", labels: {}, config: { cwd: "/project" } })),
      } as never,
      agentStorage: {} as never,
      providerSnapshotManager: {} as never,
      callerAgentId: "author-agent",
      architecturalViews: {
        getDraftContent: vi.fn().mockResolvedValue({
          draft: { authoringAgentId: "author-agent" },
        }),
        getDraftSpecification: vi.fn().mockResolvedValue({
          draft: { title: "Workflows overview", updatedAt: "2026-08-29T00:00:00.000Z" },
          specification: { title: "Workflow topology" },
        }),
        updateDraftSpecification,
      } as never,
      logger: pino({ enabled: false }),
    });

    expect(catalog.getTool("read_architectural_view_draft")).toBeDefined();
    const read = await catalog.executeTool("read_architectural_view_draft", {
      viewId: "workflows",
      draftId: "draft-one",
    });
    expect(read.structuredContent).toEqual(
      expect.objectContaining({ specification: { title: "Workflow topology" } }),
    );

    await catalog.executeTool("update_architectural_view_draft", {
      viewId: "workflows",
      draftId: "draft-one",
      specification: { title: "Workflow topology v2" },
    });
    expect(updateDraftSpecification).toHaveBeenCalledWith({
      cwd: "/project",
      viewId: "workflows",
      draftId: "draft-one",
      specification: { title: "Workflow topology v2" },
    });
  });

  it("refuses a different chat's staged document", async () => {
    const catalog = createOttoToolCatalog({
      agentManager: {
        getAgent: vi.fn(() => ({ cwd: "/project", labels: {}, config: { cwd: "/project" } })),
      } as never,
      agentStorage: {} as never,
      providerSnapshotManager: {} as never,
      callerAgentId: "other-agent",
      architecturalViews: {
        getDraftContent: vi.fn().mockResolvedValue({ draft: { authoringAgentId: "author-agent" } }),
      } as never,
      logger: pino({ enabled: false }),
    });

    await expect(
      catalog.executeTool("read_architectural_view_draft", {
        viewId: "workflows",
        draftId: "draft-one",
      }),
    ).rejects.toThrow("not the bound authoring chat");
  });

  it("opens a published visual for the requesting workspace instead of returning HTML", async () => {
    const openArchitecturalView = vi.fn();
    const catalog = createOttoToolCatalog({
      agentManager: {
        getAgent: vi.fn(() => ({
          workspaceId: "workspace-one",
          config: { cwd: "/project" },
        })),
      } as never,
      agentStorage: {} as never,
      providerSnapshotManager: {} as never,
      callerAgentId: "author-agent",
      architecturalViews: {
        getContent: vi.fn().mockResolvedValue({
          view: { title: "Workflows overview", sourceStatus: "current" },
          html: "<html>not returned to the chat</html>",
        }),
      } as never,
      openArchitecturalView,
      logger: pino({ enabled: false }),
    });

    const result = await catalog.executeTool("show_architectural_view", { viewId: "workflows" });

    expect(openArchitecturalView).toHaveBeenCalledWith({
      agentId: "author-agent",
      workspaceId: "workspace-one",
      viewId: "workflows",
    });
    expect(result.structuredContent).toEqual({
      viewId: "workflows",
      title: "Workflows overview",
      sourceStatus: "current",
    });
  });
});
