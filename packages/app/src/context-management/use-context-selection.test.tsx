/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContextNode, ContextReport } from "@otto-code/protocol/messages";
import { useContextSelection } from "./use-context-selection";

const node: ContextNode = {
  id: "CLAUDE.md",
  path: "/repo/CLAUDE.md",
  relPath: "CLAUDE.md",
  scope: "project",
  category: "context_files",
  costClass: "fixed",
  bytes: 400,
  estTokens: 100,
  alsoImportedByNodeIds: [],
  findings: [],
};

const report: ContextReport = {
  workspaceId: "workspace-1",
  provider: "claude",
  windowTokens: 200_000,
  scannedAt: "2026-09-04T00:00:00.000Z",
  confidence: "convention",
  supported: true,
  supportsImports: true,
  nodes: [node],
  edges: [],
  categoryTotals: [],
  fixedTotal: 100,
  conditionalTotal: 0,
  referencedTotal: 0,
  workingRoom: 199_900,
  aggregateSeverity: "ok",
  findings: [],
};

describe("useContextSelection", () => {
  it("starts compact on the sidebar, drills into a selected file, and backs out without losing it", async () => {
    const { result } = renderHook(() => useContextSelection({ report, isCompact: true }));

    await waitFor(() => expect(result.current.node?.id).toBe("CLAUDE.md"));
    expect(result.current.showsPane).toBe(false);

    act(() => result.current.selectNode(node));
    expect(result.current.showsPane).toBe(true);
    expect(result.current.highlightNodeId).toBe("CLAUDE.md");

    act(() => result.current.goBack());
    expect(result.current.showsPane).toBe(false);
    expect(result.current.node?.id).toBe("CLAUDE.md");
  });
});
