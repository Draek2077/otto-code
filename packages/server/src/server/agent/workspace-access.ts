import { type WorkspaceAccess, isWorkspaceAccess } from "@otto-code/protocol/agent-types";
import { type OttoToolGroup, ottoToolGroupForName } from "@otto-code/protocol/provider-config";
import {
  getOttoToolLeafName,
  normalizeToolName,
} from "@otto-code/protocol/tool-name-normalization";

// Workspace access enforcement (projects/orchestration-graphs).
//
// One place decides what each level *means*; each provider adapter decides how
// to impose it with whatever its own runtime offers. Keeping the meaning here
// rather than in three adapters is what stops "read" quietly meaning something
// different on Claude than on Codex.
//
// The rule this module exists to serve: a level is enforced by *withholding
// tools*, never by asking the model. An agent that was never given a write tool
// cannot be argued into writing, and a prompt injection in a file it reads
// cannot reach for a tool that does not exist.

export type { WorkspaceAccess };

/** Absent ⇒ "write": every agent that predates this feature is unaffected. */
export function resolveWorkspaceAccess(value: string | undefined): WorkspaceAccess {
  return isWorkspaceAccess(value) ? value : "write";
}

/**
 * Provider-native tools that modify the workspace. Denied at `read` and `none`.
 *
 * Names are the union across adapters rather than per-provider lists: denying a
 * tool a provider doesn't have is harmless, and a shared list can't drift out
 * of step with one adapter when a provider adds a tool.
 */
export const WRITE_TOOL_NAMES = [
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "str_replace_editor",
  "apply_patch",
] as const;

/**
 * Provider-native tools that read the workspace or run commands. Denied at
 * `none` only.
 *
 * Bash is here rather than in the write list on purpose: at `read` a node may
 * legitimately need to run a check (a test, a linter, a git query), and denying
 * the shell would make "read" useless for the reviewer nodes it exists for. The
 * trade is explicit — `read` bounds *tools*, and a shell can still write.
 * A node that must not touch the workspace at all is `none`.
 */
export const READ_TOOL_NAMES = [
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "Bash",
  "BashOutput",
  "KillBash",
] as const;

/** Provider-native tool names this level must deny. */
export function deniedToolsForAccess(access: WorkspaceAccess): string[] {
  if (access === "write") {
    return [];
  }
  if (access === "read") {
    return [...WRITE_TOOL_NAMES];
  }
  return [...WRITE_TOOL_NAMES, ...READ_TOOL_NAMES];
}

/**
 * Otto catalog tools (agent/tools/otto-tools.ts) that can execute or exfiltrate
 * regardless of tier: the terminal trio is a full daemon-executed shell, and
 * browser_upload reads an arbitrary file from disk into a page. Denied at
 * `read` and `none`.
 *
 * The Bash concession above does NOT extend here. A `read` node's legitimate
 * "run a check" need is met by the provider-native shell, which runs under the
 * provider's own permission machinery; the Otto terminal would be a second,
 * unprompted shell surface with no need behind it.
 */
export const OTTO_EXECUTE_TOOL_NAMES = [
  "create_terminal",
  "send_terminal_keys",
  "kill_terminal",
  "browser_upload",
] as const;

/**
 * Otto catalog tools additionally denied at `none`, mirroring how the level
 * treats provider-native tools: no workspace at all, so observing it goes too
 * (terminals), and the mutators that create or destroy workspaces, worktrees
 * and artifacts are off the table with everything else that acts on them.
 *
 * This is the statically-known membership of the groups
 * `isOttoToolAllowedForAccess` denies at `none`. It exists for providers that
 * impose the ceiling by denying names (Claude's disallowedTools); the
 * predicate — not this list — is what the catalog enforces with, so a future
 * tool in one of those groups is denied before anyone lists it here.
 */
export const OTTO_NONE_DENIED_TOOL_NAMES = [
  "list_terminals",
  "capture_terminal",
  "create_workspace",
  "list_workspaces",
  "archive_workspace",
  "rename_workspace",
  "list_worktrees",
  "create_worktree",
  "archive_worktree",
  "create_artifact",
  "update_artifact",
  "generate_artifact",
  "preview_start",
  "preview_stop",
] as const;

/**
 * Tool groups that operate on the workspace. At `none` a tool in one of these
 * groups is denied unless it appears in OTTO_NONE_ALLOWED_TOOL_NAMES: deny by
 * default, so a NEW catalog tool in a workspace-shaped group starts denied and
 * must be allowed explicitly — the same instinct as ottoToolPermissionKind
 * defaulting unknown names to "execute".
 */
const OTTO_NONE_DENIED_GROUPS: ReadonlySet<OttoToolGroup> = new Set([
  "terminals",
  "workspace",
  "artifacts",
  "preview",
]);

/**
 * Observation-only members of the denied-at-`none` groups that stay available:
 * they read daemon state (artifact metadata, dev-server status and logs), not
 * the workspace, and a reviewer node needs them to verify a rendered page
 * against an already-running dev server.
 */
export const OTTO_NONE_ALLOWED_TOOL_NAMES = [
  "list_artifacts",
  "inspect_artifact",
  "preview_list",
  "preview_logs",
] as const;

const OTTO_EXECUTE_TOOL_SET: ReadonlySet<string> = new Set(OTTO_EXECUTE_TOOL_NAMES);
const OTTO_NONE_ALLOWED_TOOL_SET: ReadonlySet<string> = new Set(OTTO_NONE_ALLOWED_TOOL_NAMES);

/**
 * Whether one Otto catalog tool is available at an access level. Accepts the
 * bare catalog name and every namespaced form a provider sees (`mcp__otto__x`,
 * `otto.x`). This predicate bounds the workspace axis only: agent lifecycle,
 * scheduling, widgets and web tools (and any non-Otto MCP tool, which falls
 * through to the "agents" catch-all group) are separate axes and stay
 * untouched — an orchestrating node declared `none` still coordinates.
 */
export function isOttoToolAllowedForAccess(name: string, access: WorkspaceAccess): boolean {
  if (access === "write") {
    return true;
  }
  const leaf = getOttoToolLeafName(name) ?? normalizeToolName(name);
  if (OTTO_EXECUTE_TOOL_SET.has(leaf)) {
    return false;
  }
  if (access === "read") {
    return true;
  }
  if (OTTO_NONE_ALLOWED_TOOL_SET.has(leaf)) {
    return true;
  }
  return !OTTO_NONE_DENIED_GROUPS.has(ottoToolGroupForName(leaf));
}

/**
 * The statically-known Otto catalog names this level must deny — the catalog
 * counterpart of deniedToolsForAccess, for providers that impose the ceiling
 * by denying names. The registration-time gate in otto-tools.ts (built on
 * isOttoToolAllowedForAccess) is the primary enforcement; this list is the
 * second layer that rides the session's own config.
 */
export function ottoToolsDeniedForAccess(access: WorkspaceAccess): string[] {
  if (access === "write") {
    return [];
  }
  if (access === "read") {
    return [...OTTO_EXECUTE_TOOL_NAMES];
  }
  return [...OTTO_EXECUTE_TOOL_NAMES, ...OTTO_NONE_DENIED_TOOL_NAMES];
}

/**
 * Codex models `read` natively (its read-only sandbox), so that mapping is
 * direct. It has nothing below read-only: its shell tool exists in every tier
 * and reads freely inside the sandbox, and the app-server protocol carries no
 * tool-deny list, so `none` is NOT enforceable on Codex. That is why its
 * capabilities omit `supportsWorkspaceAccessNone` and the spawn gate
 * (capabilitiesEnforceAccess) refuses `none` nodes on Codex seats. The
 * read-only returned for `none` here is defense in depth for a config that
 * arrives by another path — the floor, not the level.
 */
export function codexSandboxModeForAccess(access: WorkspaceAccess): string | null {
  switch (access) {
    case "write":
      return null; // leave the seat's own preset alone
    case "read":
      return "read-only";
    case "none":
      return "read-only";
  }
}

/**
 * The capability shape a provider declares for this feature (a structural
 * subset of AgentCapabilityFlags). `supportsWorkspaceAccess` covers `read`;
 * `none` additionally requires `supportsWorkspaceAccessNone`, because a
 * provider can bound writes natively and still have no way to express "no
 * filesystem".
 */
export interface WorkspaceAccessCapabilities {
  supportsWorkspaceAccess?: boolean;
  supportsWorkspaceAccessNone?: boolean;
}

/**
 * Whether a provider's declared capabilities can actually enforce a level.
 * The spawn gate refuses on false rather than running with a weaker boundary:
 * a tier that silently means something looser on one provider is exactly the
 * failure this module exists to prevent.
 */
export function capabilitiesEnforceAccess(
  capabilities: WorkspaceAccessCapabilities | null | undefined,
  access: WorkspaceAccess,
): boolean {
  if (access === "write") {
    return true;
  }
  if (!capabilities?.supportsWorkspaceAccess) {
    return false;
  }
  return access === "read" || capabilities.supportsWorkspaceAccessNone === true;
}

/**
 * Human sentence for the compile-time refusal, so an author sees which node and
 * which provider rather than a generic "unsupported".
 */
export function describeUnsupportedAccess(input: {
  nodeTitle: string;
  access: WorkspaceAccess;
  provider: string;
  /** The strictest level the provider CAN enforce, when it enforces some. */
  enforceableFloor?: WorkspaceAccess;
}): string {
  const floor =
    input.enforceableFloor && input.enforceableFloor !== "write"
      ? ` "${input.enforceableFloor}" is its floor.`
      : "";
  const remedy =
    input.enforceableFloor === "read" ? `raise its access to "read"` : `set its access to "write"`;
  return (
    `Node "${input.nodeTitle}" asks for "${input.access}" workspace access, but the ${input.provider} ` +
    `provider can't enforce it.${floor} Give the node a seat on a provider that can, or ${remedy}.`
  );
}
