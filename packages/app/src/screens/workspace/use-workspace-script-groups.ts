import { useEffect, useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";

import {
  OTTO_SCRIPT_GROUP_KEY,
  type WorkspaceScript,
  type WorkspaceScriptGroup,
} from "@/screens/workspace/workspace-script-group";

export {
  OTTO_SCRIPT_GROUP_KEY,
  type WorkspaceScript,
  type WorkspaceScriptGroup,
} from "@/screens/workspace/workspace-script-group";

/**
 * Daemon can enumerate the Scripts a project's own files declare.
 * COMPAT(workspaceScriptDiscovery): added in v0.7.6, drop the gate when daemon floor >= v0.7.6.
 */
export function useWorkspaceScriptDiscoveryFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceScriptDiscovery === true,
  );
}

/**
 * The Scripts dropdown's rows, grouped by where they came from.
 *
 * Two sources feed this and they answer different questions. The **descriptor**
 * (`scripts`) is pushed and always live, but only ever carries what otto.json
 * declares plus whatever is running. The **fetched list** carries identity —
 * every discovered Script, its label, its source, its command — but goes stale
 * the moment something starts or stops. So identity comes from the fetch and
 * status is overlaid from the descriptor, rather than refetching on every
 * `script_status_update` (which arrives on each health poll).
 */
export function useWorkspaceScriptGroups(input: {
  serverId: string;
  workspaceId: string;
  scripts: WorkspaceDescriptor["scripts"];
  /** Refetch whenever the menu opens, so an edited package.json shows up. */
  isMenuOpen: boolean;
}): WorkspaceScriptGroup[] {
  const { serverId, workspaceId, scripts, isMenuOpen } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const discoveryEnabled = useWorkspaceScriptDiscoveryFeature(serverId);

  const { data: discoveredScripts, refetch } = useFetchQuery({
    queryKey: ["workspace-scripts", serverId, workspaceId],
    dataShape: "list",
    // Project files change under the user's hands, but only a menu open makes
    // that visible — and that path refetches explicitly, below.
    staleTimeMs: 30_000,
    enabled: discoveryEnabled && client !== null && workspaceId.length > 0,
    queryFn: async () => {
      if (!client) return [];
      const payload = await client.listWorkspaceScripts(workspaceId, { includeDiscovered: true });
      return payload.error ? [] : payload.scripts;
    },
  });

  useEffect(() => {
    if (isMenuOpen && discoveryEnabled) {
      void refetch();
    }
  }, [isMenuOpen, discoveryEnabled, refetch]);

  return useMemo(
    () => groupWorkspaceScripts({ fetched: discoveredScripts ?? null, live: scripts }),
    [discoveredScripts, scripts],
  );
}

/**
 * Status the descriptor owns. Copied field by field rather than by spreading
 * the live record over the fetched one: a live orphan record has no `command`
 * and no `label`, and spreading would erase both.
 */
function overlayLiveStatus(fetched: WorkspaceScript, live: WorkspaceScript): WorkspaceScript {
  return {
    ...fetched,
    lifecycle: live.lifecycle,
    health: live.health,
    exitCode: live.exitCode,
    terminalId: live.terminalId,
    port: live.port,
    hostname: live.hostname,
    proxyUrl: live.proxyUrl,
    localProxyUrl: live.localProxyUrl,
    publicProxyUrl: live.publicProxyUrl,
  };
}

/** "npm · package.json", or just the tool when the source names no file. */
function buildSourceLabel(source: WorkspaceScript["source"]): string | null {
  if (!source) {
    return null;
  }
  return source.file ? `${source.label} · ${source.file}` : source.label;
}

export function groupWorkspaceScripts(input: {
  fetched: readonly WorkspaceScript[] | null;
  live: readonly WorkspaceScript[];
}): WorkspaceScriptGroup[] {
  const liveByName = new Map(input.live.map((script) => [script.scriptName, script] as const));

  // Before the fetch lands — or against a daemon without discovery — the
  // descriptor is the whole truth, and every entry in it is an Otto script.
  const merged: WorkspaceScript[] = input.fetched
    ? input.fetched.map((script) => {
        const live = liveByName.get(script.scriptName);
        return live ? overlayLiveStatus(script, live) : script;
      })
    : [...input.live];

  // A Script declared since the fetch (otto.json edited, or a running orphan)
  // still belongs in the menu.
  if (input.fetched) {
    const fetchedNames = new Set(input.fetched.map((script) => script.scriptName));
    for (const script of input.live) {
      if (!fetchedNames.has(script.scriptName)) {
        merged.push(script);
      }
    }
  }

  const groups = new Map<string, WorkspaceScriptGroup>();
  for (const script of merged) {
    const source = script.source;
    const key = source ? `${source.id}:${source.file ?? ""}` : OTTO_SCRIPT_GROUP_KEY;
    const existing = groups.get(key);
    if (existing) {
      existing.scripts.push(script);
      continue;
    }
    groups.set(key, { key, label: buildSourceLabel(source), scripts: [script] });
  }

  // Otto's declared Scripts lead, whatever order the daemon replied in.
  return [...groups.values()].sort((left, right) => {
    if (left.key === OTTO_SCRIPT_GROUP_KEY) return -1;
    if (right.key === OTTO_SCRIPT_GROUP_KEY) return 1;
    return 0;
  });
}
