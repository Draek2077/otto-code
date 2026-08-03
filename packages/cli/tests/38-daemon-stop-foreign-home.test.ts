#!/usr/bin/env npx tsx

/**
 * Regression: `otto daemon stop` on a home that owns no daemon must not shut
 * down whatever daemon happens to be listening on that home's *configured*
 * address.
 *
 * The bug: `resolveLocalDaemonState` fell back to `config.listen` when the home
 * had no pid file, and `stopLocalDaemon` issued the lifecycle shutdown RPC
 * before checking whether the home owned anything. Since an unconfigured home
 * resolves to the global default (127.0.0.1:6868), every CLI test that ran
 * `otto daemon stop` against a throwaway OTTO_HOME reached across and killed the
 * user's real daemon -- which reported it as `client_shutdown_rpc`, not a crash.
 *
 * This test reproduces the shape without touching 6868: a stranger home whose
 * configured listen points at a *different* home's running daemon.
 */

import assert from "node:assert";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "./helpers/zx-shell.ts";
import { startTestDaemon, type TestDaemonContext } from "./helpers/test-daemon.ts";

$.verbose = false;

const testEnv = {
  OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  OTTO_DICTATION_ENABLED: process.env.OTTO_DICTATION_ENABLED ?? "0",
  OTTO_VOICE_MODE_ENABLED: process.env.OTTO_VOICE_MODE_ENABLED ?? "0",
};

async function isDaemonReachable(port: number): Promise<boolean> {
  const result =
    await $`OTTO_HOST=127.0.0.1:${port} OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD} OTTO_DICTATION_ENABLED=${testEnv.OTTO_DICTATION_ENABLED} OTTO_VOICE_MODE_ENABLED=${testEnv.OTTO_VOICE_MODE_ENABLED} npx otto agent ls --host 127.0.0.1:${port}`.nothrow();
  return result.exitCode === 0;
}

console.log("=== Daemon Stop (foreign home must not stop another home's daemon) ===\n");

// The victim stands in for the user's installed daemon on 6868.
let victim: TestDaemonContext | null = null;
const strangerHome = await mkdtemp(join(tmpdir(), "otto-stop-foreign-home-"));

try {
  console.log("Test 1: start a victim daemon in its own isolated home");
  victim = await startTestDaemon();
  assert(await isDaemonReachable(victim.port), "victim daemon should be reachable before stop");
  console.log(`✓ victim daemon running on port ${victim.port}\n`);

  console.log("Test 2: a stranger home configured at the victim's address owns no daemon");
  // Mirrors production: the stranger home's *configured* listen resolves to an
  // address that already has someone else's daemon on it. In the real bug this
  // was the 6868 default rather than an explicit config value.
  await writeFile(
    join(strangerHome, "config.json"),
    `${JSON.stringify({ daemon: { listen: `127.0.0.1:${victim.port}` } }, null, 2)}\n`,
  );
  assert.strictEqual(
    existsSync(join(strangerHome, "otto.pid")),
    false,
    "stranger home must not own a pid file",
  );
  console.log("✓ stranger home configured at the victim's address, owns no pid file\n");

  console.log("Test 3: `otto daemon stop` on the stranger home must leave the victim running");
  const stopResult =
    await $`OTTO_HOME=${strangerHome} OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD} OTTO_DICTATION_ENABLED=${testEnv.OTTO_DICTATION_ENABLED} OTTO_VOICE_MODE_ENABLED=${testEnv.OTTO_VOICE_MODE_ENABLED} npx otto daemon stop --home ${strangerHome} --json`.nothrow();
  assert.strictEqual(stopResult.exitCode, 0, `stop should succeed: ${stopResult.stderr}`);

  const stopJson = JSON.parse(stopResult.stdout) as {
    action?: unknown;
    usedLifecycleRpc?: unknown;
  };
  assert.strictEqual(stopJson.action, "not_running", "stop should report not_running");
  assert.notStrictEqual(
    stopJson.usedLifecycleRpc,
    true,
    "stop must not issue a lifecycle shutdown RPC from a home that owns no daemon",
  );

  assert(
    await isDaemonReachable(victim.port),
    "victim daemon must survive a stop issued from an unrelated home",
  );
  console.log("✓ victim daemon survived the stranger home's stop\n");

  console.log("Test 4: `--force` from the stranger home must also leave the victim running");
  const forceResult =
    await $`OTTO_HOME=${strangerHome} OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD} OTTO_DICTATION_ENABLED=${testEnv.OTTO_DICTATION_ENABLED} OTTO_VOICE_MODE_ENABLED=${testEnv.OTTO_VOICE_MODE_ENABLED} npx otto daemon stop --home ${strangerHome} --force --json`.nothrow();
  assert.strictEqual(forceResult.exitCode, 0, `forced stop should succeed: ${forceResult.stderr}`);
  assert(
    await isDaemonReachable(victim.port),
    "victim daemon must survive a forced stop issued from an unrelated home",
  );
  console.log("✓ victim daemon survived the stranger home's forced stop\n");
} finally {
  await victim?.stop().catch(() => undefined);
  await rm(strangerHome, { recursive: true, force: true });
}

console.log("=== Foreign-home stop regression test passed ===");
