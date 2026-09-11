import { useEffect, useState } from "react";

import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { isElectronRuntime } from "@/desktop/host";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  collectQueryHotspots,
  collectTrafficHotspots,
  getCensusStats,
} from "./collect-resource-metrics";
import {
  getDomWriteReport,
  startDomWriteAttribution,
  stopDomWriteAttribution,
  type DomWriteBatch,
  type DomWriteReport,
} from "./dom-write-attribution";
import {
  flushLongFrameAttribution,
  getLongFrameReport,
  subscribeLongFrames,
  type LongFrameReport,
  type LongFrameSummary,
} from "./long-frame-attribution";
import { resourceMonitor } from "./resource-monitor";
import { getSlowTimerCallbacks, type SlowTimerCallback } from "./runtime-counters";
import { analyzeResourceTrend, type ResourceSample } from "./resource-trend";
import { captureOperations } from "./capture-operations";
import { getGlobalSingleton } from "./global-singleton";
import {
  CaptureFrameEvidenceRecorder,
  type CapturedInboundDispatch,
} from "./capture-frame-evidence";

export interface PerformanceCaptureState {
  active: boolean;
  startedAt: number | null;
  saving: boolean;
  lastSavedPath: string | null;
  error: string | null;
}

interface InboundDispatchLongFrameMatch {
  frameAt: number;
  frameDurationMs: number;
  blockingMs: number;
  dispatches: CapturedInboundDispatch[];
}

interface DomWriteLongFrameMatch {
  frameAt: number;
  frameDurationMs: number;
  styleAndLayoutMs: number;
  batches: DomWriteBatch[];
}

interface PersistedPerformanceCapture {
  format: "otto-performance-capture-v1";
  startedAt: string;
  stoppedAt: string;
  /** Runtime identity and clock used to interpret packaged script locations. */
  environment: { userAgent: string | null; timeOrigin: number; pageScheme: string | null };
  frameEvidence: ReturnType<CaptureFrameEvidenceRecorder["report"]>;
  operations: ReturnType<typeof captureOperations.report>;
  attribution: { status: "unsupported" | "no-long-frames" | "missing-scripts" | "available" };
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
  /** TEMP DIAGNOSTIC (2026-08-23): census invocation rate, cost, and callers. */
  censusStats: ReturnType<typeof getCensusStats>;
  /**
   * Timer callbacks in the capture window that ran past the long-frame budget,
   * named by source text and registration stack - the attribution that survives
   * a drifting dev bundle where LoAF char offsets do not.
   */
  slowTimers: SlowTimerCallback[];
  /**
   * What the app wrote to the DOM during the capture, one entry per mutation
   * batch (a React commit is one batch), and the batches that landed inside
   * each long frame. Observed only while the capture runs.
   */
  domWrites: DomWriteReport & { longFrameMatches: DomWriteLongFrameMatch[] };
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

const captureRuntime = getGlobalSingleton("otto.diagnostics.performanceCapture", () => ({
  state: {
    active: false,
    startedAt: null,
    saving: false,
    lastSavedPath: null,
    error: null,
  } as PerformanceCaptureState,
  preCaptureSnapshot: null as PersistedPerformanceCapture["preCapture"],
  frameEvidence: null as CaptureFrameEvidenceRecorder | null,
  unsubscribeFrames: null as (() => void) | null,
  listeners: new Set<Listener>(),
}));
const state = captureRuntime.state;
const listeners = captureRuntime.listeners;

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
  captureRuntime.preCaptureSnapshot =
    history.length >= 2
      ? {
          samples: history.length,
          durationMs: history[history.length - 1].at - history[0].at,
          trend: analyzeResourceTrend(history),
        }
      : null;
  resourceMonitor.reset();
  resourceMonitor.takeSample();
  state.startedAt = Date.now();
  captureOperations.start();
  captureRuntime.frameEvidence = new CaptureFrameEvidenceRecorder(state.startedAt);
  captureRuntime.unsubscribeFrames = subscribeLongFrames((frame) => {
    captureRuntime.frameEvidence?.record(frame, () => ({
      domWrites: getDomWriteReport(frame.at - 100).batches,
      dispatches: collectInboundDispatches(frame.at - 100),
      operations: captureOperations.report().entries,
    }));
  });
  startDomWriteAttribution();
  state.active = true;
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
    stopDomWriteAttribution();
    flushLongFrameAttribution();
    captureRuntime.unsubscribeFrames?.();
    captureRuntime.unsubscribeFrames = null;
    const stoppedAt = Date.now();
    const samples = copySamples();
    // Freeze every client record BEFORE awaiting daemon diagnostics. Otherwise
    // saving extends the LoAF/dispatch window past the samples and DOM observer.
    const longFrames = getLongFrameReport(state.startedAt);
    const inboundDispatchEntries = collectInboundDispatches(state.startedAt);
    const domWrites = getDomWriteReport(state.startedAt);
    const evidence = captureRuntime.frameEvidence!.report();
    const capture: PersistedPerformanceCapture = {
      format: "otto-performance-capture-v1",
      startedAt: new Date(state.startedAt).toISOString(),
      stoppedAt: new Date(stoppedAt).toISOString(),
      environment: {
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
        timeOrigin: performance.timeOrigin,
        pageScheme: typeof location === "undefined" ? null : location.protocol,
      },
      frameEvidence: evidence,
      operations: captureOperations.stop(stoppedAt),
      attribution: { status: attributionStatus(longFrames.supported, evidence) },
      samples,
      trend: analyzeResourceTrend(samples),
      preCapture: captureRuntime.preCaptureSnapshot,
      longFrames,
      censusStats: getCensusStats(),
      slowTimers: getSlowTimerCallbacks(state.startedAt),
      domWrites: {
        ...domWrites,
        longFrameMatches: matchDomWritesToLongFrames(longFrames.entries, domWrites.batches),
      },
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
      daemonDiagnostics: [],
    };
    capture.daemonDiagnostics = await collectDaemonDiagnostics();
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
    captureRuntime.unsubscribeFrames?.();
    captureRuntime.unsubscribeFrames = null;
    captureOperations.stop();
    stopDomWriteAttribution();
    captureRuntime.frameEvidence = null;
    state.active = false;
    state.startedAt = null;
    state.saving = false;
    notify();
  }
}

function attributionStatus(
  supported: boolean,
  evidence: { totalFrames: number; framesWithScripts: number },
): PersistedPerformanceCapture["attribution"]["status"] {
  if (!supported) return "unsupported";
  if (evidence.totalFrames === 0) return "no-long-frames";
  return evidence.framesWithScripts === 0 ? "missing-scripts" : "available";
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
        agentId: entry.agentId,
        bytes: entry.bytes,
        decodeAndValidateMs: entry.decodeAndValidateMs,
        internalDispatchMs: entry.internalDispatchMs,
        rawListenersMs: entry.rawListenersMs,
        typedHandlersMs: entry.typedHandlersMs,
        totalMs: entry.totalMs,
      }));
    });
}

// A mutation batch is delivered as a microtask right after the script that
// wrote it, so its timestamp sits inside the frame that paid for the layout.
function matchDomWritesToLongFrames(
  frames: readonly LongFrameSummary[],
  batches: readonly DomWriteBatch[],
): DomWriteLongFrameMatch[] {
  return frames.flatMap((frame) => {
    const frameEnd = frame.at + frame.durationMs;
    const matches = batches.filter((batch) => batch.at >= frame.at && batch.at <= frameEnd);
    if (matches.length === 0) return [];
    return [
      {
        frameAt: frame.at,
        frameDurationMs: frame.durationMs,
        styleAndLayoutMs: frame.styleAndLayoutMs,
        batches: matches,
      },
    ];
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
