#!/usr/bin/env npx tsx

// DISABLED(hub): the guard for the Hub exclusion.
//
// This file used to drive `otto hub deploy` against a fake Hub origin and assert
// a successful bundle install. Hub is a documented permanent build exclusion
// (see packages/cli/src/commands/hub-disabled.ts), so that test asserted
// behaviour this build deliberately does not have and failed on every run.
//
// The exclusion works by redirecting an import specifier, not by deleting call
// sites, so an upstream merge can silently restore the real command without
// touching a line we would review. That is what this test now watches: the
// command stays registered and reachable, and every invocation answers with the
// one honest sentence and a non-zero exit.

import assert from "node:assert/strict";
import { runLocalOtto } from "./helpers/local-cli.js";

const DISABLED_MESSAGE = "Otto Hub is disabled in this build. See docs/upstream-merges.md.";

for (const args of [["hub"], ["hub", "deploy"], ["hub", "connect", "--json"]]) {
  const result = await runLocalOtto(args);
  assert.notEqual(
    result.exitCode,
    0,
    `\`otto ${args.join(" ")}\` succeeded; Hub is enabled in this build`,
  );
  assert.match(result.stderr, new RegExp(DISABLED_MESSAGE.replaceAll(".", "\\.")));
}

// `--help` still has to describe the command rather than die on "unknown
// command": that is the whole reason the command stays registered.
const help = await runLocalOtto(["hub", "--help"]);
assert.match(help.stdout, /disabled in this build/);

console.log("✅ Hub stays registered, disabled, and honest about it");
