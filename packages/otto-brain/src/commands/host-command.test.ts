import { expect, it } from "vitest";
import type { BrainJobStatus } from "../service/job-client.js";
import { commandJobProgress, withCommandSignal } from "./host-command.js";

function job(progress: unknown): BrainJobStatus {
  return { id: "fixture", state: "running", progress, result: null, error: null };
}
it("prints bounded measured progress without raw messages or terminal controls", () => {
  const lines: string[] = [];
  const receive = commandJobProgress((line) => lines.push(line));
  receive(
    job({
      phase: "loading",
      contextSize: 4096,
      error: "private fixture secret",
      reason: "\u001b[2J",
    }),
  );
  receive(
    job({
      phase: "downloading",
      receivedBytes: 1024,
      totalBytes: 2048,
      asset: "private fixture URL",
    }),
  );
  receive(job({ phase: "done", tokensPerSecond: 12.345 }));
  expect(lines).toEqual([
    "  loading context=4096\n",
    "  downloading received=1024 total=2048\n",
    "  done tok/s=12.3\n",
  ]);
});
it("deduplicates repeated progress while allowing later state changes", () => {
  const lines: string[] = [];
  const receive = commandJobProgress((line) => lines.push(line));
  receive(job({ phase: "generating", budget: 128 }));
  receive(job({ phase: "generating", budget: 128 }));
  receive(job({ phase: "done", budget: 128 }));
  expect(lines).toEqual(["  generating budget=128\n", "  done budget=128\n"]);
});
it("ignores malformed progress, unknown phases and nonfinite measurements", () => {
  const lines: string[] = [];
  const receive = commandJobProgress((line) => lines.push(line));
  for (const progress of [
    null,
    [],
    "private fixture",
    { phase: "\u001b[2J" },
    { phase: "failed", contextSize: Number.NaN, budget: Number.POSITIVE_INFINITY },
  ])
    receive(job(progress));
  expect(lines).toEqual(["  failed\n"]);
});
it("releases the command's signal handler when an external operation fails", async () => {
  const before = process.listenerCount("SIGINT");
  const primary = new Error("fixture external operation");
  await expect(
    withCommandSignal(async (signal) => {
      expect(signal.aborted).toBe(false);
      expect(process.listenerCount("SIGINT")).toBe(before + 1);
      throw primary;
    }),
  ).rejects.toBe(primary);
  expect(process.listenerCount("SIGINT")).toBe(before);
});
