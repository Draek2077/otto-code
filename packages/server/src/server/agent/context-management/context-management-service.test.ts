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

/**
 * The disclosure contract: a category Otto cannot measure is a row that says
 * so, never a zero. What decides it is the adapter's `ownsContextPayload`
 * capability - not the provider's id, which for the OpenAI-compatible family
 * is different on every host.
 */
describe("ContextManagementService category visibility", () => {
  function createService(runtime: Record<string, unknown>) {
    return new ContextManagementService({
      logger: { warn: () => undefined } as never,
      resolveLocation: async () => ({ cwd: "/project", projectRoot: "/project" }),
      resolveRuntime: async () => runtime as never,
    });
  }

  function visibilityOf(
    report: Awaited<ReturnType<ContextManagementService["getReport"]>>,
    category: string,
  ): string | undefined {
    return report?.categoryTotals.find((total) => total.category === category)?.visibility;
  }

  it("reports the preset and tool schemas as exact for a payload-owning provider", async () => {
    const service = createService({
      provider: "otto-brain",
      ownsContextPayload: true,
      systemPromptText: "You are a coding agent running inside Otto.",
      mcpToolsText: '[{"type":"function","function":{"name":"read_file"}}]',
    });

    const report = await service.getReport({ workspaceId: "workspace-1" });
    expect(visibilityOf(report, "system_prompt")).toBe("exact");
    expect(visibilityOf(report, "mcp_tools")).toBe("exact");
  });

  it("reports them as not visible for a provider that composes its own request", async () => {
    const service = createService({ provider: "codex", injectedPromptText: "Agent prompt." });

    const report = await service.getReport({ workspaceId: "workspace-1" });
    expect(visibilityOf(report, "system_prompt")).toBe("not_visible");
    expect(visibilityOf(report, "mcp_tools")).toBe("not_visible");
  });

  it("scans context files for a payload-owning provider whatever its id", async () => {
    const service = createService({
      provider: "my-local-endpoint",
      ownsContextPayload: true,
    });

    const report = await service.getReport({ workspaceId: "workspace-1" });
    expect(report?.supported).toBe(true);
    expect(report?.supportsImports).toBe(true);
  });
});
