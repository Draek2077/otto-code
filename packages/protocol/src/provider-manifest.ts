import { z } from "zod";
import type { AgentMode } from "./agent-types.js";

// Tiers map to signal colors in the client (safe=green, moderate=yellow,
// dangerous=red, planning=blue); "neutral" renders in the default text color.
export type AgentModeColorTier =
  | "neutral"
  | "safe"
  | "moderate"
  | "dangerous"
  | "planning"
  | `#${string}`;
// Open string by design: the client looks icons up in a registry and falls back
// to a default for unknown values. Daemon downgrades unknown icons for clients
// that pre-date the open-string contract (see CLIENT_CAPS.customModeIcons).
export type AgentModeIcon = string;

export interface AgentModeVisuals {
  icon: AgentModeIcon;
  colorTier: AgentModeColorTier;
}

export type AgentProviderModeDefinition = Omit<AgentMode, "icon" | "colorTier"> &
  AgentModeVisuals & {
    // Marks the provider's most-permissioned no-prompt mode. Selecting it means tools run without approval; the runtime mechanism is provider-specific.
    isUnattended?: boolean;
    // False = a mode the runtime can put an agent INTO (unattended runs, or the
    // auto→dontAsk coercion for models that can't run Auto) but that a user may
    // never pick themselves. It is hidden from every mode dropdown and, on a live
    // agent, locks the mode control (the agent is stuck in it). Absent = a normal
    // user-selectable mode. See isUserSelectableMode.
    userSelectable?: boolean;
  };

// TODO: `modes` should not be static. Providers (especially ACP) report their
// own modes at runtime via session/new. We should fetch modes from the provider
// as source of truth and enrich with UI metadata (icons, colorTier) on top.
export interface AgentProviderDefinition {
  id: string;
  label: string;
  description: string;
  enabledByDefault?: boolean;
  defaultModeId: string | null;
  modes: AgentProviderModeDefinition[];
  voice?: {
    enabled: boolean;
    defaultModeId: string;
    defaultModel?: string;
  };
}

const CLAUDE_MODES: AgentProviderModeDefinition[] = [
  {
    id: "default",
    label: "Always Ask",
    description: "Prompts for permission the first time a tool is used",
    icon: "ShieldQuestionMark",
    colorTier: "neutral",
  },
  {
    id: "acceptEdits",
    label: "Accept File Edits",
    description: "Automatically approves edit-focused tools without prompting",
    icon: "ShieldPerson",
    colorTier: "safe",
  },
  {
    id: "plan",
    label: "Plan Mode",
    description: "Analyze the codebase without executing tools or edits",
    icon: "ShieldToggle",
    colorTier: "planning",
  },
  {
    id: "auto",
    label: "Auto mode",
    description: "Uses a model classifier to review permission prompts automatically",
    icon: "LocalPolice",
    colorTier: "moderate",
  },
  {
    id: "dontAsk",
    label: "Don't Ask",
    description: "Runs without prompting — actions not pre-approved are denied",
    // Guarded unattended mode: more dangerous than acceptEdits (edits only) but
    // safer than bypass (deny-by-default vs. run-everything), so it sits at the
    // "moderate" tier alongside Auto.
    icon: "ShieldCheck",
    colorTier: "moderate",
    isUnattended: true,
    // System-assigned only: the coercion target for unattended runs and for Auto
    // on models that can't run it (Haiku). Users never pick it — it's hidden from
    // mode dropdowns and locks the control when it's an agent's active mode.
    userSelectable: false,
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Skip all permission prompts (use with caution)",
    icon: "PrivacyTip",
    colorTier: "dangerous",
    isUnattended: true,
  },
];

const CODEX_MODES: AgentProviderModeDefinition[] = [
  {
    id: "auto",
    label: "Default Permissions",
    description: "Edit files and run commands with Codex's default approval flow.",
    icon: "ShieldAlert",
    colorTier: "moderate",
  },
  {
    id: "auto-review",
    label: "Auto-review",
    description:
      "Same workspace-write permissions as Default, but eligible `on-request` approvals are routed through the auto-reviewer subagent.",
    icon: "ShieldQuestionMark",
    colorTier: "moderate",
  },
  {
    id: "full-access",
    label: "Full Access",
    description: "Edit files, run commands, and access the network without additional prompts.",
    icon: "ShieldAlert",
    colorTier: "dangerous",
    isUnattended: true,
  },
];

const COPILOT_MODES: AgentProviderModeDefinition[] = [
  {
    id: "https://agentclientprotocol.com/protocol/session-modes#agent",
    label: "Agent",
    description: "Default agent mode for conversational interactions",
    icon: "ShieldAlert",
    colorTier: "moderate",
  },
  {
    id: "https://agentclientprotocol.com/protocol/session-modes#plan",
    label: "Plan",
    description: "Plan mode for creating and executing multi-step plans",
    icon: "ShieldCheck",
    colorTier: "planning",
  },
  {
    id: "allow-all",
    label: "Allow All",
    description: "Automatically approves all Copilot tool, path, and URL requests.",
    icon: "ShieldOff",
    colorTier: "dangerous",
    isUnattended: true,
  },
];

const OPENCODE_MODES: AgentProviderModeDefinition[] = [
  {
    id: "build",
    label: "Build",
    description: "Allows edits and tool execution for implementation work",
    icon: "Bot",
    colorTier: "moderate",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Read-only planning mode that avoids file edits",
    icon: "Bot",
    colorTier: "planning",
  },
];

const MOCK_LOAD_TEST_MODES: AgentProviderModeDefinition[] = [
  {
    id: "load-test",
    label: "Load Test",
    description: "Streams repeated markdown, reasoning, and tool calls for app stress testing",
    icon: "ShieldOff",
    colorTier: "dangerous",
  },
  {
    id: "dontAsk",
    label: "Don't Ask",
    description: "Runs without prompting — actions not pre-approved are denied",
    icon: "ShieldCheck",
    colorTier: "moderate",
    // Dev-only mirror of Claude's guarded unattended mode so deterministic E2E
    // specs can exercise the system-assigned surfaces: the unattended coercion
    // target for mock schedule runs, and the locked mode badge on a live agent
    // stuck in a non-user-selectable mode.
    isUnattended: true,
    userSelectable: false,
  },
];

const MOCK_SLOW_MODES: AgentProviderModeDefinition[] = [
  {
    id: "default",
    label: "Default",
    description: "Dev-only mode for the mock slow provider",
    icon: "ShieldOff",
    colorTier: "dangerous",
  },
];

export const AGENT_PROVIDER_DEFINITIONS: AgentProviderDefinition[] = [
  {
    id: "claude",
    label: "Claude",
    description: "Anthropic's multi-tool assistant with MCP support, streaming, and deep reasoning",
    defaultModeId: "default",
    modes: CLAUDE_MODES,
    voice: {
      enabled: true,
      defaultModeId: "default",
      defaultModel: "haiku",
    },
  },
  {
    id: "codex",
    label: "Codex",
    description: "OpenAI's Codex workspace agent with sandbox controls and optional network access",
    defaultModeId: "auto",
    modes: CODEX_MODES,
    voice: {
      enabled: true,
      defaultModeId: "auto",
      defaultModel: "gpt-5.4-mini",
    },
  },
  {
    id: "copilot",
    label: "Copilot",
    description: "GitHub Copilot via Agent Client Protocol with dynamic modes and session support",
    defaultModeId: "https://agentclientprotocol.com/protocol/session-modes#agent",
    modes: COPILOT_MODES,
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Open-source coding assistant with multi-provider model support",
    defaultModeId: "build",
    modes: OPENCODE_MODES,
    voice: {
      enabled: true,
      defaultModeId: "build",
    },
  },
  {
    id: "pi",
    label: "Pi",
    description: "Minimal terminal-based coding agent with multi-provider LLM support",
    defaultModeId: null,
    modes: [],
  },
  {
    id: "omp",
    label: "OMP",
    description: "Pi-compatible coding agent distributed as Oh My Pi",
    enabledByDefault: false,
    defaultModeId: null,
    modes: [],
  },
];

export const DEV_AGENT_PROVIDER_DEFINITIONS: AgentProviderDefinition[] = [
  {
    id: "mock",
    label: "Mock Load Test",
    description:
      "Development-only provider that emits synthetic agent traffic for performance tests",
    defaultModeId: "load-test",
    modes: MOCK_LOAD_TEST_MODES,
  },
  {
    id: "mock-slow",
    label: "Mock Slow Provider",
    description: "Dev-only: hangs during model discovery to test loading and timeout UI",
    defaultModeId: "default",
    modes: MOCK_SLOW_MODES,
  },
];

export function getAgentProviderDefinition(
  provider: string,
  definitions: AgentProviderDefinition[] = [
    ...AGENT_PROVIDER_DEFINITIONS,
    ...DEV_AGENT_PROVIDER_DEFINITIONS,
  ],
): AgentProviderDefinition {
  const definition = definitions.find((entry) => entry.id === provider);
  if (!definition) {
    throw new Error(`Unknown agent provider: ${provider}`);
  }
  return definition;
}

export const BUILTIN_PROVIDER_IDS = AGENT_PROVIDER_DEFINITIONS.map((d) => d.id);
export const AGENT_PROVIDER_IDS = BUILTIN_PROVIDER_IDS;

export const AgentProviderSchema = z.string();

export function isValidAgentProvider(
  value: string,
  validIds: Iterable<string> = BUILTIN_PROVIDER_IDS,
): boolean {
  return Array.isArray(validIds) ? validIds.includes(value) : new Set(validIds).has(value);
}

export function getUnattendedModeId(
  provider: string,
  definitions: AgentProviderDefinition[] = [
    ...AGENT_PROVIDER_DEFINITIONS,
    ...DEV_AGENT_PROVIDER_DEFINITIONS,
  ],
): string | undefined {
  const definition = definitions.find((entry) => entry.id === provider);
  return definition?.modes.find((mode) => mode.isUnattended)?.id;
}

/**
 * Whether a user may pick this mode themselves. False only for modes explicitly
 * flagged `userSelectable: false` in the static manifest (Claude "dontAsk") — a
 * system-assigned mode that agents can run in but no one selects by hand. Unknown
 * modes (dynamic/ACP, custom providers) default to selectable. The flag is a
 * static property of the mode, so this always consults the built-in manifest
 * rather than snapshot-derived definitions (which don't carry it).
 */
export function isUserSelectableMode(provider: string, modeId: string): boolean {
  const definition = [...AGENT_PROVIDER_DEFINITIONS, ...DEV_AGENT_PROVIDER_DEFINITIONS].find(
    (entry) => entry.id === provider,
  );
  const mode = definition?.modes.find((entry) => entry.id === modeId);
  return mode?.userSelectable !== false;
}

export function getModeVisuals(
  provider: string,
  modeId: string,
  definitions: AgentProviderDefinition[],
): AgentModeVisuals | undefined {
  const definition = definitions.find((entry) => entry.id === provider);
  const mode = definition?.modes.find((m) => m.id === modeId);
  if (!mode) return undefined;
  return { icon: mode.icon, colorTier: mode.colorTier };
}
