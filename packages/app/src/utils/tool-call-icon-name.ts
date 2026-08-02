import type { ToolCallDetail, ToolCallIconName } from "@otto-code/protocol/agent-types";
import { isOttoToolName } from "@otto-code/protocol/tool-name-normalization";

// `handyman` is client-only, like `otto`: the wire enum stays as-is so an old
// client never meets an icon name it cannot parse. Skills are resolved from the
// tool NAME here, not sent by the daemon.
export type ToolCallIcon = ToolCallIconName | "otto" | "handyman";

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
  // Handyman is the app-wide glyph for a skill. Every provider that surfaces a
  // skill invocation names the tool "Skill" (Claude, Codex, OpenCode).
  if (lowerName === "skill") {
    return "handyman";
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
