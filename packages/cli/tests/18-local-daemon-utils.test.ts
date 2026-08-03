#!/usr/bin/env npx tsx

/**
 * Phase 18: Local daemon utility tests.
 *
 * Tests pure helpers that do not require a running daemon.
 */

import assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveLocalDaemonState,
  resolveTcpHostFromListen,
} from "../src/commands/daemon/local-daemon.js";

console.log("=== Local Daemon Utility Helpers ===\n");

{
  console.log("Test 1: resolves numeric listen values to localhost host:port");
  assert.strictEqual(resolveTcpHostFromListen("6868"), "127.0.0.1:6868");
  assert.strictEqual(resolveTcpHostFromListen("  7777  "), "127.0.0.1:7777");
  console.log("✓ resolves numeric listen values\n");
}

{
  console.log("Test 2: preserves explicit host:port listen values");
  assert.strictEqual(resolveTcpHostFromListen("localhost:6868"), "localhost:6868");
  assert.strictEqual(resolveTcpHostFromListen("0.0.0.0:8080"), "0.0.0.0:8080");
  console.log("✓ preserves explicit host:port values\n");
}

{
  console.log("Test 3: rejects unix socket listen values");
  assert.strictEqual(resolveTcpHostFromListen("/tmp/otto.sock"), null);
  assert.strictEqual(resolveTcpHostFromListen("unix:///tmp/otto.sock"), null);
  assert.strictEqual(resolveTcpHostFromListen("pipe://\\\\.\\pipe\\otto-managed-test"), null);
  assert.strictEqual(resolveTcpHostFromListen("\\\\.\\pipe\\otto-managed-test"), null);
  console.log("✓ rejects unix socket listen values\n");
}

{
  console.log("Test 4: rejects empty and non-host listen values");
  assert.strictEqual(resolveTcpHostFromListen(""), null);
  assert.strictEqual(resolveTcpHostFromListen("   "), null);
  assert.strictEqual(resolveTcpHostFromListen("localhost"), null);
  console.log("✓ rejects empty and non-host listen values\n");
}

{
  console.log("Test 5: rejects Windows absolute paths (not TCP endpoints)");
  assert.strictEqual(resolveTcpHostFromListen("C:\\Users\\foo\\.otto\\otto.sock"), null);
  assert.strictEqual(resolveTcpHostFromListen("D:\\project\\socket"), null);
  assert.strictEqual(resolveTcpHostFromListen("C:\\otto.sock"), null);
  console.log("✓ rejects Windows absolute paths\n");
}

{
  console.log("Test 6: tolerates null/undefined listen values");
  assert.strictEqual(resolveTcpHostFromListen(null), null);
  assert.strictEqual(resolveTcpHostFromListen(undefined), null);
  console.log("✓ tolerates null/undefined listen values\n");
}

{
  // Regression: a home with no pid file owns no daemon. `listen` may still fall
  // back to the configured address (needed by pair/status/onboard), but
  // `ownedListen` must stay null so lifecycle stops never reach across homes and
  // shut down a daemon this home does not own.
  console.log("Test 7: a home without a pid file exposes no owned listen address");
  const home = await mkdtemp(join(tmpdir(), "otto-owned-listen-"));
  try {
    const bare = resolveLocalDaemonState({ home });
    assert.strictEqual(bare.pidInfo, null, "fresh home should own no pid file");
    assert.strictEqual(bare.ownedListen, null, "fresh home should own no listen address");
    assert(bare.listen.endsWith(":6868"), `configured listen should default: ${bare.listen}`);

    await writeFile(
      join(home, "config.json"),
      `${JSON.stringify({ daemon: { listen: "127.0.0.1:6868" } }, null, 2)}\n`,
    );
    const configured = resolveLocalDaemonState({ home });
    assert.strictEqual(
      configured.listen,
      "127.0.0.1:6868",
      "configured listen should be reported for display",
    );
    assert.strictEqual(
      configured.ownedListen,
      null,
      "a configured address must not become an owned address without a pid file",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  console.log("✓ a home without a pid file exposes no owned listen address\n");
}

console.log("=== All local daemon utility tests passed ===");
