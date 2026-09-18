import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOttoClient } from "@otto-code/client";
import { createE2ETestContext } from "./helpers/test-daemon.ts";
import { waitForTerminalOutput } from "./helpers/terminal.ts";

const ctx = await createE2ETestContext({ timeout: 30_000 });
const sdk = createOttoClient({ url: `${ctx.wsUrl}/ws`, reconnect: { enabled: false } });
// Otto keeps one live workspace per directory (docs/workspace-lifecycle.md), so
// the second workspace gets its own directory rather than sharing ctx.workDir.
const featureDir = await mkdtemp(join(tmpdir(), "otto-e2e-feature-"));

async function cli(args: string[]) {
  const result = await ctx.otto([...args, "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout);
}

try {
  await sdk.connect();
  const first = await sdk.workspaces.create({
    source: { kind: "directory", path: ctx.workDir },
    title: "main",
  });
  const second = await sdk.workspaces.create({
    source: { kind: "directory", path: featureDir },
    title: "feature-work",
  });
  const main = await cli(["terminal", "create", "--cwd", ctx.workDir, "--name", "Main"]);
  assert.equal(main.workspaceId, first.id);
  const feature = await cli(["terminal", "create", "--workspace", second.id, "--name", "Feature"]);
  assert.deepEqual(feature, {
    id: feature.id,
    name: "Feature",
    cwd: featureDir,
    workspaceId: second.id,
  });
  assert.deepEqual(await cli(["terminal", "ls", "--workspace", second.id]), [feature]);
  assert.deepEqual(await cli(["terminal", "ls", "--cwd", ctx.workDir]), [main]);
  assert.deepEqual(await cli(["terminal", "ls", "--cwd", featureDir]), [feature]);
  assert.deepEqual(await cli(["terminal", "ls", "--all"]), [main, feature]);
  const invalid = await ctx.otto([
    "terminal",
    "create",
    "--workspace",
    "wks_missing",
    "--cwd",
    ctx.workDir,
    "--json",
  ]);
  assert.notEqual(invalid.exitCode, 0);
  assert.match(invalid.stderr, /not active or does not exist/);
  const conflict = await ctx.otto(["terminal", "ls", "--all", "--workspace", second.id]);
  assert.notEqual(conflict.exitCode, 0);

  const terminal = await second.terminals.create({
    command: process.execPath,
    args: [
      "-e",
      "process.stdin.setRawMode(true); process.stdin.resume(); console.log('READY'); let hex = ''; process.stdin.on('data', data => { hex += data.toString('hex'); console.log('HEX:' + hex); });",
    ],
  });
  await waitForTerminalOutput(ctx.otto, terminal.id, "READY");
  assert.deepEqual(await cli(["terminal", "send-keys", terminal.id, "-l", "Enter"]), {
    terminalId: terminal.id,
    keysSent: 5,
  });
  await waitForTerminalOutput(ctx.otto, terminal.id, "HEX:456e746572");
  assert.deepEqual(await cli(["terminal", "send-keys", terminal.id, "Enter"]), {
    terminalId: terminal.id,
    keysSent: 1,
  });
  await waitForTerminalOutput(ctx.otto, terminal.id, "HEX:456e7465720d");
  assert.deepEqual(await cli(["terminal", "kill", terminal.id]), {
    terminalId: terminal.id,
    success: true,
  });
  await cli(["terminal", "kill", feature.id]);
  assert.deepEqual(await cli(["terminal", "ls", "--workspace", second.id]), []);
  assert.deepEqual(await cli(["terminal", "ls", "--workspace", first.id]), [main]);
  console.log("Terminal workspace CLI: ownership, lists, input, capture, kill, and errors passed");
} finally {
  await sdk.close();
  await ctx.stop();
  await rm(featureDir, { recursive: true, force: true });
}
