import { describe, expect, it } from "vitest";
import {
  getWorkspaceToolsLabelVisibility,
  shouldFillWorkspaceTool,
} from "./sidebar-active-workspace-tools-layout";

describe("getWorkspaceToolsLabelVisibility", () => {
  const threeTools = { availableTools: ["scripts", "git", "openInEditor"] as const };

  it("keeps every tool icon-only at the smallest usable width", () => {
    expect(getWorkspaceToolsLabelVisibility({ width: 303, ...threeTools })).toEqual({
      scripts: false,
      git: false,
      openInEditor: false,
    });
  });

  it("reveals labels in a useful order as room becomes available", () => {
    expect(getWorkspaceToolsLabelVisibility({ width: 304, ...threeTools })).toEqual({
      scripts: true,
      git: false,
      openInEditor: false,
    });
    expect(getWorkspaceToolsLabelVisibility({ width: 356, ...threeTools })).toEqual({
      scripts: true,
      git: true,
      openInEditor: false,
    });
    expect(getWorkspaceToolsLabelVisibility({ width: 392, ...threeTools })).toEqual({
      scripts: true,
      git: true,
      openInEditor: true,
    });
  });

  it("does not reserve space for controls that do not render", () => {
    expect(
      getWorkspaceToolsLabelVisibility({
        width: 235,
        availableTools: ["git", "openInEditor"],
      }),
    ).toEqual({
      scripts: false,
      git: false,
      openInEditor: false,
    });
    expect(
      getWorkspaceToolsLabelVisibility({
        width: 236,
        availableTools: ["git", "openInEditor"],
      }),
    ).toEqual({
      scripts: false,
      git: true,
      openInEditor: false,
    });
  });

  it("reveals the lone tool's label without reserving absent siblings", () => {
    expect(getWorkspaceToolsLabelVisibility({ width: 164, availableTools: ["git"] })).toEqual({
      scripts: false,
      git: true,
      openInEditor: false,
    });
  });

  it("shares an icon-only row, then gives the revealed tools its available space", () => {
    const iconOnly = getWorkspaceToolsLabelVisibility({ width: 303, ...threeTools });
    expect(shouldFillWorkspaceTool(iconOnly, "scripts")).toBe(true);
    expect(shouldFillWorkspaceTool(iconOnly, "git")).toBe(true);

    const scriptsOnly = getWorkspaceToolsLabelVisibility({ width: 304, ...threeTools });
    expect(shouldFillWorkspaceTool(scriptsOnly, "scripts")).toBe(true);
    expect(shouldFillWorkspaceTool(scriptsOnly, "git")).toBe(false);
  });
});
