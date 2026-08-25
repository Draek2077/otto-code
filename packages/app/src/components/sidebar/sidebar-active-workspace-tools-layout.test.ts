import { describe, expect, it } from "vitest";
import {
  getWorkspaceToolsLabelVisibility,
  shouldFillWorkspaceTool,
} from "./sidebar-active-workspace-tools-layout";

describe("getWorkspaceToolsLabelVisibility", () => {
  const threeTools = { hasScripts: true, hasOpenInEditor: true };

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

  it("does not reserve a Scripts label when no scripts control renders", () => {
    expect(
      getWorkspaceToolsLabelVisibility({
        width: 271,
        hasScripts: false,
        hasOpenInEditor: true,
      }),
    ).toEqual({
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
