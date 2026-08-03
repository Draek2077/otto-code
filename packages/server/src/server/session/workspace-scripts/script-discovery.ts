import type { Logger } from "pino";
import { createNpmScriptProvider } from "./npm-script-provider.js";
import {
  normalizeScriptCommand,
  parseQualifiedScriptName,
  qualifyScriptName,
  type DiscoveredScriptEntry,
  type ScriptProvider,
} from "./script-provider.js";

/**
 * Every script provider, in the order their groups appear beneath Otto's own.
 * Adding a source is a line here plus one file — that is the whole point of the
 * contract. See projects/script-discovery/script-discovery.md.
 */
export function createScriptProviders(): ScriptProvider[] {
  return [createNpmScriptProvider()];
}

export interface DeclaredScriptSummary {
  scriptName: string;
  command: string;
}

/**
 * The source a qualified script name belongs to, or `null` for a bare
 * otto.json name.
 *
 * Lets the descriptor's orphan path — which sees only a running runtime entry,
 * with no discovery run behind it — still label "npm:dev" as `dev` under npm
 * instead of leaking the qualified key into the sidebar. It reports the
 * provider's own label, so a per-entry override (pnpm) is not reflected here;
 * the dropdown's fetched list is where that detail lives.
 */
export function resolveScriptSourceFromName(
  scriptName: string,
): { id: string; label: string } | null {
  const parsed = parseQualifiedScriptName(scriptName);
  if (!parsed) {
    return null;
  }
  const provider = createScriptProviders().find(
    (candidate) => candidate.sourceId === parsed.sourceId,
  );
  return provider ? { id: provider.sourceId, label: provider.sourceLabel } : null;
}

/**
 * Run every provider over one workspace and return the entries that survive
 * de-duplication against the workspace's declared (otto.json) Scripts.
 *
 * A provider that throws is logged and dropped — one bad source never takes the
 * others down with it.
 */
export async function discoverWorkspaceScripts(input: {
  workspaceDirectory: string;
  declaredScripts: readonly DeclaredScriptSummary[];
  providers?: readonly ScriptProvider[];
  logger: Logger;
}): Promise<DiscoveredScriptEntry[]> {
  const providers = input.providers ?? createScriptProviders();
  const context = { workspaceDirectory: input.workspaceDirectory, logger: input.logger };

  const perProvider = await Promise.all(
    providers.map(async (provider) => {
      try {
        const discovered = await provider.discover(context);
        const entries: DiscoveredScriptEntry[] = [];
        for (const script of discovered) {
          entries.push({
            name: script.name,
            command: script.command,
            cwd: script.cwd,
            sourceFile: script.sourceFile,
            sourceId: provider.sourceId,
            sourceLabel: script.sourceLabel ?? provider.sourceLabel,
            scriptName: qualifyScriptName({ sourceId: provider.sourceId, name: script.name }),
          });
        }
        return entries;
      } catch (error) {
        input.logger.warn(
          { err: error, sourceId: provider.sourceId, workspaceDirectory: input.workspaceDirectory },
          "Script provider failed; skipping its source",
        );
        return [];
      }
    }),
  );

  return dedupeAgainstDeclared({
    discovered: perProvider.flat(),
    declaredScripts: input.declaredScripts,
  });
}

/**
 * Otto's declared Scripts win. A discovered entry is suppressed when a declared
 * one runs the same normalized command, or simply carries the same bare name.
 *
 * The name rule is the aggressive half, deliberately: otto.json is small and
 * hand-authored, so a declared `dev` *is* the dev script, and the requirement is
 * that it must not appear twice. The escape hatch is renaming the otto.json
 * entry.
 *
 * Two providers offering the same bare name do not collide with each other —
 * their qualified names differ, and they are genuinely different things.
 */
function dedupeAgainstDeclared(input: {
  discovered: readonly DiscoveredScriptEntry[];
  declaredScripts: readonly DeclaredScriptSummary[];
}): DiscoveredScriptEntry[] {
  const declaredNames = new Set(input.declaredScripts.map((script) => script.scriptName));
  const declaredCommands = new Set(
    input.declaredScripts.map((script) => normalizeScriptCommand(script.command)),
  );
  const seenQualifiedNames = new Set<string>();

  return input.discovered.filter((entry) => {
    if (
      declaredNames.has(entry.name) ||
      declaredCommands.has(normalizeScriptCommand(entry.command))
    ) {
      return false;
    }
    if (seenQualifiedNames.has(entry.scriptName)) {
      return false;
    }
    seenQualifiedNames.add(entry.scriptName);
    return true;
  });
}
