import path from "node:path";
import { describe, expect, test } from "vitest";

import { GitOperationLogService } from "./git-operation-log.js";

const repoA = path.resolve(path.join("/tmp", "otto-git-log-a"));
const repoB = path.resolve(path.join("/tmp", "otto-git-log-b"));

function seed(log: GitOperationLogService, cwd: string, operation: "commit" | "pull"): void {
  log.append({ cwd, operation, level: "info", text: `${operation} in ${cwd}` });
}

describe("GitOperationLogService.deleteForCwd", () => {
  test("drops every operation's buffer for that directory and leaves other directories alone", () => {
    const log = new GitOperationLogService();
    seed(log, repoA, "commit");
    seed(log, repoA, "pull");
    seed(log, repoB, "commit");

    log.deleteForCwd(repoA);

    expect(log.getEntries(repoA, "commit")).toEqual([]);
    expect(log.getEntries(repoA, "pull")).toEqual([]);
    expect(log.getEntries(repoB, "commit")).toHaveLength(1);
  });

  test("matches the directory regardless of how the caller spelled the path", () => {
    const log = new GitOperationLogService();
    seed(log, repoA, "commit");

    log.deleteForCwd(path.join(repoA, "nested", ".."));

    expect(log.getEntries(repoA, "commit")).toEqual([]);
  });

  // The buffer and its sequence counter are one unit: leaving the counter behind
  // would leak the exact key the buffer was dropped to release, and would hand a
  // re-opened workspace a backfill-empty pane whose first live entry is seq 400.
  test("resets the sequence counter so a re-opened directory starts clean", () => {
    const log = new GitOperationLogService();
    seed(log, repoA, "commit");
    seed(log, repoA, "commit");

    log.deleteForCwd(repoA);
    seed(log, repoA, "commit");

    expect(log.getEntries(repoA, "commit").map((entry) => entry.seq)).toEqual([1]);
  });

  test("is a no-op for a directory that never logged anything", () => {
    const log = new GitOperationLogService();
    seed(log, repoA, "commit");

    log.deleteForCwd(repoB);

    expect(log.getEntries(repoA, "commit")).toHaveLength(1);
  });
});
