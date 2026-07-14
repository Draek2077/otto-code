import { describe, expect, it } from "vitest";
import type { WorkspaceFileOrigin } from "@/workspace/file-open";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";

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
