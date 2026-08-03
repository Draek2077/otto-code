#!/usr/bin/env npx tsx

/**
 * Regression: the shell layer every other test in this suite rides on must pass
 * arguments through to the command unchanged.
 *
 * This exists because zx's own quoting silently corrupts Windows paths. It
 * emits bash ANSI-C literals (`$'...'`) with doubled backslashes, the MSYS
 * runtime behind Git Bash collapses those back to single ones while parsing the
 * Windows command line, and bash then reads the `\n` in `C:\nodejs` as a
 * newline. Nothing throws: the command just receives a mangled path. See
 * helpers/posix-shell.ts.
 */

import assert from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "./helpers/zx-shell.ts";

$.verbose = false;

console.log("=== Shell Quoting Tests ===\n");

const cases: { label: string; value: string }[] = [
  { label: "a host temp path", value: join(tmpdir(), "otto-test-home-abc") },
  { label: "the running node binary path", value: process.execPath },
  { label: "single quotes", value: "it's an agent's prompt" },
  { label: "double quotes", value: 'say "hello" now' },
  { label: "shell metacharacters", value: "$VAR `whoami` $(id) && echo no; rm -rf x | tee" },
  { label: "backslashes", value: String.raw`back\slash\nnot-a-newline\ttab` },
  { label: "a newline", value: "first\nsecond" },
  { label: "spaces and unicode", value: "  padded ✅ value  " },
  { label: "an empty string", value: "" },
];

for (const { label, value } of cases) {
  console.log(`Test: ${label}`);
  const result =
    await $`node -e ${"process.stdout.write(process.argv[1] ?? '')"} ${value}`.nothrow();
  assert.strictEqual(result.exitCode, 0, `${label}: command should exit 0`);
  assert.strictEqual(result.stdout, value, `${label}: argument should arrive unchanged`);
  console.log(`✓ ${label} survives the shell\n`);
}

console.log("Test: environment prefixes carry values verbatim");
{
  const home = join(tmpdir(), "otto-test-home-env check");
  const result =
    await $`OTTO_HOME=${home} node -e ${"process.stdout.write(process.env.OTTO_HOME ?? '')"}`.nothrow();
  assert.strictEqual(result.exitCode, 0, "env-prefixed command should exit 0");
  assert.strictEqual(result.stdout, home, "OTTO_HOME should arrive unchanged");
  console.log("✓ environment prefixes carry values verbatim\n");
}

console.log("=== All shell quoting tests passed ===");
