import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { createBrainRunLog } from "./run-log.js";

test("Brain run log retains every source in one service session", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "otto-brain-log-"));
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
