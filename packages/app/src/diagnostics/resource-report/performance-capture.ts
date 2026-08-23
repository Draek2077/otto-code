import { useEffect, useState } from "react";
import type { DaemonClientInboundDispatchTiming } from "@otto-code/client/internal/daemon-client";

import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { isElectronRuntime } from "@/desktop/host";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { collectQueryHotspots, collectTrafficHotspots } from "./collect-resource-metrics";
import {
  getLongFrameReport,
  type LongFrameReport,
  type LongFrameSummary,
} from "./long-frame-attribution";
import { resourceMonitor } from "./resource-monitor";
import { analyzeResourceTrend, type ResourceSample } from "./resource-trend";

export interface PerformanceCaptureState {
  active: boolean;
  startedAt: number | null;
  saving: boolean;
  lastSavedPath: string | null;
  error: string | null;
}

interface CapturedInboundDispatch extends DaemonClientInboundDispatchTiming {
  serverId: string;
}

interface InboundDispatchLongFrameMatch {
  frameAt: number;
  frameDurationMs: number;
  blockingMs: number;
  dispatches: CapturedInboundDispatch[];
}

interface PersistedPerformanceCapture {
  format: "otto-performance-capture-v1";
  startedAt: string;
  stoppedAt: string;
  samples: ResourceSample[];
  trend: ReturnType<typeof analyzeResourceTrend>;
  /**
   * The monitor history that existed before the capture reset it. A capture is
   * usually taken seconds after the symptom, so the growth that led up to it
   * lives here, not in the capture-window samples.
   */
  preCapture: {
    samples: number;
    durationMs: number;
    trend: ReturnType<typeof analyzeResourceTrend>;
  } | null;
  /** What ran inside the long frames: capture-window entries + session totals. */
  longFrames: LongFrameReport;
  /**
   * The inbound daemon messages whose synchronous dispatch overlapped a long
   * frame. This turns a generic WebSocket callback attribution into a concrete
   * message type and dispatch phase without retaining unbounded telemetry.
   */
  inboundDispatch: {
    entries: CapturedInboundDispatch[];
    longFrameMatches: InboundDispatchLongFrameMatch[];
  };
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
let preCaptureSnapshot: PersistedPerformanceCapture["preCapture"] = null;
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
  // Snapshot the always-on history before reset wipes it: its growth trend is
  // the leak evidence, and the capture window alone is too short to re-derive it.
  const history = resourceMonitor.getSamples();
  preCaptureSnapshot =
    history.length >= 2
      ? {
          samples: history.length,
          durationMs: history[history.length - 1].at - history[0].at,
          trend: analyzeResourceTrend(history),
        }
      : null;
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
    const longFrames = getLongFrameReport(state.startedAt);
    const inboundDispatchEntries = collectInboundDispatches(state.startedAt);
    const capture: PersistedPerformanceCapture = {
      format: "otto-performance-capture-v1",
      startedAt: new Date(state.startedAt).toISOString(),
      stoppedAt: new Date().toISOString(),
      samples,
      trend: analyzeResourceTrend(samples),
      preCapture: preCaptureSnapshot,
      longFrames,
      inboundDispatch: {
        entries: inboundDispatchEntries,
        longFrameMatches: matchInboundDispatchesToLongFrames(
          longFrames.entries,
          inboundDispatchEntries,
        ),
      },
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

function collectInboundDispatches(sinceMs: number): CapturedInboundDispatch[] {
  return getHostRuntimeStore()
    .getSnapshots()
    .flatMap((snapshot) => {
      if (!snapshot.client) return [];
      return snapshot.client.getInboundDispatchTimings(sinceMs).map((entry) => ({
        serverId: snapshot.serverId,
        at: entry.at,
        type: entry.type,
        bytes: entry.bytes,
        decodeAndValidateMs: entry.decodeAndValidateMs,
        internalDispatchMs: entry.internalDispatchMs,
        rawListenersMs: entry.rawListenersMs,
        typedHandlersMs: entry.typedHandlersMs,
        totalMs: entry.totalMs,
      }));
    });
}

function matchInboundDispatchesToLongFrames(
  frames: readonly LongFrameSummary[],
  dispatches: readonly CapturedInboundDispatch[],
): InboundDispatchLongFrameMatch[] {
  return frames.flatMap((frame) => {
    const frameEnd = frame.at + frame.durationMs;
    const matches = dispatches.filter((dispatch) => {
      const dispatchEnd = dispatch.at + Math.max(0, dispatch.totalMs);
      return dispatch.at <= frameEnd && dispatchEnd >= frame.at;
    });
    if (matches.length === 0) return [];
    return [
      {
        frameAt: frame.at,
        frameDurationMs: frame.durationMs,
        blockingMs: frame.blockingMs,
        dispatches: matches,
      },
    ];
  });
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
