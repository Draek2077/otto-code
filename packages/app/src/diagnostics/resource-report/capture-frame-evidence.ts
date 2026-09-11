import type { DaemonClientInboundDispatchTiming } from "@otto-code/client/internal/daemon-client";
import type { CaptureOperation } from "./capture-operations";
import type { DomWriteBatch } from "./dom-write-attribution";
import type { LongFrameSummary } from "./long-frame-attribution";

export interface CapturedInboundDispatch extends DaemonClientInboundDispatchTiming {
  serverId: string;
}

export interface CaptureFrameEvidence {
  frame: LongFrameSummary;
  /** Includes the preceding 100ms; temporal correlation is not causality. */
  windowStartedAt: number;
  domWrites: DomWriteBatch[];
  dispatches: CapturedInboundDispatch[];
  operations: CaptureOperation[];
  omitted: { domWrites: number; dispatches: number; operations: number };
}

export const WORST_CAPTURE_FRAME_CAPACITY = 20;
const EVIDENCE_LIMIT = 100;

/** Preserve expensive frames at observation time, before the recent rings roll over. */
export class CaptureFrameEvidenceRecorder {
  private entries: CaptureFrameEvidence[] = [];
  totalFrames = 0;
  framesWithScripts = 0;
  overhead = { calls: 0, totalMs: 0, maxMs: 0 };

  constructor(private readonly startedAt: number) {}

  record(
    frame: LongFrameSummary,
    collect: () => {
      domWrites: DomWriteBatch[];
      dispatches: CapturedInboundDispatch[];
      operations: CaptureOperation[];
    },
  ): void {
    if (frame.at < this.startedAt) return;
    this.totalFrames++;
    if (frame.scripts.length > 0) this.framesWithScripts++;
    const last = this.entries.at(-1);
    if (
      this.entries.length >= WORST_CAPTURE_FRAME_CAPACITY &&
      last &&
      score(frame, last.frame) >= 0
    )
      return;
    const started = performance.now();
    const data = collect();
    const from = frame.at - 100;
    const until = frame.at + frame.durationMs;
    const domWrites = data.domWrites.filter((item) => item.at >= from && item.at <= until);
    const dispatches = data.dispatches.filter((item) =>
      overlaps(item.at, item.totalMs, from, until),
    );
    const operations = data.operations.filter((item) =>
      overlaps(item.at, item.durationMs, from, until),
    );
    this.entries.push({
      frame,
      windowStartedAt: from,
      domWrites: domWrites.slice(-EVIDENCE_LIMIT),
      dispatches: dispatches.slice(-EVIDENCE_LIMIT),
      operations: operations.slice(-EVIDENCE_LIMIT),
      omitted: {
        domWrites: Math.max(0, domWrites.length - EVIDENCE_LIMIT),
        dispatches: Math.max(0, dispatches.length - EVIDENCE_LIMIT),
        operations: Math.max(0, operations.length - EVIDENCE_LIMIT),
      },
    });
    this.entries.sort((a, b) => score(a.frame, b.frame));
    this.entries.length = Math.min(this.entries.length, WORST_CAPTURE_FRAME_CAPACITY);
    const elapsed = performance.now() - started;
    this.overhead.calls++;
    this.overhead.totalMs += elapsed;
    this.overhead.maxMs = Math.max(this.overhead.maxMs, elapsed);
  }

  report(): {
    totalFrames: number;
    framesWithScripts: number;
    worstFrames: CaptureFrameEvidence[];
    observerOverhead: { calls: number; totalMs: number; maxMs: number };
  } {
    return {
      totalFrames: this.totalFrames,
      framesWithScripts: this.framesWithScripts,
      worstFrames: [...this.entries],
      observerOverhead: { ...this.overhead },
    };
  }
}

function overlaps(at: number, duration: number, from: number, until: number): boolean {
  return at <= until && at + duration >= from;
}

function score(a: LongFrameSummary, b: LongFrameSummary): number {
  return b.blockingMs - a.blockingMs || b.durationMs - a.durationMs;
}
