#!/usr/bin/env npx tsx

import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveOttoHomePath, resolveOttoWorktreesDir } from "../src/commands/worktree/ls.js";

console.log("=== Worktree LS Path Helper Tests ===\n");

const originalOttoHome = process.env.OTTO_HOME;

try {
  {
    console.log("Test 1: resolves explicit OTTO_HOME when set");
    const explicitHome = join("/tmp", "otto-explicit-home");
    process.env.OTTO_HOME = explicitHome;

    assert.strictEqual(resolveOttoHomePath(), explicitHome);
    // join(), not a literal: the resolver joins, so the expectation has to use
    // the host separator or this only ever passes on POSIX.
    assert.strictEqual(resolveOttoWorktreesDir(), join(explicitHome, "worktrees"));
    console.log("\u2713 explicit OTTO_HOME is respected\n");
  }

  {
    console.log("Test 2: falls back to homedir/.otto when OTTO_HOME is unset");
    delete process.env.OTTO_HOME;

    assert.strictEqual(resolveOttoHomePath(), join(homedir(), ".otto"));
    assert.strictEqual(resolveOttoWorktreesDir(), join(homedir(), ".otto", "worktrees"));
    console.log("\u2713 fallback home path is derived from os.homedir()\n");
  }
} finally {
  if (originalOttoHome === undefined) {
    delete process.env.OTTO_HOME;
  } else {
    process.env.OTTO_HOME = originalOttoHome;
  }
}

console.log("=== All worktree ls path helper tests passed ===");
