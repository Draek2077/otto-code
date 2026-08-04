import type { Logger } from "pino";

/**
 * A source of runnable Scripts that a project already declares for itself:
 * `package.json` scripts, Makefile targets, .NET launch profiles, and so on.
 *
 * See projects/script-discovery/script-discovery.md. Three contract rules make
 * this survivable as sources are added:
 *
 * 1. **Detection is discovery.** There is no separate `detect()` step - a
 *    provider whose marker file is absent returns `[]`, cheaply. One code path
 *    means detection and discovery can never disagree.
 * 2. **A provider never throws for a project it does not apply to.** A malformed
 *    manifest logs and yields `[]`. One broken file must not blank the dropdown.
 * 3. **A provider is a pure read.** It never writes to the project, never
 *    touches otto.json, and never spawns anything.
 */
export interface ScriptProvider {
  /** Stable, lowercase, and part of every qualified name this provider emits. */
  readonly sourceId: string;
  /** The tool half of the dropdown's group header, e.g. "npm". */
  readonly sourceLabel: string;
  discover(context: ScriptDiscoveryContext): Promise<DiscoveredScript[]>;
}

export interface ScriptDiscoveryContext {
  /** The workspace's own base folder - a worktree path or a checkout. */
  workspaceDirectory: string;
  logger: Logger;
}

export interface DiscoveredScript {
  /** What the project itself calls it, e.g. "build". Displayed as-is. */
  name: string;
  /** The command to run, already expressed for the project's tool. */
  command: string;
  /**
   * Where to run it, relative to the workspace root. `null` means the root.
   * Carried from the first slice so per-package sources (npm workspaces,
   * multi-project solutions) do not need a contract change later.
   */
  cwd: string | null;
  /** Repo-relative file this came from, e.g. "package.json". */
  sourceFile: string;
  /**
   * Overrides the provider's own label for this entry's group header. Lets one
   * provider name what it actually found - the npm provider says "pnpm" when a
   * `pnpm-lock.yaml` decided the command - without splitting `sourceId`, which
   * has to stay stable because qualified names are built from it.
   */
  sourceLabel?: string;
}

/** A discovered script bound to the provider that produced it. */
export interface DiscoveredScriptEntry extends DiscoveredScript {
  sourceId: string;
  sourceLabel: string;
  /** The wire/runtime key, e.g. "npm:build". */
  scriptName: string;
}

const QUALIFIED_NAME_SEPARATOR = ":";

/**
 * Everything downstream of the dropdown - the runtime store, the service-proxy
 * hostname, the `workspace.script.*` RPCs - is keyed by `scriptName`, and two
 * sources can both offer "build". Qualifying the wire name keeps discovered
 * scripts in the existing key space instead of inventing a second one.
 *
 * Otto's own scripts keep bare names, so the two namespaces cannot collide.
 */
export function qualifyScriptName(input: { sourceId: string; name: string }): string {
  return `${input.sourceId}${QUALIFIED_NAME_SEPARATOR}${input.name}`;
}

export function parseQualifiedScriptName(
  scriptName: string,
): { sourceId: string; name: string } | null {
  const separatorIndex = scriptName.indexOf(QUALIFIED_NAME_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === scriptName.length - 1) {
    return null;
  }
  return {
    sourceId: scriptName.slice(0, separatorIndex),
    name: scriptName.slice(separatorIndex + 1),
  };
}

/**
 * Collapse a command to a comparable form so an otto.json script that wraps a
 * discovered one is recognized as the same thing. Deliberately conservative:
 * whitespace only, plus the trailing `--` that argument-forwarding leaves
 * behind. Anything cleverer starts guessing at shell semantics.
 */
export function normalizeScriptCommand(command: string): string {
  const collapsed = command.trim().replace(/\s+/g, " ");
  return collapsed.endsWith(" --") ? collapsed.slice(0, -3).trimEnd() : collapsed;
}
