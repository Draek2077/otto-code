import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentManager } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import { createOttoToolCatalog, resolveCaptureTerminalStart } from "./otto-tools.js";
import type { OttoToolCatalog } from "./types.js";

// Every cap here bounds text that lands verbatim in a model's context and is
// replayed on every following round. The tests assert the boundary, not the
// exact wording of the marker beyond the pointer the model needs to get more.

function buildCatalog(input: {
  agentManager?: Partial<AgentManager>;
  terminalManager?: Partial<TerminalManager>;
}): OttoToolCatalog {
  const agentManager = {
    getAgent: vi.fn(() => ({ cwd: process.cwd(), labels: {}, config: {} })),
    ...input.agentManager,
  } as unknown as AgentManager;
  return createOttoToolCatalog({
    agentManager,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    terminalManager: input.terminalManager as TerminalManager | undefined,
    callerAgentId: "caller-agent",
    logger: createTestLogger(),
  });
}

function structured<T>(result: { structuredContent?: unknown }): T {
  return result.structuredContent as T;
}

describe("get_agent_activity limit ceiling", () => {
  test("rejects a limit above the ceiling instead of dumping the whole transcript", async () => {
    const catalog = buildCatalog({});

    await expect(
      catalog.executeTool("get_agent_activity", { agentId: "a", limit: 501 }),
    ).rejects.toThrow();
  });

  test("accepts a limit at the ceiling", () => {
    const shape = buildCatalog({}).getTool("get_agent_activity")?.inputSchema as z.ZodRawShape;
    const schema = z.object(shape);

    expect(schema.safeParse({ agentId: "a", limit: 500 }).success).toBe(true);
    expect(schema.safeParse({ agentId: "a", limit: 501 }).success).toBe(false);
    expect(schema.safeParse({ agentId: "a" }).success).toBe(true);
  });
});

describe("wait_for_agents last-message cap", () => {
  function waitCatalog(lastMessage: string): OttoToolCatalog {
    return buildCatalog({
      agentManager: {
        waitForAgentEvent: vi.fn(async () => ({ status: "idle" as const, lastMessage })),
      } as unknown as Partial<AgentManager>,
    });
  }

  test("caps each agent's final message head/tail and points at the full copy", async () => {
    const message = `${"H".repeat(3_200)}${"M".repeat(50_000)}${"T".repeat(800)}`;
    const result = await waitCatalog(message).executeTool("wait_for_agents", {
      agentIds: ["agent-1"],
    });

    const { results } = structured<{ results: Array<{ lastMessage: string }> }>(result);
    expect(results).toHaveLength(1);
    const capped = results[0]?.lastMessage ?? "";
    expect(capped.length).toBeLessThan(4_200);
    expect(capped.startsWith("H".repeat(3_200))).toBe(true);
    expect(capped.endsWith("T".repeat(800))).toBe(true);
    expect(capped).toContain("call get_agent_activity for the rest");
  });

  test("leaves a short final message verbatim", async () => {
    const result = await waitCatalog("All tests pass.").executeTool("wait_for_agents", {
      agentIds: ["agent-1"],
    });

    const { results } = structured<{ results: Array<{ lastMessage: string }> }>(result);
    expect(results[0]?.lastMessage).toBe("All tests pass.");
  });
});

describe("capture_terminal scrollback window", () => {
  test("scrollback with no range asks for the last 300 lines, not the whole buffer", async () => {
    const captureTerminal = vi.fn(async () => ({ lines: ["out"], totalLines: 1 }));
    const catalog = buildCatalog({
      terminalManager: {
        getTerminal: vi.fn(() => ({}) as never),
        captureTerminal,
      } as unknown as Partial<TerminalManager>,
    });

    await catalog.executeTool("capture_terminal", { terminalId: "t1", scrollback: true });

    expect(captureTerminal).toHaveBeenCalledWith("t1", {
      start: -300,
      end: undefined,
      stripAnsi: true,
    });
  });

  test("an explicit start still selects the whole buffer", async () => {
    const captureTerminal = vi.fn(async () => ({ lines: [], totalLines: 0 }));
    const catalog = buildCatalog({
      terminalManager: {
        getTerminal: vi.fn(() => ({}) as never),
        captureTerminal,
      } as unknown as Partial<TerminalManager>,
    });

    await catalog.executeTool("capture_terminal", {
      terminalId: "t1",
      scrollback: true,
      start: 0,
    });

    expect(captureTerminal).toHaveBeenCalledWith("t1", {
      start: 0,
      end: undefined,
      stripAnsi: true,
    });
  });

  test("the tool description names the new default so the model can opt out", () => {
    const catalog = buildCatalog({
      terminalManager: {
        getTerminal: vi.fn(() => ({}) as never),
        captureTerminal: vi.fn(),
      } as unknown as Partial<TerminalManager>,
    });

    expect(catalog.getTool("capture_terminal")?.description).toContain("last 300 lines");
  });
});

describe("resolveCaptureTerminalStart", () => {
  test("passes start through untouched without scrollback", () => {
    expect(
      resolveCaptureTerminalStart({ start: undefined, end: undefined, scrollback: false }),
    ).toBeUndefined();
    expect(resolveCaptureTerminalStart({ start: 5, end: undefined, scrollback: undefined })).toBe(
      5,
    );
  });

  test("defaults to the tail window only when neither bound is given", () => {
    expect(
      resolveCaptureTerminalStart({ start: undefined, end: undefined, scrollback: true }),
    ).toBe(-300);
    expect(resolveCaptureTerminalStart({ start: 12, end: undefined, scrollback: true })).toBe(12);
    expect(resolveCaptureTerminalStart({ start: undefined, end: 40, scrollback: true })).toBe(0);
  });
});
