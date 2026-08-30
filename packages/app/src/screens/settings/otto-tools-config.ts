import {
  OTTO_TOOL_GROUPS,
  resolveStoredOttoToolGroups,
  serializeOttoToolGroups,
  type OttoToolGroup,
} from "@otto-code/protocol/provider-config";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";

// User-facing metadata for each Otto tool category. Order here is the display
// order in the Host settings "Otto Tools" section. Copy is raw English - the
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
    description: "Spawn and steer chats (create_chat, send_chat_prompt, wait_for_chats).",
  },
  {
    group: "orchestration",
    label: "Workflows",
    description:
      "Let an agent declare and run a multi-chat Workflow (start_workflow, get_workflow_status). Off means agents can still spawn chats one at a time, but not fan out under a daemon-managed Workflow.",
  },
  {
    group: "tasks",
    label: "Suggested tasks",
    description: "Propose and dismiss follow-up work as task cards (suggest_task, dismiss_task).",
  },
  {
    group: "terminals",
    label: "Terminals",
    description: "Run commands in workspace terminals.",
  },
  {
    group: "knowledge",
    label: "Project knowledge",
    description:
      "Read and write the project's durable record - charters, decisions, findings, references. The largest category in the catalog, so switching it off is also the biggest single saving in tool-definition tokens per request.",
  },
  {
    group: "memory",
    label: "Memory",
    description: "Let an agent profile record and revise its own lessons (remember_lesson).",
  },
  {
    group: "permissions",
    label: "Permissions",
    description:
      "Let an agent see and answer another chat's pending permission prompts. Off means only you approve them.",
  },
  {
    group: "providers",
    label: "Providers and models",
    description: "Look up configured providers and their models (list_providers, list_models).",
  },
  {
    group: "voice",
    label: "Voice",
    description: "Let an agent speak a line out loud (speak).",
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
  {
    group: "widgets",
    label: "Widgets",
    description:
      "Let agents draw diagrams, charts and small interactive controls inline in the chat. Widgets run sandboxed with no network access, and can send a message to the chat when you click one.",
  },
  {
    group: "web",
    label: "Web",
    description: "Web search and fetch.",
  },
];

// The two tool groups that belong under the dedicated "Browser Tools" section
// (gated by the browserTools.enabled master switch) rather than the general Otto
// tool catalog. Relabeled for that context - the browser group is just
// "Control" there (the section header already says "Browser"), and the
// master-switch dependency note is dropped because the section structure now
// makes the dependency explicit.
export const BROWSER_TOOL_GROUP_META: readonly OttoToolGroupMeta[] = [
  {
    group: "browser",
    label: "Control",
    description:
      "Verify changes in the Otto browser pane - accessibility snapshots, DOM, console, network, clicks.",
  },
  {
    group: "preview",
    label: "Preview",
    description: "Start dev servers and preview workspace scripts.",
  },
];

// Groups the general "Otto Tools" card does not show.
//
// - browser / preview live in the dedicated Browser Tools section instead.
// - web is deliberately absent: the daemon-wide `mcp.toolGroups` allowlist gates
//   registration in the Otto tool catalog, and the catalog contains no web
//   tools. `web` only ever meant "the natively-tooled providers' builtin
//   web_search/web_fetch", which is a per-provider decision and is toggled in
//   the provider sheet. Shown here it was a switch that did nothing.
//   Gating the CLI providers' own web tools the same way is a separate,
//   unbuilt capability - do not re-add this row until it exists.
const NON_CORE_TOOL_GROUPS = new Set<OttoToolGroup>([
  ...BROWSER_TOOL_GROUP_META.map((meta) => meta.group),
  "web",
]);

// The general Otto tool catalog shown under "Otto Tools". Preserves the
// canonical display order from OTTO_TOOL_GROUP_META.
export const OTTO_CORE_TOOL_GROUP_META: readonly OttoToolGroupMeta[] = OTTO_TOOL_GROUP_META.filter(
  (meta) => !NON_CORE_TOOL_GROUPS.has(meta.group),
);

// An absent selection = every group enabled (mirrors openai-compat's
// per-provider `ottoToolGroups` semantics). Resolve to a concrete set so the UI
// renders a switch state without special-casing undefined at every call site.
//
// COMPAT(ottoToolGroupsV2): a host whose config predates the "agents" split
// carries only the legacy key; resolveStoredOttoToolGroups migrates it forward
// so the categories carved out of "agents" inherit whatever "agents" was set to
// rather than reading as newly disabled.
export function resolveEnabledToolGroups(config: MutableDaemonConfig | null): Set<OttoToolGroup> {
  const groups = resolveStoredOttoToolGroups({
    v2: config?.mcp?.toolGroupsV2,
    legacy: config?.mcp?.toolGroups,
  });
  return new Set<OttoToolGroup>(groups ?? OTTO_TOOL_GROUPS);
}

export function isToolGroupEnabled(
  config: MutableDaemonConfig | null,
  group: OttoToolGroup,
): boolean {
  return resolveEnabledToolGroups(config).has(group);
}

// Build a patch that flips one category. The resulting array is always the full
// membership (canonical order), so "all on" persists as the complete list -
// equivalent to undefined but explicit, which is fine (the daemon reads either
// as "all enabled").
//
// COMPAT(ottoToolGroupsV2): both keys are written every time. `toolGroupsV2` is
// what a current daemon reads; `toolGroups` is the pre-split projection, so a
// daemon that predates the split still grants the tools the user left enabled
// instead of withholding a category it cannot name.
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
  return { mcp: serializeOttoToolGroups(next) };
}

// Agent behavior toggles (daemon-wide). Each field defaults on.
export type AgentBehaviorKey =
  | "promptSuggestions"
  | "agentProgressSummaries"
  | "notifyOnFinishDefault"
  | "todoNudge"
  | "todoReconcileOnIdle";

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

// Task-list reminders (daemon-wide, provider-agnostic). Grouped separately so
// the two related toggles read as one set. Both persist under agentBehaviors and
// default on; gated on the todoReminders server feature.
export const TODO_REMINDER_META: readonly AgentBehaviorMeta[] = [
  {
    key: "todoNudge",
    label: "Nudge on open task list",
    description:
      "While an agent has an open task list, remind it on its next turn to keep the list current.",
  },
  {
    key: "todoReconcileOnIdle",
    label: "Reconcile task list when idle",
    description:
      "When an agent finishes with a task list left unfinished, have it reconcile the list (mark done items done, or say what's left) instead of leaving a stale checklist. Costs one extra turn.",
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

export function isPreferWriterProfiles(config: MutableDaemonConfig | null): boolean {
  // COMPAT(agentProfileFields): current spelling first, pre-rename fallback, so
  // a host that has not been written since the rename still reads correctly.
  const metadata = config?.metadataGeneration;
  return (metadata?.preferWriterProfiles ?? metadata?.preferWriterPersonalities) === true;
}

export function createMetadataGenerationEnabledPatch(enabled: boolean): MutableDaemonConfigPatch {
  return { metadataGeneration: { enabled } };
}

export function createPreferWriterProfilesPatch(preferWriter: boolean): MutableDaemonConfigPatch {
  // COMPAT(agentProfileFields): both keys, so a daemon that predates the rename
  // still honours the toggle after a downgrade.
  return {
    metadataGeneration: {
      preferWriterPersonalities: preferWriter,
      preferWriterProfiles: preferWriter,
    },
  };
}
