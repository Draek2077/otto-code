import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";

import { claudeProjectDirSync } from "./project-dir.js";
import { WorkflowTranscriptWatcher } from "./workflow-transcript-watcher.js";

const CONFIG_DIR = path.join(os.tmpdir(), "otto-wf-watcher-test-home");
const CWD = path.join(os.tmpdir(), "otto-wf-watcher-test-repo");
const SESSION_ID = "sess-123";
const WORKFLOW_KEY = "toolu_wf";

function baseWorkflowsDir(): string {
  return path.join(
    claudeProjectDirSync(CWD, { configDir: CONFIG_DIR }),
    SESSION_ID,
    "subagents",
    "workflows",
  );
}

function writeJsonl(file: string, objects: unknown[]): void {
  fs.writeFileSync(file, objects.map((o) => JSON.stringify(o)).join("\n") + "\n", "utf8");
}

function silentLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {} };
}

/** Run-state file: <projectDir>/<sessionId>/workflows/<wf_runId>.json (written at completion). */
function writeRunState(runDirName: string, state: unknown): void {
  const sessionDir = path.join(claudeProjectDirSync(CWD, { configDir: CONFIG_DIR }), SESSION_ID);
  fs.mkdirSync(path.join(sessionDir, "workflows"), { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "workflows", `${runDirName}.json`), JSON.stringify(state));
}

/** A run dir with one agent whose transcript starts with the given user prompt. */
function writeRunDir(runDirName: string, agentId: string, prompt: string): string {
  const runDir = path.join(baseWorkflowsDir(), runDirName);
  fs.mkdirSync(runDir, { recursive: true });
  writeJsonl(path.join(runDir, "journal.jsonl"), [{ type: "started", key: "v2:x", agentId }]);
  writeJsonl(path.join(runDir, `agent-${agentId}.jsonl`), [
    { type: "user", uuid: `u-${agentId}`, message: { role: "user", content: prompt } },
  ]);
  return runDir;
}

function announcesFor(events: AgentStreamEvent[], childKey: string) {
  return events.filter(
    (e) =>
      e.type === "observed_subagent_updated" &&
      e.update.key === childKey &&
      e.update.status === "running" &&
      e.update.parentKey !== undefined,
  );
}

describe("WorkflowTranscriptWatcher", () => {
  let events: AgentStreamEvent[];
  let watcher: WorkflowTranscriptWatcher;

  beforeEach(() => {
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    events = [];
    watcher = new WorkflowTranscriptWatcher({
      workflowKey: WORKFLOW_KEY,
      sessionId: SESSION_ID,
      cwd: CWD,
      configDir: CONFIG_DIR,
      emit: (event) => events.push(event),
      logger: silentLogger(),
      claimedDirs: new Set<string>(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  });

  it("binds the run dir, announces a nested child, and streams its timeline", () => {
    vi.useFakeTimers();
    watcher.arm(); // snapshots (empty) + one immediate tick before any dir exists

    // The workflow engine now creates the run dir and starts writing an agent.
    const runDir = path.join(baseWorkflowsDir(), "wf_abc-1");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "agent-a1.meta.json"),
      JSON.stringify({ agentType: "Explore" }),
    );
    writeJsonl(path.join(runDir, "journal.jsonl"), [
      { type: "started", key: "v2:x", agentId: "a1" },
    ]);
    writeJsonl(path.join(runDir, "agent-a1.jsonl"), [
      {
        type: "user",
        uuid: "u1",
        message: { role: "user", content: "Investigate the RPC schemas" },
      },
      {
        type: "assistant",
        uuid: "as1",
        message: {
          id: "m1",
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_r", name: "Read", input: { file_path: "/x.ts" } },
          ],
          usage: { output_tokens: 40 },
        },
      },
    ]);

    vi.advanceTimersByTime(700); // interval fires → bind + scan

    const updates = events.filter((e) => e.type === "observed_subagent_updated");
    const childKey = `${WORKFLOW_KEY}::wfagent:a1`;
    // The child is announced running, nested under the workflow row, titled by its non-generic agentType.
    const announce = updates.find(
      (e) =>
        e.type === "observed_subagent_updated" &&
        e.update.key === childKey &&
        e.update.status === "running",
    );
    expect(announce).toBeTruthy();
    if (announce?.type === "observed_subagent_updated") {
      expect(announce.update.parentKey).toBe(WORKFLOW_KEY);
      expect(announce.update.subAgentType).toBe("Explore");
    }

    // Its transcript streams as timeline items keyed to the child.
    const timeline = events.filter(
      (e) => e.type === "observed_subagent_timeline" && e.key === childKey,
    );
    expect(
      timeline.some(
        (e) => e.type === "observed_subagent_timeline" && e.item.type === "user_message",
      ),
    ).toBe(true);
    expect(
      timeline.some(
        (e) =>
          e.type === "observed_subagent_timeline" &&
          e.item.type === "tool_call" &&
          e.item.name === "Read",
      ),
    ).toBe(true);
  });

  it("reconciles authoritative tokens and terminal state from the run-state file on disarm", () => {
    vi.useFakeTimers();
    watcher.arm();

    const runDir = path.join(baseWorkflowsDir(), "wf_abc-2");
    fs.mkdirSync(runDir, { recursive: true });
    writeJsonl(path.join(runDir, "agent-a1.jsonl"), [
      { type: "user", uuid: "u1", message: { role: "user", content: "task" } },
    ]);
    vi.advanceTimersByTime(700); // bind + first scan (announces child)

    // The engine finishes and writes the run-state file (sibling of subagents/).
    const sessionDir = path.join(claudeProjectDirSync(CWD, { configDir: CONFIG_DIR }), SESSION_ID);
    fs.mkdirSync(path.join(sessionDir, "workflows"), { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, "workflows", "wf_abc-2.json"),
      JSON.stringify({
        workflowProgress: [
          { type: "workflow_agent", agentId: "a1", label: "schemas", state: "done", tokens: 40229 },
          { type: "workflow_phase", index: 1, title: "Read" },
        ],
      }),
    );

    watcher.disarm("idle");

    const childKey = `${WORKFLOW_KEY}::wfagent:a1`;
    const settle = events.findLast(
      (e) => e.type === "observed_subagent_updated" && e.update.key === childKey,
    );
    expect(settle?.type).toBe("observed_subagent_updated");
    if (settle?.type === "observed_subagent_updated") {
      expect(settle.update.status).toBe("idle");
      expect(settle.update.cumulativeTokens).toBe(40229);
    }
  });

  it("binds a live run dir created just before arm (create-dir vs task_started race)", () => {
    // The engine writes wf_<runId>/ BEFORE task_started reaches the provider:
    // the dir already exists at arm time and must still be bound.
    writeRunDir("wf_pre-1", "a1", "Pre-arm agent prompt");

    vi.useFakeTimers();
    watcher.arm(); // immediate first tick

    const childKey = `${WORKFLOW_KEY}::wfagent:a1`;
    expect(announcesFor(events, childKey)).toHaveLength(1);
  });

  it("never binds a pre-arm dir whose completed run-state names another task", () => {
    writeRunDir("wf_stale-1", "old1", "Old finished run");
    writeRunState("wf_stale-1", { taskId: "task-other", workflowProgress: [] });

    vi.useFakeTimers();
    const claimed = new Set<string>();
    const w = new WorkflowTranscriptWatcher({
      workflowKey: "toolu_mine",
      taskId: "task-mine",
      sessionId: SESSION_ID,
      cwd: CWD,
      configDir: CONFIG_DIR,
      emit: (event) => events.push(event),
      logger: silentLogger(),
      claimedDirs: claimed,
    });
    w.arm();
    vi.advanceTimersByTime(2_100);

    expect(events).toHaveLength(0);
    expect(claimed.size).toBe(0);
    w.disarm("idle");
  });

  it("two concurrent watchers bind their own dirs via the run-state taskId, not arrival order", () => {
    // Both dirs completed on disk with identity available — each watcher must
    // take the dir whose run-state taskId matches its own, regardless of
    // readdir order or which watcher ticks first.
    writeRunDir("wf_one", "a-one", "Prompt for run one");
    writeRunDir("wf_two", "a-two", "Prompt for run two");
    writeRunState("wf_one", { taskId: "task-1", workflowProgress: [] });
    writeRunState("wf_two", { taskId: "task-2", workflowProgress: [] });

    vi.useFakeTimers();
    const claimed = new Set<string>();
    const make = (workflowKey: string, taskId: string) =>
      new WorkflowTranscriptWatcher({
        workflowKey,
        taskId,
        sessionId: SESSION_ID,
        cwd: CWD,
        configDir: CONFIG_DIR,
        emit: (event) => events.push(event),
        logger: silentLogger(),
        claimedDirs: claimed,
      });
    // Arm in reverse order of dir creation to make cross-binding the naive outcome.
    const w2 = make("toolu_two", "task-2");
    const w1 = make("toolu_one", "task-1");
    w2.arm();
    w1.arm();
    vi.advanceTimersByTime(1_400);

    const oneAnnounces = announcesFor(events, "toolu_one::wfagent:a-one");
    const twoAnnounces = announcesFor(events, "toolu_two::wfagent:a-two");
    expect(oneAnnounces).toHaveLength(1);
    expect(twoAnnounces).toHaveLength(1);
    // No cross-bound children (run one's agent under run two's key or vice versa).
    expect(announcesFor(events, "toolu_one::wfagent:a-two")).toHaveLength(0);
    expect(announcesFor(events, "toolu_two::wfagent:a-one")).toHaveLength(0);
    w1.disarm("idle");
    w2.disarm("idle");
  });

  it("releases a mis-bound dir when its run-state taskId mismatches, then rebinds the right one", () => {
    vi.useFakeTimers();
    const claimed = new Set<string>();
    const w = new WorkflowTranscriptWatcher({
      workflowKey: "toolu_mine",
      taskId: "task-mine",
      sessionId: SESSION_ID,
      cwd: CWD,
      configDir: CONFIG_DIR,
      emit: (event) => events.push(event),
      logger: silentLogger(),
      claimedDirs: claimed,
    });
    w.arm();

    // Another run's dir appears first (no run-state yet → heuristic bind).
    writeRunDir("wf_other", "other1", "Other run's prompt");
    vi.advanceTimersByTime(700);
    expect(announcesFor(events, "toolu_mine::wfagent:other1")).toHaveLength(1);

    // The other run completes (identity now on disk) and our real dir appears.
    writeRunState("wf_other", { taskId: "task-other", workflowProgress: [] });
    writeRunDir("wf_mine", "mine1", "My run's prompt");
    vi.advanceTimersByTime(1_400); // mismatch tick + rebind tick

    // The wrongly-announced child was settled (closed), and our child announced.
    const closedOther = events.find(
      (e) =>
        e.type === "observed_subagent_updated" &&
        e.update.key === "toolu_mine::wfagent:other1" &&
        e.update.status === "closed",
    );
    expect(closedOther).toBeTruthy();
    expect(announcesFor(events, "toolu_mine::wfagent:mine1")).toHaveLength(1);
    w.disarm("idle");
  });

  it("stops discovery polling at the bind deadline when no run dir ever appears", () => {
    vi.useFakeTimers();
    watcher.arm();
    vi.advanceTimersByTime(120_000); // well past the 90s bind deadline

    // A dir appearing after the deadline is never bound — polling has stopped.
    writeRunDir("wf_late-1", "a1", "Too late");
    vi.advanceTimersByTime(3_500);
    expect(events).toHaveLength(0);
  });

  it("stops polling once the run is settled on disk, without losing pre-completion writes", () => {
    vi.useFakeTimers();
    watcher.arm();

    const runDir = writeRunDir("wf_done-1", "a1", "Finish fast");
    vi.advanceTimersByTime(700); // bind + announce
    const childKey = `${WORKFLOW_KEY}::wfagent:a1`;
    expect(announcesFor(events, childKey)).toHaveLength(1);

    // The engine finishes: journal result + run-state land.
    fs.appendFileSync(
      path.join(runDir, "journal.jsonl"),
      JSON.stringify({ type: "result", key: "v2:x", agentId: "a1" }) + "\n",
    );
    writeRunState("wf_done-1", { workflowProgress: [] });
    vi.advanceTimersByTime(1_400); // completion detected + one post-completion scan
    const settled = events.find(
      (e) =>
        e.type === "observed_subagent_updated" &&
        e.update.key === childKey &&
        e.update.status === "idle",
    );
    expect(settled).toBeTruthy();

    // Polling has stopped: later appends emit nothing (until disarm's final sweep).
    const countBefore = events.length;
    fs.appendFileSync(
      path.join(runDir, "agent-a1.jsonl"),
      JSON.stringify({
        type: "assistant",
        uuid: "late",
        message: { id: "m9", role: "assistant", content: [{ type: "text", text: "late" }] },
      }) + "\n",
    );
    vi.advanceTimersByTime(3_500);
    expect(events.length).toBe(countBefore);
  });

  it("re-asserts the settled status when a same-tick transcript chunk raises the token total", () => {
    vi.useFakeTimers();
    watcher.arm();

    const runDir = writeRunDir("wf_tok-1", "a1", "Count my tokens");
    vi.advanceTimersByTime(700); // bind + announce
    const childKey = `${WORKFLOW_KEY}::wfagent:a1`;
    expect(announcesFor(events, childKey)).toHaveLength(1);

    // The engine writes the final transcript chunk (with usage) and the journal
    // result before the next tick — the same-tick ordering that used to flip a
    // just-settled child back to 'running' via the token emit.
    fs.appendFileSync(
      path.join(runDir, "agent-a1.jsonl"),
      JSON.stringify({
        type: "assistant",
        uuid: "final",
        message: {
          id: "m2",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          usage: { output_tokens: 55 },
        },
      }) + "\n",
    );
    fs.appendFileSync(
      path.join(runDir, "journal.jsonl"),
      JSON.stringify({ type: "result", key: "v2:x", agentId: "a1" }) + "\n",
    );
    vi.advanceTimersByTime(700); // one tick: journal settles, then transcripts emit tokens

    const last = events.findLast(
      (e) => e.type === "observed_subagent_updated" && e.update.key === childKey,
    );
    expect(last?.type).toBe("observed_subagent_updated");
    if (last?.type === "observed_subagent_updated") {
      expect(last.update.status).toBe("idle");
      expect(last.update.cumulativeTokens).toBe(55);
    }
    watcher.disarm("idle");
  });

  it("disarm binds by run-state identity when the dir was claimed away the whole run", () => {
    // Starvation case: our dir is held by a mis-bound sibling for the entire
    // run, so tick-time discovery never binds. At disarm, the run-state's
    // taskId (ground truth) must override the claim so the rows backfill.
    writeRunDir("wf_starved", "s1", "Starved run prompt");
    writeRunState("wf_starved", {
      taskId: "task-mine",
      workflowProgress: [
        { type: "workflow_agent", agentId: "s1", label: "starved", state: "done", tokens: 123 },
      ],
    });

    vi.useFakeTimers();
    const claimed = new Set<string>([path.join(baseWorkflowsDir(), "wf_starved")]);
    const w = new WorkflowTranscriptWatcher({
      workflowKey: "toolu_starved",
      taskId: "task-mine",
      sessionId: SESSION_ID,
      cwd: CWD,
      configDir: CONFIG_DIR,
      emit: (event) => events.push(event),
      logger: silentLogger(),
      claimedDirs: claimed,
    });
    w.arm();
    vi.advanceTimersByTime(2_100); // discovery skips the claimed dir every tick
    expect(events).toHaveLength(0);

    w.disarm("idle");

    const childKey = "toolu_starved::wfagent:s1";
    expect(announcesFor(events, childKey)).toHaveLength(1);
    const settle = events.findLast(
      (e) => e.type === "observed_subagent_updated" && e.update.key === childKey,
    );
    expect(settle?.type).toBe("observed_subagent_updated");
    if (settle?.type === "observed_subagent_updated") {
      expect(settle.update.status).toBe("idle");
      expect(settle.update.cumulativeTokens).toBe(123);
    }
  });
});
