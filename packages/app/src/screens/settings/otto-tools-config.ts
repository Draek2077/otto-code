import { OTTO_TOOL_GROUPS, type OttoToolGroup } from "@otto-code/protocol/provider-config";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";

// User-facing metadata for each Otto tool category. Order here is the display
// order in the Host settings "Otto Tools" section. Copy is raw English — the
// developer-mode host settings surfaces are English-only pending a translation
// pass (build-first, translate-last).
export interface OttoToolGroupMeta {
  group: OttoToolGroup;
  label: string;
  description: string;
}

export const OTTO_TOOL_GROUP_META: readonly OttoToolGroupMeta[] = [
  {
    group: "workspace",
    label: "Workspace",
    description: "Worktrees and workspace management tools.",
  },
  {
    group: "agents",
    label: "Agents",
    description: "Spawn and coordinate agents (create_agent, wait_for_agents, run status).",
  },
  {
    group: "terminals",
    label: "Terminals",
    description: "Run commands in workspace terminals.",
  },
  {
    group: "web",
    label: "Web",
    description: "Web search and fetch.",
  },
  {
    group: "preview",
    label: "Preview",
    description: "Start dev servers and preview workspace scripts.",
  },
  {
    group: "browser",
    label: "Browser",
    description:
      "Verify changes in the Otto browser pane (snapshots, DOM, console, clicks). Also requires the browser-tools master switch above.",
  },
  {
    group: "schedules",
    label: "Schedules",
    description: "Create and manage scheduled agent runs.",
  },
  {
    group: "artifacts",
    label: "Artifacts",
    description: "Create and update rendered artifacts.",
  },
];

// The two tool groups that belong under the dedicated "Browser Tools" section
// (gated by the browserTools.enabled master switch) rather than the general Otto
// tool catalog. Relabeled for that context — the browser group is just
// "Control" there (the section header already says "Browser"), and the
// master-switch dependency note is dropped because the section structure now
// makes the dependency explicit.
export const BROWSER_TOOL_GROUP_META: readonly OttoToolGroupMeta[] = [
  {
    group: "browser",
    label: "Control",
    description:
      "Verify changes in the Otto browser pane — accessibility snapshots, DOM, console, network, clicks.",
  },
  {
    group: "preview",
    label: "Preview",
    description: "Start dev servers and preview workspace scripts.",
  },
];

const BROWSER_TOOL_GROUP_SET = new Set<OttoToolGroup>(
  BROWSER_TOOL_GROUP_META.map((meta) => meta.group),
);

// The general Otto tool catalog shown under "Otto Tools" — every group except
// the browser-tools groups, which live in their own section. Preserves the
// canonical display order from OTTO_TOOL_GROUP_META.
export const OTTO_CORE_TOOL_GROUP_META: readonly OttoToolGroupMeta[] = OTTO_TOOL_GROUP_META.filter(
  (meta) => !BROWSER_TOOL_GROUP_SET.has(meta.group),
);

// undefined toolGroups = every group enabled (mirrors openai-compat's
// per-provider `ottoToolGroups` semantics). Resolve to a concrete set so the UI
// renders a switch state without special-casing undefined at every call site.
export function resolveEnabledToolGroups(config: MutableDaemonConfig | null): Set<OttoToolGroup> {
  const groups = config?.mcp?.toolGroups;
  if (!Array.isArray(groups)) {
    return new Set<OttoToolGroup>(OTTO_TOOL_GROUPS);
  }
  return new Set<OttoToolGroup>(groups);
}

export function isToolGroupEnabled(
  config: MutableDaemonConfig | null,
  group: OttoToolGroup,
): boolean {
  return resolveEnabledToolGroups(config).has(group);
}

// Build a patch that flips one category. The resulting array is always the full
// membership (canonical order), so "all on" persists as the complete list —
// equivalent to undefined but explicit, which is fine (the daemon reads either
// as "all enabled").
export function createToolGroupsPatch(
  config: MutableDaemonConfig | null,
  group: OttoToolGroup,
  enabled: boolean,
): MutableDaemonConfigPatch {
  const current = resolveEnabledToolGroups(config);
  if (enabled) {
    current.add(group);
  } else {
    current.delete(group);
  }
  const next = OTTO_TOOL_GROUPS.filter((candidate) => current.has(candidate));
  return { mcp: { toolGroups: next } };
}

// Agent behavior toggles (daemon-wide, Claude-tier). Each field defaults on.
export type AgentBehaviorKey =
  | "promptSuggestions"
  | "agentProgressSummaries"
  | "notifyOnFinishDefault";

export interface AgentBehaviorMeta {
  key: AgentBehaviorKey;
  label: string;
  description: string;
}

export const AGENT_BEHAVIOR_META: readonly AgentBehaviorMeta[] = [
  {
    key: "promptSuggestions",
    label: "Prompt suggestions",
    description:
      "Let capable providers predict a next prompt after each turn. Costs extra tokens per turn.",
  },
  {
    key: "agentProgressSummaries",
    label: "Progress summaries",
    description: "Let agents author short progress summaries during a turn.",
  },
  {
    key: "notifyOnFinishDefault",
    label: "Notify on finish by default",
    description: "Default new background agents to notify their caller when they finish.",
  },
];

export function isAgentBehaviorEnabled(
  config: MutableDaemonConfig | null,
  key: AgentBehaviorKey,
): boolean {
  // undefined field reads as its implicit default (on).
  return config?.agentBehaviors?.[key] !== false;
}

export function createAgentBehaviorPatch(
  key: AgentBehaviorKey,
  enabled: boolean,
): MutableDaemonConfigPatch {
  return { agentBehaviors: { [key]: enabled } };
}

// metadataGeneration master switch + writer-preference toggle.
export function isMetadataGenerationEnabled(config: MutableDaemonConfig | null): boolean {
  return config?.metadataGeneration?.enabled !== false;
}

export function isPreferWriterPersonalities(config: MutableDaemonConfig | null): boolean {
  return config?.metadataGeneration?.preferWriterPersonalities === true;
}

export function createMetadataGenerationEnabledPatch(enabled: boolean): MutableDaemonConfigPatch {
  return { metadataGeneration: { enabled } };
}

export function createPreferWriterPersonalitiesPatch(
  preferWriter: boolean,
): MutableDaemonConfigPatch {
  return { metadataGeneration: { preferWriterPersonalities: preferWriter } };
}
