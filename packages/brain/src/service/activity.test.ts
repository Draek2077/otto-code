import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveBrainPaths } from "../config/paths.js";
import {
  beginActivity,
  chunkHasContent,
  chunkHasReasoning,
  clearActivity,
  readActivity,
  ReasoningTracker,
  withActivity,
} from "./activity.js";

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "otto-brain-activity-"));
  env = { ...process.env, OTTO_HOME: home };
  // The tests that plant a record by hand write straight to the path, so the
  // namespaced subdirectory has to exist before they do.
  mkdirSync(resolveBrainPaths(env).root, { recursive: true });
});

/** A pid high enough that no live process will ever hold it. */
const DEAD_PID = 2_147_483_646;

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("op activity", () => {
  it("reports nothing when no op is running", () => {
    expect(readActivity(env)).toBeNull();
  });

  it("round-trips an announced op", () => {
    beginActivity("calibrate", { target: "qwen3-30b", env });
    expect(readActivity(env)).toMatchObject({
      kind: "calibrate",
      target: "qwen3-30b",
      pid: process.pid,
    });
  });

  it("clears the record when the op ends", () => {
    const handle = beginActivity("sweep", { env });
    handle.end();
    expect(readActivity(env)).toBeNull();
  });

  it("clears a record whose process is gone rather than reporting forever", () => {
    // A calibrate killed with Ctrl-C never runs its own cleanup.
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(
      activityFile,
      JSON.stringify({ kind: "benchmark", pid: DEAD_PID, startedAt: new Date().toISOString() }),
    );
    expect(readActivity(env)).toBeNull();
    // And it is gone from disk, not merely hidden.
    expect(readActivity(env)).toBeNull();
  });

  it("does not let an ending op clear a newer one", () => {
    const first = beginActivity("scan", { env });
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(
      activityFile,
      JSON.stringify({
        kind: "benchmark",
        pid: process.pid + 1,
        startedAt: new Date().toISOString(),
      }),
    );
    first.end();
    expect(readActivity(env)).toMatchObject({ kind: "benchmark" });
    clearActivity(env);
  });

  it("ignores a kind it does not recognise", () => {
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(activityFile, JSON.stringify({ kind: "defragment", pid: process.pid }));
    expect(readActivity(env)).toBeNull();
  });

  it("survives a corrupt record", () => {
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(activityFile, "{not json");
    expect(readActivity(env)).toBeNull();
  });

  it("clamps progress into [0,1]", () => {
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(
      activityFile,
      JSON.stringify({ kind: "download", pid: process.pid, progress: 4.2 }),
    );
    expect(readActivity(env)?.progress).toBe(1);
  });

  it("clears the record even when the op throws", async () => {
    await expect(
      withActivity("benchmark", { env }, async () => {
        throw new Error("bench blew up");
      }),
    ).rejects.toThrow("bench blew up");
    expect(readActivity(env)).toBeNull();
  });

  it("never fails the op because the announce failed", async () => {
    // An unwritable home must not take the benchmark down with it.
    const result = await withActivity(
      "benchmark",
      { env: { ...process.env, OTTO_HOME: path.join(home, "no", "such", "\0bad") } },
      async () => "finished anyway",
    );
    expect(result).toBe("finished anyway");
  });
});

describe("ReasoningTracker", () => {
  it("reports processing from request start until the first model delta", () => {
    const tracker = new ReasoningTracker();
    tracker.begin("a");
    expect(tracker.snapshot).toEqual({
      activeRequests: 1,
      processing: 1,
      thinking: 0,
      generating: 0,
    });
  });

  it("is inactive until reasoning is seen", () => {
    const tracker = new ReasoningTracker();
    expect(tracker.active).toBe(false);
    tracker.observe("a", 'data: {"delta":{"type":"text_delta","text":"hi"}}');
    expect(tracker.active).toBe(false);
  });

  it("goes active on a reasoning delta", () => {
    const tracker = new ReasoningTracker();
    tracker.observe("a", 'data: {"delta":{"type":"thinking_delta","thinking":"hmm"}}');
    expect(tracker.active).toBe(true);
  });

  it("stops thinking once content starts", () => {
    const tracker = new ReasoningTracker();
    tracker.observe("a", '{"reasoning_content":"hmm"}');
    expect(tracker.active).toBe(true);
    tracker.observe("a", '{"content":"the answer"}');
    expect(tracker.active).toBe(false);
  });

  it("distinguishes parallel processing, thinking, and generating requests", () => {
    const tracker = new ReasoningTracker();
    tracker.begin("processing");
    tracker.begin("thinking");
    tracker.begin("generating");
    tracker.observe("thinking", '{"reasoning_content":"hmm"}');
    tracker.observe("generating", '{"content":"answer"}');
    expect(tracker.snapshot).toEqual({
      activeRequests: 3,
      processing: 1,
      thinking: 1,
      generating: 1,
    });
  });

  it("recognises a stage field split across transport chunks", () => {
    const tracker = new ReasoningTracker();
    tracker.begin("a");
    tracker.observe("a", 'data: {"delta":{"reasoning_');
    tracker.observe("a", 'content":"hmm"}}\n\n');
    expect(tracker.snapshot.thinking).toBe(1);
  });

  it("tracks runtimes that leave reasoning inside think tags", () => {
    const tracker = new ReasoningTracker();
    tracker.begin("a");
    tracker.observe("a", '{"content":"<think>"}');
    tracker.observe("a", '{"content":"working through it"}');
    expect(tracker.snapshot.thinking).toBe(1);
    tracker.observe("a", '{"content":"</think>"}');
    expect(tracker.snapshot.generating).toBe(1);
  });

  it("does not go back to thinking after content has started", () => {
    const tracker = new ReasoningTracker();
    tracker.observe("a", '{"content":"the answer"}');
    tracker.observe("a", '{"reasoning_content":"more"}');
    expect(tracker.active).toBe(false);
  });

  it("keeps one request's thought alive while another finishes", () => {
    const tracker = new ReasoningTracker();
    tracker.observe("a", '{"reasoning_content":"hmm"}');
    tracker.observe("b", '{"reasoning_content":"also hmm"}');
    expect(tracker.count).toBe(2);
    tracker.end("a");
    expect(tracker.active).toBe(true);
    tracker.end("b");
    expect(tracker.active).toBe(false);
  });

  it("releases the flag when a stream is abandoned", () => {
    const tracker = new ReasoningTracker();
    tracker.observe("a", '{"reasoning_content":"hmm"}');
    tracker.end("a");
    expect(tracker.active).toBe(false);
  });
});

describe("chunk predicates", () => {
  it("recognises both API shapes' reasoning", () => {
    expect(chunkHasReasoning('{"type":"thinking_delta"}')).toBe(true);
    expect(chunkHasReasoning('{"reasoning_content":"x"}')).toBe(true);
    expect(chunkHasReasoning('{"content":"x"}')).toBe(false);
    expect(chunkHasReasoning('{"content":"a reasoning answer"}')).toBe(false);
  });

  it("recognises both API shapes' content", () => {
    expect(chunkHasContent('{"type":"text_delta","text":"x"}')).toBe(true);
    expect(chunkHasContent('{"content":"x"}')).toBe(true);
    // An empty content delta is not content: it rides on every chunk of some
    // builds and would end the thought on the very first one.
    expect(chunkHasContent('{"content":""}')).toBe(false);
  });

  it("treats tool-call output as generation rather than silent processing", () => {
    expect(chunkHasContent('{"delta":{"tool_calls":[{"index":0}]}}')).toBe(true);
    expect(chunkHasContent('{"type":"input_json_delta","partial_json":"{}"}')).toBe(true);
  });
});
