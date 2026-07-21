import { describe, expect, it } from "vitest";
import type { WorkspaceFileOrigin } from "@/workspace/file-open";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "@/workspace-tabs/identity";

const ORIGIN: WorkspaceFileOrigin = {
  workspaceId: "ws_other",
  cwd: "/repos/other",
  projectId: "proj_other",
  projectName: "Other",
};

describe("normalizeWorkspaceTabTarget file origin", () => {
  it("preserves the origin of a cross-project file tab", () => {
    const normalized = normalizeWorkspaceTabTarget({
      kind: "file",
      path: "src/index.ts",
      origin: ORIGIN,
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.kind).toBe("file");
    if (normalized?.kind === "file") {
      expect(normalized.path).toBe("src/index.ts");
      expect(normalized.origin).toEqual(ORIGIN);
    }
  });

  it("omits origin for an ordinary in-project file tab", () => {
    const normalized = normalizeWorkspaceTabTarget({
      kind: "file",
      path: "src/index.ts",
    });
    expect(normalized?.kind).toBe("file");
    if (normalized?.kind === "file") {
      expect(normalized.origin).toBeUndefined();
    }
  });
});

describe("fileHistory tab targets", () => {
  it("keeps a complete line scope", () => {
    const normalized = normalizeWorkspaceTabTarget({
      kind: "fileHistory",
      path: "src/index.ts",
      startLine: 10,
      endLine: 20,
    });
    expect(normalized).toEqual({
      kind: "fileHistory",
      path: "src/index.ts",
      startLine: 10,
      endLine: 20,
    });
  });

  // A half-specified or inverted range still names a file worth investigating,
  // so it degrades to whole-file rather than dropping the tab entirely.
  it("degrades an unusable line scope to whole file", () => {
    expect(
      normalizeWorkspaceTabTarget({ kind: "fileHistory", path: "src/index.ts", startLine: 10 }),
    ).toEqual({ kind: "fileHistory", path: "src/index.ts" });
    expect(
      normalizeWorkspaceTabTarget({
        kind: "fileHistory",
        path: "src/index.ts",
        startLine: 20,
        endLine: 10,
      }),
    ).toEqual({ kind: "fileHistory", path: "src/index.ts" });
  });

  it("rejects a target with no path", () => {
    expect(normalizeWorkspaceTabTarget({ kind: "fileHistory", path: "   " })).toBeNull();
  });

  // Whole-file history and a line-scoped history are different questions, so
  // opening one must not steal the other's tab.
  it("treats whole-file and scoped history as separate tabs", () => {
    const wholeFile = { kind: "fileHistory", path: "a.ts" } as const;
    const scoped = { kind: "fileHistory", path: "a.ts", startLine: 1, endLine: 5 } as const;
    expect(workspaceTabTargetsEqual(wholeFile, wholeFile)).toBe(true);
    expect(workspaceTabTargetsEqual(wholeFile, scoped)).toBe(false);
    expect(buildDeterministicWorkspaceTabId(wholeFile)).not.toBe(
      buildDeterministicWorkspaceTabId(scoped),
    );
  });
});
