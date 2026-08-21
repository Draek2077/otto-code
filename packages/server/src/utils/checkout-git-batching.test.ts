import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const spawnCounters = vi.hoisted(() => ({
  trackedTextDiffCalls: 0,
}));

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const [command, commandArgs] = args;
      if (command === "git" && Array.isArray(commandArgs)) {
        const normalizedArgs = commandArgs.map((arg) => String(arg));
        // `runGitCommand` always prepends pinned `-c key=value` pairs; skip them
        // to find the actual git subcommand.
        let subcommandIndex = 0;
        while (normalizedArgs[subcommandIndex] === "-c") {
          subcommandIndex += 2;
        }
        const isTrackedTextDiff =
          normalizedArgs[subcommandIndex] === "diff" &&
          normalizedArgs.includes("HEAD") &&
          !normalizedArgs.includes("--numstat") &&
          !normalizedArgs.includes("--no-index") &&
          !normalizedArgs.includes("--shortstat") &&
          !normalizedArgs.includes("--name-status");
        if (isTrackedTextDiff) {
          spawnCounters.trackedTextDiffCalls += 1;
        }
      }
      return actual.spawn(...args);
    },
  };
});

import { getCheckoutDiff } from "./checkout-git.js";
import { startGitCommandMetrics, stopGitCommandMetrics } from "./run-git-command.js";

function initRepoWithTrackedChanges(fileCount: number): { tempDir: string; repoDir: string } {
  const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "checkout-git-batch-test-")));
  const repoDir = join(tempDir, "repo");

  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `before-${i}\n`);
  }
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
    cwd: repoDir,
  });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `after-${i}\n`);
  }

  return { tempDir, repoDir };
}

describe("checkout git diff batching", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    const setup = initRepoWithTrackedChanges(4);
    tempDir = setup.tempDir;
    repoDir = setup.repoDir;
    spawnCounters.trackedTextDiffCalls = 0;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("bounds initial structured diff reads so they cannot starve unrelated git RPCs", async () => {
    startGitCommandMetrics();
    const result = await getCheckoutDiff(repoDir, { mode: "uncommitted", includeStructured: true });
    const metrics = stopGitCommandMetrics();

    expect(result.diff).toContain("file-0.txt");
    expect(result.diff).toContain("file-3.txt");
    expect(spawnCounters.trackedTextDiffCalls).toBe(4);
    expect(metrics.maxConcurrent).toBeLessThanOrEqual(2);
  }, 15_000);
});
