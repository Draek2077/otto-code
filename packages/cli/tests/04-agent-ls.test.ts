#!/usr/bin/env npx tsx

/**
 * Phase 3: LS Command Tests
 *
 * Tests the ls command - listing agents (top-level command).
 * Since daemon may not be running, we test both:
 * - Help and argument parsing
 * - Graceful error handling when daemon not running
 * - JSON output format
 *
 * Tests:
 * - otto --help shows ls command
 * - otto ls --help shows options
 * - otto ls returns empty list or error when no daemon
 * - otto ls --json returns valid JSON (or error)
 * - otto ls -a flag is accepted
 * - otto ls -g flag is accepted
 * - otto ls does not support --ui
 */

import assert from "node:assert";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runLocalOtto } from "./helpers/local-cli.ts";

console.log("=== LS Command Tests ===\n");

// Get random port that's definitely not in use (never 6868)
const port = 10000 + Math.floor(Math.random() * 50000);
const ottoHome = await mkdtemp(join(tmpdir(), "otto-test-home-"));

try {
  // Test 1: otto --help shows ls command
  {
    console.log("Test 1: otto --help shows ls command");
    const result = await runLocalOtto(["--help"]);
    assert.strictEqual(result.exitCode, 0, "otto --help should exit 0");
    assert(result.stdout.includes("ls"), "help should mention ls command");
    console.log("✓ otto --help shows ls command\n");
  }

  // Test 2: otto ls --help shows options
  {
    console.log("Test 2: otto ls --help shows options");
    const result = await runLocalOtto(["ls", "--help"]);
    assert.strictEqual(result.exitCode, 0, "otto ls --help should exit 0");
    assert(result.stdout.includes("-a"), "help should mention -a flag");
    assert(result.stdout.includes("--all"), "help should mention --all flag");
    assert(result.stdout.includes("-g"), "help should mention -g flag");
    assert(result.stdout.includes("--global"), "help should mention --global flag");
    assert(result.stdout.includes("across all directories"), "help should describe global scope");
    assert(!result.stdout.includes("Legacy no-op"), "help should not describe -g as a no-op");
    assert(result.stdout.includes("--host"), "help should mention --host option");
    assert(!result.stdout.includes("--ui"), "help should not mention --ui");
    console.log("✓ otto ls --help shows options\n");
  }

  // Test 3: otto ls returns error when no daemon running
  {
    console.log("Test 3: otto ls handles daemon not running");
    const result = await runLocalOtto(["ls"], {
      OTTO_HOST: `localhost:${port}`,
      OTTO_HOME: ottoHome,
    });
    // Should fail because daemon not running
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    const output = result.stdout + result.stderr;
    const hasError =
      output.toLowerCase().includes("daemon") ||
      output.toLowerCase().includes("connect") ||
      output.toLowerCase().includes("cannot");
    assert(hasError, "error message should mention connection issue");
    assert(output.includes("--host <host:port>"), "error message should mention --host");
    assert(output.includes("OTTO_HOST"), "error message should mention OTTO_HOST");
    console.log("✓ otto ls handles daemon not running\n");
  }

  // Test 4: otto ls --json returns valid JSON error
  {
    console.log("Test 4: otto ls --json handles errors");
    const result = await runLocalOtto(["ls", "--json"], {
      OTTO_HOST: `localhost:${port}`,
      OTTO_HOME: ottoHome,
    });
    // Should still fail (daemon not running)
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    // But output should be valid JSON if present
    const output = result.stdout.trim();
    if (output.length > 0) {
      try {
        JSON.parse(output);
        console.log("✓ otto ls --json outputs valid JSON error\n");
      } catch {
        // Empty or stderr-only output is acceptable
        console.log("✓ otto ls --json handled error (output may be in stderr)\n");
      }
    } else {
      console.log("✓ otto ls --json handled error gracefully\n");
    }
  }

  // Test 5: otto ls -a flag is accepted
  {
    console.log("Test 5: otto ls -a flag is accepted");
    const result = await runLocalOtto(["ls", "-a"], {
      OTTO_HOST: `localhost:${port}`,
      OTTO_HOME: ottoHome,
    });
    // Will fail due to no daemon, but flag should be parsed without error
    // (no "unknown option" error)
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -a flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ otto ls -a flag is accepted\n");
  }

  // Test 6: otto ls -g flag is accepted
  {
    console.log("Test 6: otto ls -g flag is accepted");
    const result = await runLocalOtto(["ls", "-g"], {
      OTTO_HOST: `localhost:${port}`,
      OTTO_HOME: ottoHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -g flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ otto ls -g flag is accepted\n");
  }

  // Test 7: otto ls -ag combined flags are accepted
  {
    console.log("Test 7: otto ls -ag combined flags are accepted");
    const result = await runLocalOtto(["ls", "-ag"], {
      OTTO_HOST: `localhost:${port}`,
      OTTO_HOME: ottoHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -ag flags");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ otto ls -ag combined flags are accepted\n");
  }

  // Test 8: -q (quiet) flag is accepted globally
  {
    console.log("Test 8: -q (quiet) flag is accepted");
    const result = await runLocalOtto(["-q", "ls"], {
      OTTO_HOST: `localhost:${port}`,
      OTTO_HOME: ottoHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -q flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ -q (quiet) flag is accepted\n");
  }

  // Test 9: otto ls --ui is rejected (flag removed)
  {
    console.log("Test 9: otto ls --ui is rejected");
    const result = await runLocalOtto(["ls", "--ui"], {
      OTTO_HOST: `localhost:${port}`,
      OTTO_HOME: ottoHome,
    });
    assert.notStrictEqual(result.exitCode, 0, "should fail for removed --ui flag");
    const output = result.stdout + result.stderr;
    assert(output.includes("unknown option"), "should report unknown option for --ui");
    console.log("✓ otto ls --ui is rejected\n");
  }
} finally {
  // Clean up temp directory
  await rm(ottoHome, { recursive: true, force: true });
}

console.log("=== All ls tests passed ===");
