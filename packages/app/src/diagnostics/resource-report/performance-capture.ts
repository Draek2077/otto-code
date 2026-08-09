import { useEffect, useState } from "react";

import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { isElectronRuntime } from "@/desktop/host";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { collectQueryHotspots, collectTrafficHotspots } from "./collect-resource-metrics";
import { resourceMonitor } from "./resource-monitor";
import { analyzeResourceTrend, type ResourceSample } from "./resource-trend";

export interface PerformanceCaptureState {
  active: boolean;
  startedAt: number | null;
  saving: boolean;
  lastSavedPath: string | null;
  error: string | null;
}

interface PersistedPerformanceCapture {
  format: "otto-performance-capture-v1";
  startedAt: string;
  stoppedAt: string;
  samples: ResourceSample[];
  trend: ReturnType<typeof analyzeResourceTrend>;
  hotspots: {
    traffic: ReturnType<typeof collectTrafficHotspots>;
    queries: ReturnType<typeof collectQueryHotspots>;
  };
  daemonDiagnostics: Array<{ serverId: string; diagnostic: string }>;
}

type Listener = () => void;

const state: PerformanceCaptureState = {
  active: false,
  startedAt: null,
  saving: false,
  lastSavedPath: null,
  error: null,
};
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

function copySamples(): ResourceSample[] {
  return resourceMonitor.getSamples().map((sample) => ({
    at: sample.at,
    uptimeMs: sample.uptimeMs,
    metrics: { ...sample.metrics },
  }));
}

export function canPersistPerformanceCaptures(): boolean {
  return isElectronRuntime();
}

export function startPerformanceCapture(): void {
  if (state.active || state.saving) return;
  resourceMonitor.start();
  resourceMonitor.reset();
  resourceMonitor.takeSample();
  state.active = true;
  state.startedAt = Date.now();
  state.lastSavedPath = null;
  state.error = null;
  notify();
}

export async function stopPerformanceCapture(): Promise<void> {
  if (!state.active || !state.startedAt || state.saving) return;
  state.saving = true;
  notify();
  try {
    resourceMonitor.takeSample();
    const samples = copySamples();
    const daemonDiagnostics = await collectDaemonDiagnostics();
    const capture: PersistedPerformanceCapture = {
      format: "otto-performance-capture-v1",
      startedAt: new Date(state.startedAt).toISOString(),
      stoppedAt: new Date().toISOString(),
      samples,
      trend: analyzeResourceTrend(samples),
      hotspots: {
        traffic: collectTrafficHotspots(24),
        queries: collectQueryHotspots(24),
      },
      daemonDiagnostics,
    };
    const result = await invokeDesktopCommand<{ path?: unknown }>("write_performance_capture", {
      contents: `${JSON.stringify(capture, null, 2)}\n`,
    });
    if (typeof result.path !== "string" || result.path.length === 0) {
      throw new Error("Desktop did not return a performance capture path.");
    }
    state.lastSavedPath = result.path;
    state.error = null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.active = false;
    state.startedAt = null;
    state.saving = false;
    notify();
  }
}

async function collectDaemonDiagnostics(): Promise<
  Array<{ serverId: string; diagnostic: string }>
> {
  const snapshots = getHostRuntimeStore().getSnapshots();
  const results = await Promise.all(
    snapshots.map(async (snapshot) => {
      const client = snapshot.client;
      if (
        snapshot.connectionStatus !== "online" ||
        !client ||
        client.getLastServerInfoMessage()?.features?.daemonDiagnostics !== true
      ) {
        return null;
      }
      try {
        const result = await client.collectDiagnostics();
        return { serverId: snapshot.serverId, diagnostic: result.diagnostic };
      } catch (error) {
        return {
          serverId: snapshot.serverId,
          diagnostic: `Diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );
  return results.filter(
    (result): result is { serverId: string; diagnostic: string } => result !== null,
  );
}

export function usePerformanceCapture(): PerformanceCaptureState {
  const [snapshot, setSnapshot] = useState<PerformanceCaptureState>({ ...state });
  useEffect(() => {
    const listener = () => setSnapshot({ ...state });
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return snapshot;
}
