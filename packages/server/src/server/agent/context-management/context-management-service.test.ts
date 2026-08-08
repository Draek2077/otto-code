import { describe, expect, it } from "vitest";
import { ContextManagementService } from "./context-management-service.js";

describe("ContextManagementService project knowledge", () => {
  it("counts and previews the same catalog injected at chat start", async () => {
    const service = new ContextManagementService({
      logger: { warn: () => undefined } as never,
      resolveLocation: async () => ({ cwd: "/project", projectRoot: "/project" }),
      resolveRuntime: async () => ({ provider: "unknown", injectedPromptText: "Agent prompt." }),
      resolveProjectKnowledgeBrief: async () => ({
        text: "## Project knowledge catalog\n\n- [[daemon-owns-memory]]",
        estTokens: 14,
      }),
    });

    const report = await service.getReport({ workspaceId: "workspace-1" });
    expect(report?.projectKnowledgeTokens).toBe(14);
    expect(
      report?.categoryTotals.find((total) => total.category === "otto_injected")?.estTokens,
    ).toBeGreaterThan(14);

    const preview = await service.getPromptPreview({
      workspaceId: "workspace-1",
      category: "otto_injected",
    });
    expect(preview?.sections[0]?.text).toContain("[[daemon-owns-memory]]");
    expect(preview?.sections[0]?.text).toContain("Agent prompt.");
  });
});
