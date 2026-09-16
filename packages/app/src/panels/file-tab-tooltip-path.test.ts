import { describe, expect, it } from "vitest";
import { formatFileTabTooltipPath } from "./file-tab-tooltip-path";

const ORIGIN = { workspaceId: "w2", projectId: "p2" };

describe("formatFileTabTooltipPath", () => {
  it("keeps a workspace-relative path as is", () => {
    expect(formatFileTabTooltipPath({ path: "src/app.ts" }, "/repo")).toBe("src/app.ts");
  });

  it("relativizes an absolute path inside the workspace", () => {
    expect(formatFileTabTooltipPath({ path: "/repo/src/app.ts" }, "/repo/")).toBe("src/app.ts");
  });

  it("relativizes Windows paths case-insensitively", () => {
    expect(
      formatFileTabTooltipPath(
        { path: "c:/Users/me/Repo/src/app.ts" },
        String.raw`C:\Users\me\repo`,
      ),
    ).toBe("src/app.ts");
  });

  it("keeps the full path for a file outside the workspace", () => {
    expect(formatFileTabTooltipPath({ path: "/other/notes.md" }, "/repo")).toBe("/other/notes.md");
    expect(formatFileTabTooltipPath({ path: "/repo-two/a.ts" }, "/repo")).toBe("/repo-two/a.ts");
  });

  it("shows the full path for a file served from another origin", () => {
    expect(
      formatFileTabTooltipPath(
        { path: "plan.md", origin: { ...ORIGIN, cwd: String.raw`C:\Users\me\.claude\plans` } },
        "C:/Users/me/repo",
      ),
    ).toBe("C:/Users/me/.claude/plans/plan.md");
  });
});
