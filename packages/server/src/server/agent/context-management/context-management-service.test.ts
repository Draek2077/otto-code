import { describe, expect, it } from "vitest";
import {
  ContextManagementService,
  createContextReportStore,
} from "./context-management-service.js";

describe("ContextManagementService project knowledge", () => {
  it("bypasses a fresh cached report on explicit refresh and caches the new answer", async () => {
    let catalogTokens = 14;
    const service = new ContextManagementService({
      logger: { warn: () => undefined } as never,
      resolveLocation: async () => ({ cwd: "/project", projectRoot: "/project" }),
      resolveRuntime: async () => ({ provider: "unknown" }),
      resolveProjectKnowledgeBrief: async () => ({ text: "Catalog", estTokens: catalogTokens }),
    });
    const input = { workspaceId: "workspace-1" };
    const original = await service.getReport(input);
    expect(original?.projectKnowledgeTokens).toBe(14);
    catalogTokens = 28;
    expect(await service.getReport(input)).toBe(original);
    const refreshed = await service.getReport({ ...input, forceRefresh: true });
    expect(refreshed?.projectKnowledgeTokens).toBe(28);
    expect(await service.getReport(input)).toBe(refreshed);
  });

  it("shares one build between concurrent identical requests", async () => {
    let builds = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new ContextManagementService({
      logger: { warn: () => undefined } as never,
      resolveLocation: async () => ({ cwd: "/project", projectRoot: "/project" }),
      resolveRuntime: async () => ({ provider: "unknown" }),
      resolveProjectKnowledgeBrief: async () => {
        builds += 1;
        await gate;
        return { text: "Catalog", estTokens: 14 };
      },
    });
    const input = { workspaceId: "workspace-1" };
    const first = service.getReport(input);
    const second = service.getReport(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(builds).toBe(1);
    expect(a).toBe(b);
  });

  it("does not cache a build that an invalidation overtook", async () => {
    let catalogTokens = 14;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new ContextManagementService({
      logger: { warn: () => undefined } as never,
      resolveLocation: async () => ({ cwd: "/project", projectRoot: "/project" }),
      resolveRuntime: async () => ({ provider: "unknown" }),
      resolveProjectKnowledgeBrief: async () => {
        const tokens = catalogTokens;
        if (tokens === 14) await gate;
        return { text: "Catalog", estTokens: tokens };
      },
    });
    const input = { workspaceId: "workspace-1" };
    const stale = service.getReport(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    service.invalidate("workspace-1");
    catalogTokens = 28;
    release();
    expect((await stale)?.projectKnowledgeTokens).toBe(14);
    expect((await service.getReport(input))?.projectKnowledgeTokens).toBe(28);
  });

  it("shares cached reports across instances that share a store", async () => {
    const store = createContextReportStore();
    let builds = 0;
    const make = () =>
      new ContextManagementService({
        logger: { warn: () => undefined } as never,
        resolveLocation: async () => ({ cwd: "/project", projectRoot: "/project" }),
        resolveRuntime: async () => ({ provider: "unknown" }),
        resolveProjectKnowledgeBrief: async () => {
          builds += 1;
          return { text: "Catalog", estTokens: 14 };
        },
        store,
      });
    const first = make();
    const second = make();
    const report = await first.getReport({ workspaceId: "workspace-1" });
    expect(await second.getReport({ workspaceId: "workspace-1" })).toBe(report);
    expect(builds).toBe(1);
    second.invalidate("workspace-1");
    await first.getReport({ workspaceId: "workspace-1" });
    expect(builds).toBe(2);
  });

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
