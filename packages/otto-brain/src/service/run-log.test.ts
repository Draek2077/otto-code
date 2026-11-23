import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, utimesSync } from "node:fs";
import { fixtureRoot } from "../../test-fixtures.js";
import path from "node:path";
import { test } from "vitest";

import { createBrainRunLog, pruneBrainRunLogs } from "./run-log.js";

test("Brain run log retains every source in one service session", () => {
  const home = mkdtempSync(path.join(fixtureRoot(), "otto-brain-log-"));
  try {
    const log = createBrainRunLog({ OTTO_HOME: home });
    log.write("llama-server stdout: loading model");
    log.write("operation benchmark: task started");
    log.write("job brainjob_1 stderr: downloading 50%");

    const tail = log.tail(10);
    assert.equal(tail.total, 4);
    assert.ok(tail.lines.every((line) => line.startsWith("[brain] [server] ")));
    assert.deepEqual(
      tail.lines.map((line) => line.replace(/^\[brain\] \[server\] \S+ /, "")),
      [
        `Brain service started (pid ${process.pid})`,
        "llama-server stdout: loading model",
        "operation benchmark: task started",
        "job brainjob_1 stderr: downloading 50%",
      ],
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rapid service restarts keep distinct logs and bounded tails", () => {
  const home = mkdtempSync(path.join(fixtureRoot(), "brain-log-restart-"));
  try {
    const first = createBrainRunLog({ OTTO_HOME: home });
    const second = createBrainRunLog({ OTTO_HOME: home });
    assert.notEqual(first.path, second.path);
    first.write("old service\nold child");
    second.write("new service\r\nnew child");
    assert.equal(first.tail(1).lines.length, 1);
    assert.ok(first.tail(1).lines[0].endsWith("old child"));
    assert.ok(second.tail(1).lines[0].endsWith("new child"));
    assert.equal(second.tail(Number.NaN).total, 3);
    assert.equal(second.tail(-1).lines.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("retention only removes expired Brain session logs in the supplied owned fixture", () => {
  const home = mkdtempSync(path.join(fixtureRoot(), "brain-log-retention-"));
  try {
    const old = path.join(home, "expired-brain.log");
    const other = path.join(home, "unrelated.log");
    const current = path.join(home, "current-brain.log");
    for (const file of [old, other, current]) writeFileSync(file, "fixture");
    for (const file of [old, other]) utimesSync(file, new Date(0), new Date(0));
    pruneBrainRunLogs(home);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(other), true);
    assert.equal(existsSync(current), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
