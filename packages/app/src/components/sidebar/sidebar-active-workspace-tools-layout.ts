export type WorkspaceTool = "scripts" | "openInEditor" | "git";

export interface WorkspaceToolsLabelVisibility {
  scripts: boolean;
  openInEditor: boolean;
  git: boolean;
}

interface GetWorkspaceToolsLabelVisibilityOptions {
  width: number;
  availableTools: readonly WorkspaceTool[];
}

// The icon-only controls remain comfortably targetable at this width. As room
// becomes available, labels consume only their measured-content allowance and
// open from left to right, rather than requiring every button to reserve a
// full 128px before any text can appear.
const ICON_ONLY_TOOL_WIDTH = 72;
const ROW_HORIZONTAL_CHROME_WIDTH = 40;
const LABEL_WIDTH: Record<WorkspaceTool, number> = {
  scripts: 48,
  git: 52,
  openInEditor: 36,
};

export function getWorkspaceToolsLabelVisibility({
  width,
  availableTools,
}: GetWorkspaceToolsLabelVisibilityOptions): WorkspaceToolsLabelVisibility {
  const labels: WorkspaceToolsLabelVisibility = {
    scripts: false,
    openInEditor: false,
    git: false,
  };

  // Width zero means the hidden sidebar has not been measured. Keep that
  // first frame compact, then let the measured row progressively reveal text.
  let requiredWidth = ROW_HORIZONTAL_CHROME_WIDTH + availableTools.length * ICON_ONLY_TOOL_WIDTH;
  for (const tool of availableTools) {
    requiredWidth += LABEL_WIDTH[tool];
    if (width < requiredWidth) break;
    labels[tool] = true;
  }

  return labels;
}

export function shouldFillWorkspaceTool(
  labels: WorkspaceToolsLabelVisibility,
  tool: WorkspaceTool,
): boolean {
  return labels[tool] || (!labels.scripts && !labels.openInEditor && !labels.git);
}
