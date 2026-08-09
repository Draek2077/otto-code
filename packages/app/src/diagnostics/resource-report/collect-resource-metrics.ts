// Reads the live client state into one flat metrics record.
//
// This is the only impure module in the resource-report folder: everything it
// touches (zustand stores, the react-query cache, the DOM, the JS heap) is read
// through a narrow input so the metric shaping stays testable in
// `resource-metrics.ts`.

import { queryClient } from "@/data/query-client";
import { isWeb } from "@/constants/platform";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useBrowserStore } from "@/stores/browser-store";
import { useContextUsageCacheStore } from "@/stores/context-usage-cache-store";
import { useDownloadStore } from "@/stores/download-store";
import { useDraftStore } from "@/stores/draft-store";
import { useFileViewStore } from "@/stores/file-view-store";
import { useLspDiagnosticsStore } from "@/stores/lsp-diagnostics-store";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { collectAllTabs, normalizeLayout } from "@/stores/workspace-layout-actions";
import { useWorkspaceTabsStore } from "@/stores/workspace-tabs-store";
import { censusContainers } from "./container-census";
import { readRuntimeCounters } from "./runtime-counters";
import { buildResourceMetrics, type ResourceMetricsInput } from "./resource-metrics";
import type { FrameWindowStats } from "./frame-rate-sampler";

// Plain-object paths whose keys are ids, not field names. Everything else keeps
// its field names so a growing metric points at real code.
const COLLAPSE_KEYS_AT = [
  "session.sessions",
  "tabs.uiTabsByWorkspace",
  "tabs.tabOrderByWorkspace",
  "tabs.focusedTabIdByWorkspace",
  "layout.treesByWorkspace",
  "layout.hiddenAgentIdsByWorkspace",
  "layout.focusRestorationByWorkspace",
  "draft.drafts",
  "browser.browsersById",
  "fileView.byKey",
  "panel.panels",
] as const;

interface StoreLike<T> {
  getState: () => T;
}

let previousTrafficSample: {
  at: number;
  messages: number;
  bytes: number;
  handlerMs: number;
} | null = null;

/** Every store the census walks. Listed once so adding a store is a one-liner. */
const CENSUS_STORES: Array<{ prefix: string; store: StoreLike<unknown> }> = [
  { prefix: "session", store: useSessionStore },
  { prefix: "tabs", store: useWorkspaceTabsStore },
  { prefix: "layout", store: useWorkspaceLayoutStore },
  { prefix: "draft", store: useDraftStore },
  { prefix: "browser", store: useBrowserStore },
  { prefix: "download", store: useDownloadStore },
  { prefix: "fileView", store: useFileViewStore },
  { prefix: "lspDiagnostics", store: useLspDiagnosticsStore },
  { prefix: "panel", store: usePanelStore },
  { prefix: "contextUsage", store: useContextUsageCacheStore },
];

export function collectResourceMetrics(
  frames: FrameWindowStats | null,
): Readonly<Record<string, number>> {
  const stores: Record<string, number> = {};
  for (const { prefix, store } of CENSUS_STORES) {
    try {
      censusContainers(store.getState(), { prefix, collapseKeysAt: COLLAPSE_KEYS_AT }, stores);
    } catch {
      // A store that throws on read must not take the whole census with it -
      // the point of the instrument is to keep reporting.
    }
  }

  const input: ResourceMetricsInput = {
    stores,
    query: readQueryCache(),
    dom: readDom(),
    heap: readHeap(),
    runtime: readRuntimeCounters(),
    traffic: readTraffic(),
    chat: readChatState(),
    frames,
  };
  return buildResourceMetrics(input);
}

/** Read live chat state separately from the generic retention census. */
function readChatState(): ResourceMetricsInput["chat"] {
  try {
    let streams = 0;
    let agents = 0;
    let workspaces = 0;

    for (const session of Object.values(useSessionStore.getState().sessions)) {
      const streamIds = new Set([
        ...session.agentStreamTail.keys(),
        ...session.agentStreamHead.keys(),
      ]);
      streams += streamIds.size;
      agents += [...session.agents.values()].filter(
        (agent) => !agent.archivedAt && agent.status !== "closed",
      ).length;
      workspaces += [...session.workspaces.values()].filter(
        (workspace) => !workspace.archivingAt,
      ).length;
    }

    const layouts = useWorkspaceLayoutStore.getState().layoutByWorkspace;
    let chats = 0;
    for (const layout of Object.values(layouts)) {
      chats += collectAllTabs(normalizeLayout(layout).root).filter(
        (tab) => tab.target.kind === "agent" || tab.target.kind === "draft",
      ).length;
    }

    return { streams, agents, chats, workspaces };
  } catch {
    return { streams: 0, agents: 0, chats: 0, workspaces: 0 };
  }
}

/**
 * Inbound daemon traffic, summed across every connected host. `handlerMs` is the
 * one that matters: it is main-thread time the app spent decoding and applying
 * daemon messages, so it converts "the connection is chatty" into "the
 * connection cost the UI thread N seconds".
 */
function readTraffic(): ResourceMetricsInput["traffic"] {
  try {
    const store = getHostRuntimeStore();
    let messages = 0;
    let bytes = 0;
    let handlerMs = 0;
    let binaryFrames = 0;
    let connectedHosts = 0;
    for (const snapshot of store.getSnapshots()) {
      const totals = snapshot.client?.getTrafficTotals();
      if (!totals) {
        continue;
      }
      connectedHosts += 1;
      messages += totals.messages;
      bytes += totals.bytes;
      handlerMs += totals.handlerMs;
      binaryFrames += totals.binaryFrames;
    }
    if (connectedHosts === 0) {
      previousTrafficSample = null;
      return null;
    }
    const now = Date.now();
    const elapsedSeconds = previousTrafficSample
      ? Math.max((now - previousTrafficSample.at) / 1000, 0.001)
      : 0;
    const rate = (current: number, previous: number | undefined): number => {
      if (!elapsedSeconds || previous === undefined) return 0;
      return Math.max(0, current - previous) / elapsedSeconds;
    };
    const reading = {
      messages,
      bytes,
      handlerMs,
      binaryFrames,
      connectedHosts,
      messagesPerSecond: rate(messages, previousTrafficSample?.messages),
      bytesPerSecond: rate(bytes, previousTrafficSample?.bytes),
      handlerMsPerSecond: rate(handlerMs, previousTrafficSample?.handlerMs),
    };
    previousTrafficSample = { at: now, messages, bytes, handlerMs };
    return reading;
  } catch {
    return null;
  }
}

export interface TrafficHotspot {
  type: string;
  count: number;
  totalMs: number;
  maxMs: number;
  bytes: number;
}

/** Inbound message types ranked by main-thread cost, across all hosts. */
export function collectTrafficHotspots(limit = 15): TrafficHotspot[] {
  try {
    const merged = new Map<string, TrafficHotspot>();
    for (const snapshot of getHostRuntimeStore().getSnapshots()) {
      for (const hotspot of snapshot.client?.getTrafficHotspots(limit * 3) ?? []) {
        const existing = merged.get(hotspot.type);
        if (!existing) {
          merged.set(hotspot.type, { ...hotspot });
          continue;
        }
        existing.count += hotspot.count;
        existing.bytes += hotspot.bytes;
        existing.totalMs += hotspot.totalMs;
        existing.maxMs = Math.max(existing.maxMs, hotspot.maxMs);
      }
    }
    const rows = [...merged.values()];
    rows.sort((left, right) => right.totalMs - left.totalMs);
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}

export interface QueryHotspot {
  /** First segment of the query key - the family, e.g. "agent-history". */
  key: string;
  queries: number;
  observers: number;
}

/**
 * Which query families hold the observers. A count alone says "something is
 * subscribing too much"; this says which hook to go read. Not part of the metric
 * series - query keys are unbounded, so folding them into trended metric names
 * would let the key space grow with the data.
 */
export function collectQueryHotspots(limit = 12): QueryHotspot[] {
  try {
    const byFamily = new Map<string, { queries: number; observers: number }>();
    for (const query of queryClient.getQueryCache().getAll()) {
      const root = query.queryKey[0];
      const family = typeof root === "string" ? root : "(non-string key)";
      const entry = byFamily.get(family) ?? { queries: 0, observers: 0 };
      entry.queries += 1;
      entry.observers += query.getObserversCount();
      byFamily.set(family, entry);
    }
    const hotspots: QueryHotspot[] = [];
    for (const [key, entry] of byFamily) {
      hotspots.push({ key, queries: entry.queries, observers: entry.observers });
    }
    hotspots.sort(
      (left, right) => right.observers - left.observers || right.queries - left.queries,
    );
    return hotspots.slice(0, limit);
  } catch {
    return [];
  }
}

function readQueryCache(): ResourceMetricsInput["query"] {
  try {
    const queries = queryClient.getQueryCache().getAll();
    let observed = 0;
    let withData = 0;
    let observers = 0;
    for (const query of queries) {
      const count = query.getObserversCount();
      observers += count;
      if (count > 0) {
        observed += 1;
      }
      if (query.state.data !== undefined) {
        withData += 1;
      }
    }
    return {
      queries: queries.length,
      // Cached-but-unobserved entries are the ones `gcTime` would normally
      // reclaim; if this climbs while `observed` is flat, the cache is the leak.
      unobservedQueries: queries.length - observed,
      queriesWithData: withData,
      observers,
      mutations: queryClient.getMutationCache().getAll().length,
    };
  } catch {
    return null;
  }
}

function readDom(): ResourceMetricsInput["dom"] {
  if (!isWeb || typeof document === "undefined") {
    return null;
  }
  try {
    return {
      nodes: document.getElementsByTagName("*").length,
      iframes: document.getElementsByTagName("iframe").length,
      webviews: document.getElementsByTagName("webview").length,
      canvases: document.getElementsByTagName("canvas").length,
      styleSheets: document.styleSheets.length,
    };
  } catch {
    return null;
  }
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function readHeap(): ResourceMetricsInput["heap"] {
  if (typeof performance === "undefined") {
    return null;
  }
  // Chromium-only, and absent on native - the census degrades to counts there.
  const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
  if (!memory || typeof memory.usedJSHeapSize !== "number") {
    return null;
  }
  return {
    usedBytes: memory.usedJSHeapSize,
    totalBytes: memory.totalJSHeapSize,
    limitBytes: memory.jsHeapSizeLimit,
  };
}
