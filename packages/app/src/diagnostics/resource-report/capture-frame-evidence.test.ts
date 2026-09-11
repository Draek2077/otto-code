import { describe, expect, test, vi } from "vitest";
import {
  CaptureFrameEvidenceRecorder,
  WORST_CAPTURE_FRAME_CAPACITY,
} from "./capture-frame-evidence";
import type { LongFrameSummary } from "./long-frame-attribution";
import type { CaptureOperation } from "./capture-operations";

const frame = (at: number, blockingMs = 100): LongFrameSummary => ({
  at,
  durationMs: blockingMs + 50,
  blockingMs,
  styleAndLayoutMs: 1,
  scripts: [],
});
const empty = () => ({ domWrites: [], dispatches: [], operations: [] });

describe("worst frame retention", () => {
  test("keeps an early severe stall and its evidence after later rings roll over", () => {
    const recorder = new CaptureFrameEvidenceRecorder(1000);
    recorder.record(frame(1100, 900), () => ({
      ...empty(),
      operations: [
        {
          id: 1,
          name: "timeline.apply",
          kind: "sync",
          at: 1080,
          durationMs: 50,
          status: "complete",
        },
      ],
    }));
    for (let i = 0; i < 600; i++) recorder.record(frame(3000 + i * 100), empty);
    const report = recorder.report();
    expect(report.totalFrames).toBe(601);
    expect(report.worstFrames).toHaveLength(WORST_CAPTURE_FRAME_CAPACITY);
    expect(report.worstFrames[0].frame.blockingMs).toBe(900);
    expect(report.worstFrames[0].operations[0].name).toBe("timeline.apply");
    const collect = vi.fn(empty);
    recorder.record(frame(100000, 0), collect);
    expect(collect).not.toHaveBeenCalled();
  });

  test("excludes pre-capture frames and bounds evidence with explicit omission counts", () => {
    const recorder = new CaptureFrameEvidenceRecorder(1000);
    recorder.record(frame(999), empty);
    const operations: CaptureOperation[] = Array.from({ length: 150 }, (_, id) => ({
      id,
      name: "work",
      kind: "sync",
      at: 1050,
      durationMs: 10,
      status: "complete",
    }));
    recorder.record(frame(1100), () => ({ ...empty(), operations }));
    const report = recorder.report();
    expect(report.totalFrames).toBe(1);
    expect(report.framesWithScripts).toBe(0);
    expect(report.worstFrames[0].operations).toHaveLength(100);
    expect(report.worstFrames[0].omitted.operations).toBe(50);
  });
});
