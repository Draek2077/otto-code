const NOTIFICATION_PREVIEW_LIMIT = 220;

export type AgentAttentionReason = "finished" | "error" | "permission";

export interface AgentAttentionNotificationData {
  [key: string]: unknown;
  serverId: string;
  agentId: string;
  reason: AgentAttentionReason;
}

export interface AgentAttentionNotificationPayload {
  title: string;
  body: string;
  data: AgentAttentionNotificationData;
}

interface BuildAgentAttentionNotificationPayloadInput {
  reason: AgentAttentionReason;
  serverId: string;
  agentId: string;
  assistantMessage?: string | null;
  permissionRequest?: NotificationPermissionRequest | null;
}

export interface NotificationPermissionRequest {
  id: string;
  provider: string;
  name: string;
  kind: "tool" | "plan" | "question" | "mode" | "other";
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type AssistantTimelineItem =
  | { type: "assistant_message"; text: string }
  | { type: string; text?: string };

const normalizeNotificationText = (text: string): string => text.replace(/\s+/g, " ").trim();

const truncateNotificationText = (text: string, limit: number): string => {
  if (text.length <= limit) {
    return text;
  }
  const trimmed = text.slice(0, Math.max(0, limit - 3)).trimEnd();
  return trimmed.length > 0 ? `${trimmed}...` : text.slice(0, limit);
};

const stripMarkdownToText = (markdown: string): string => {
  let text = markdown.replace(/\r\n/g, "\n");

  // Strip fenced code markers but keep the code content itself.
  text = text.replace(/^\s*```[^\n]*$/gm, "");
  text = text.replace(/^\s*~~~[^\n]*$/gm, "");

  // Markdown links/images.
  text = text.replace(/!\[([^\]]*)\]\((?:[^()\\]|\\.)*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\((?:[^()\\]|\\.)*\)/g, "$1");

  // Structural prefixes.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>+\s?/gm, "");
  text = text.replace(/^\s{0,3}(?:[*+-]|\d+\.)\s+/gm, "");
  text = text.replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, "");

  // Inline markdown markers.
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/\*([^*\n]+)\*/g, "$1");
  text = text.replace(/_([^_\n]+)_/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");

  // Angle-bracketed URL autolinks.
  text = text.replace(/<([^>\n]+)>/g, "$1");

  return text;
};

const buildNotificationPreview = (text: string | null | undefined): string | null => {
  if (!text) {
    return null;
  }

  const normalized = normalizeNotificationText(stripMarkdownToText(text));
  if (!normalized) {
    return null;
  }

  return truncateNotificationText(normalized, NOTIFICATION_PREVIEW_LIMIT);
};

// Human-readable labels for common tool names, so a permission notification reads
// like a request ("Run command: …") instead of dumping the raw tool identifier.
const TOOL_NAME_LABELS: Record<string, string> = {
  bash: "Run command",
  exec: "Run command",
  shell: "Run command",
  read: "Read file",
  write: "Write file",
  edit: "Edit file",
  multiedit: "Edit file",
  grep: "Search",
  glob: "Find files",
  webfetch: "Fetch page",
  websearch: "Web search",
  task: "Start subagent",
  external_directory: "Access directory",
};

const humanizeToolName = (name: string): string => {
  const trimmed = name.trim();
  return TOOL_NAME_LABELS[trimmed.toLowerCase()] ?? trimmed;
};

// Input fields that carry the meaningful, user-legible part of a tool call, in
// priority order. The first non-empty string wins.
const PERMISSION_INPUT_DESCRIPTION_KEYS = [
  "command",
  "description",
  "file_path",
  "path",
  "url",
  "pattern",
  "query",
  "prompt",
] as const;

// Deterministic field extraction — NOT an AI summary. Picks an existing string
// field out of the tool's input (by the priority list, then any string field)
// so the notification can show it verbatim instead of raw JSON.
const describePermissionInput = (input: Record<string, unknown> | undefined): string | null => {
  if (!input) {
    return null;
  }
  for (const key of PERMISSION_INPUT_DESCRIPTION_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  // Fall back to the first string-valued field rather than raw JSON.
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const buildPermissionDetails = (
  request: NotificationPermissionRequest | null | undefined,
): string | null => {
  if (!request) {
    return null;
  }

  const title = request.title?.trim();
  const description = request.description?.trim();
  const details: string[] = [];

  if (title) {
    details.push(title);
  }
  if (description && description !== title) {
    details.push(description);
  }
  if (details.length > 0) {
    return details.join(" - ");
  }

  // No provider-supplied title/description: build a legible line from the tool
  // name and a meaningful input field instead of stringifying the payload.
  const name = request.name?.trim();
  const inputDescription = describePermissionInput(request.input);
  if (name && inputDescription) {
    return `${humanizeToolName(name)}: ${inputDescription}`;
  }
  if (inputDescription) {
    return inputDescription;
  }

  return name ? humanizeToolName(name) : request.kind;
};

export function findLatestAssistantMessageFromTimeline(
  timeline: readonly AssistantTimelineItem[],
): string | null {
  // Providers may stream assistant content in consecutive chunks.
  const chunks: string[] = [];
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i];
    if (item.type !== "assistant_message" || typeof item.text !== "string") {
      if (chunks.length > 0) {
        break;
      }
      continue;
    }
    chunks.push(item.text);
  }

  if (chunks.length === 0) {
    return null;
  }

  return chunks.toReversed().join("");
}

export function findLatestPermissionRequest(
  pendingPermissions: ReadonlyMap<string, NotificationPermissionRequest>,
): NotificationPermissionRequest | null {
  let latest: NotificationPermissionRequest | null = null;
  for (const request of pendingPermissions.values()) {
    latest = request;
  }
  return latest;
}

function resolveAgentAttentionTitle(reason: AgentAttentionReason): string {
  if (reason === "permission") return "Agent needs permission";
  if (reason === "error") return "Agent needs attention";
  return "Agent finished";
}

function resolveAgentAttentionPreview(
  input: BuildAgentAttentionNotificationPayloadInput,
): string | null {
  if (input.reason === "finished") {
    return buildNotificationPreview(input.assistantMessage);
  }
  if (input.reason === "permission") {
    return buildNotificationPreview(buildPermissionDetails(input.permissionRequest));
  }
  return null;
}

function resolveAgentAttentionFallbackBody(reason: AgentAttentionReason): string {
  if (reason === "permission") return "Permission requested.";
  if (reason === "error") return "Encountered an error.";
  return "Finished working.";
}

export function buildAgentAttentionNotificationPayload(
  input: BuildAgentAttentionNotificationPayloadInput,
): AgentAttentionNotificationPayload {
  const title = resolveAgentAttentionTitle(input.reason);
  const preview = resolveAgentAttentionPreview(input);
  const body = preview ?? resolveAgentAttentionFallbackBody(input.reason);

  return {
    title,
    body,
    data: {
      serverId: input.serverId,
      agentId: input.agentId,
      reason: input.reason,
    },
  };
}
