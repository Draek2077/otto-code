import type { ToolCallTimelineItem } from "./agent-types.js";
import { getMcpToolLeafName, getOttoToolLeafName } from "./tool-name-normalization.js";
import { stripCwdPrefix } from "./path-utils.js";

export type ToolCallDisplayInput = Pick<
  ToolCallTimelineItem,
  "name" | "status" | "error" | "metadata" | "detail"
> & {
  cwd?: string;
};

export interface ToolCallDisplayModel {
  displayName: string;
  summary?: string;
  errorText?: string;
}

interface DetailDisplay {
  displayName?: string;
  summary?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Curated display names — the registry of tools we explicitly "know about".
// Keyed by the lowercased leaf name (transport namespace already stripped).
//
// Only tools whose bare id does NOT title-case cleanly on its own need an entry
// here: lowercase compound names ("websearch") a splitter can't segment, or
// ones we want to word deliberately. Well-formed snake_case ("spawn_task") and
// camelCase ("WebSearch") names are handled by the algorithmic humanizer below
// and do NOT need listing.
//
// Anything not here falls through to the humanizer and still renders readably —
// so an unmapped tool shows up looking slightly generic (e.g. a stray provider
// tool), which is the cue to add it here. Extend this map to teach Otto a tool.
const KNOWN_TOOL_DISPLAY_NAMES: Record<string, string> = {
  websearch: "Web Search",
  web_search: "Web Search",
  webfetch: "Web Fetch",
  web_fetch: "Web Fetch",
  todowrite: "Update Todos",
  todoread: "Read Todos",
  multiedit: "Multi Edit",
  notebookedit: "Edit Notebook",
  notebookread: "Read Notebook",
  bashoutput: "Bash Output",
  killshell: "Kill Shell",
  exitplanmode: "Exit Plan Mode",
  applypatch: "Apply Patch",
  ls: "List Files",
};

// Split camelCase / PascalCase and separator-delimited identifiers into words,
// then Title-Case them: "WebSearch" -> "Web Search", "spawn_task" -> "Spawn
// Task", "HTTPServer" -> "HTTP Server".
function titleCaseToolId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function humanizeToolName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return name;
  }
  // Strip the transport namespace first ("mcp__otto__spawn_task" ->
  // "spawn_task", "otto.list_agents" -> "list_agents") so both the known-tool
  // lookup and the fallback operate on the bare tool id.
  const leaf = getMcpToolLeafName(trimmed) ?? getOttoToolLeafName(trimmed);
  if (leaf) {
    return humanizeToolName(leaf);
  }
  return KNOWN_TOOL_DISPLAY_NAMES[trimmed.toLowerCase()] ?? titleCaseToolId(trimmed);
}

/**
 * Friendly display name for a bare tool identifier, used at every surface that
 * shows a tool/action name without a full timeline item to run through
 * {@link buildToolCallDisplayModel} (the visualizer's action labels, sub-agent
 * activity rows). Strips the MCP/Otto namespace, consults the known-tool
 * registry, then title-cases as a fallback — so "mcp__otto__spawn_task",
 * "otto.spawn_task", and a bare "spawn_task" all render as "Spawn Task".
 */
export function getToolDisplayName(name: string): string {
  return humanizeToolName(name);
}

function formatErrorText(error: unknown): string | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error) && typeof error.content === "string") {
    return error.content;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function buildFilePathDisplay(
  displayName: string,
  filePath: string,
  cwd: string | undefined,
): DetailDisplay {
  return {
    displayName,
    summary: stripCwdPrefix(filePath, cwd),
  };
}

function buildCanonicalDetailDisplay(input: ToolCallDisplayInput): DetailDisplay {
  switch (input.detail.type) {
    case "shell":
      return {
        displayName: "Shell",
        summary: input.detail.command,
      };
    case "read":
      return buildFilePathDisplay("Read", input.detail.filePath, input.cwd);
    case "edit":
      return buildFilePathDisplay("Edit", input.detail.filePath, input.cwd);
    case "write":
      return buildFilePathDisplay("Write", input.detail.filePath, input.cwd);
    case "search":
      return {
        displayName: "Search",
        summary: input.detail.query,
      };
    case "fetch":
      return {
        displayName: "Fetch",
        summary: input.detail.url,
      };
    case "worktree_setup":
      return {
        displayName: "Worktree Setup",
        summary: input.detail.branchName,
      };
    case "sub_agent":
      return {
        displayName: readString(input.detail.subAgentType) ?? "Task",
        summary: readString(input.detail.description),
      };
    case "plain_text":
      return {
        summary: input.detail.label,
      };
    case "plan":
      return {
        displayName: "Plan",
      };
    case "unknown":
      return {};
    default:
      throw new Error("unreachable");
  }
}

function buildUnknownDetailOverride(input: ToolCallDisplayInput): DetailDisplay {
  const lowerName = input.name.trim().toLowerCase();
  if (input.detail.type === "unknown" && lowerName === "task") {
    return {
      displayName: "Task",
      summary: isRecord(input.metadata) ? readString(input.metadata.subAgentActivity) : undefined,
    };
  }
  if (input.detail.type === "unknown" && lowerName === "thinking") {
    return {
      displayName: "Thinking",
    };
  }
  if (lowerName === "terminal") {
    return {
      displayName: "Terminal",
      summary: input.detail.type === "plain_text" ? readString(input.detail.label) : undefined,
    };
  }
  return {};
}

export function buildToolCallDisplayModel(input: ToolCallDisplayInput): ToolCallDisplayModel {
  const canonicalDisplay = buildCanonicalDetailDisplay(input);
  const unknownDetailOverride = buildUnknownDetailOverride(input);
  const displayName =
    unknownDetailOverride.displayName ??
    canonicalDisplay.displayName ??
    humanizeToolName(input.name);
  const summary = unknownDetailOverride.summary ?? canonicalDisplay.summary;
  const errorText = input.status === "failed" ? formatErrorText(input.error) : undefined;

  return {
    displayName,
    ...(summary ? { summary } : {}),
    ...(errorText ? { errorText } : {}),
  };
}
