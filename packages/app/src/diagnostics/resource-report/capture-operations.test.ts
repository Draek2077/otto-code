import { afterEach, describe, expect, test } from "vitest";
import {
  CaptureOperationRecorder,
  captureOperations,
  traceCaptureAsync,
  traceCaptureSync,
} from "./capture-operations";

afterEach(() => {
  captureOperations.stop();
});

describe("capture operation lifetime", () => {
  test("freezes pending work at stop and ignores late completions across captures", () => {
    let time = 1000;
    const recorder = new CaptureOperationRecorder(() => time);
    recorder.start();
    const end = recorder.begin("chat.create", "async");
    time = 1200;
    const report = recorder.stop();
    expect(report.entries[0]).toMatchObject({ at: 1000, durationMs: 200, status: "pending" });
    recorder.start();
    end();
    expect(recorder.report().entries).toEqual([]);
    expect(report.entries[0].status).toBe("pending");
  });

  test("bounds both completed and unresolved operations", () => {
    const recorder = new CaptureOperationRecorder(() => 1000);
    recorder.start();
    for (let i = 0; i < 700; i++) recorder.begin("timeline.apply", "sync")();
    for (let i = 0; i < 200; i++) recorder.begin("audio.queue-and-play", "async");
    const result = recorder.report();
    expect(result.entries).toHaveLength(600);
    expect(result.dropped).toBe(300);
  });

  test("inactive tracing preserves promises and active tracing preserves results/errors", async () => {
    const promise = Promise.resolve(42);
    expect(traceCaptureAsync("inactive", () => promise)).toBe(promise);
    captureOperations.start();
    expect(traceCaptureSync("sync", () => 7)).toBe(7);
    const error = new Error("not retained in diagnostic");
    await expect(traceCaptureAsync("async", () => Promise.reject(error))).rejects.toBe(error);
    const fail = () => {
      throw error;
    };
    expect(() => traceCaptureSync("failure", fail)).toThrow(error);
    const report = captureOperations.report();
    expect(report.entries.map((entry) => entry.status)).toEqual(["complete", "error", "error"]);
    expect(JSON.stringify(report)).not.toContain(error.message);
  });
});
