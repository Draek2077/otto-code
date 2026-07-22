import { type WorkspaceAccess, isWorkspaceAccess } from "@otto-code/protocol/agent-types";

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

/** Codex exposes exactly these tiers natively, so the mapping is direct. */
export function codexSandboxModeForAccess(access: WorkspaceAccess): string | null {
  switch (access) {
    case "write":
      return null; // leave the seat's own preset alone
    case "read":
      return "read-only";
    case "none":
      // Codex has no "no filesystem" tier; read-only is its floor, and the
      // denied-tools list above closes the rest.
      return "read-only";
  }
}

/**
 * Human sentence for the compile-time refusal, so an author sees which node and
 * which provider rather than a generic "unsupported".
 */
export function describeUnsupportedAccess(input: {
  nodeTitle: string;
  access: WorkspaceAccess;
  provider: string;
}): string {
  return (
    `Node "${input.nodeTitle}" asks for "${input.access}" workspace access, but the ${input.provider} ` +
    `provider can't enforce it. Give the node a seat on a provider that can, or set its access to "write".`
  );
}
