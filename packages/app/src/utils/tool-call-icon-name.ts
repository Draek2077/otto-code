import type { ToolCallDetail, ToolCallIconName } from "@otto-code/protocol/agent-types";
import { isOttoToolName } from "@otto-code/protocol/tool-name-normalization";

export type ToolCallIcon = ToolCallIconName | "otto";

const TOOL_DETAIL_ICON_NAMES: Record<ToolCallDetail["type"], ToolCallIcon> = {
  shell: "square_terminal",
  read: "eye",
  edit: "pencil",
  write: "pencil",
  search: "search",
  fetch: "search",
  worktree_setup: "square_terminal",
  sub_agent: "bot",
  plain_text: "wrench",
  plan: "brain",
  unknown: "wrench",
};

export function resolveToolCallIconName(toolName: string, detail?: ToolCallDetail): ToolCallIcon {
  const lowerName = toolName.trim().toLowerCase();

  if (detail?.type === "plain_text" && detail.icon) {
    return detail.icon;
  }

  // Thoughts are rendered through ToolCall with unknown detail payloads.
  if (lowerName === "thinking" && (!detail || detail.type === "unknown")) {
    return "brain";
  }
  if (lowerName === "speak") {
    return "mic_vocal";
  }
  if (isOttoToolName(lowerName)) {
    return "otto";
  }
  if (lowerName === "task") {
    return "bot";
  }

  if (detail) {
    return TOOL_DETAIL_ICON_NAMES[detail.type];
  }
  return "wrench";
}
