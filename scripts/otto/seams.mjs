#!/usr/bin/env node
// Reports Otto's patch set against the Paseo base and enforces the seam rule:
// every Paseo file Otto modifies carries an `OTTO(<seam>)` marker, or, when the
// file cannot hold a comment (JSON, images), is listed in seams.json with the
// reason. See docs/otto-identity.md.
//
// Usage: node scripts/otto/seams.mjs [--check] [--verbose]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const base = JSON.parse(readFileSync(path.join(here, "paseo-base.json"), "utf8"));
const registry = JSON.parse(readFileSync(path.join(here, "seams.json"), "utf8")).files;
const CHECK = process.argv.includes("--check");
const VERBOSE = process.argv.includes("--verbose");
const MARKER = /OTTO\(([a-z0-9-]+)\)/g;

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const modified = git("diff", "--name-only", "--no-renames", "--diff-filter=M", base.sha)
  .split("\n")
  .filter(Boolean);
const added = git("diff", "--name-only", "--no-renames", "--diff-filter=A", base.sha)
  .split("\n")
  .filter(Boolean);
const deleted = git("diff", "--name-only", "--no-renames", "--diff-filter=D", base.sha)
  .split("\n")
  .filter(Boolean);

// The identity constant and the recorded base must name the same Paseo release.
const identitySource = readFileSync(
  path.join(root, "packages/protocol/src/otto/identity.ts"),
  "utf8",
);
const identityBase = identitySource.match(/OTTO_PASEO_BASE_VERSION = "([^"]+)"/)?.[1];
const baseMismatch = identityBase !== base.version;

// The relay sees Paseo's routing, framing, and E2EE handshake. Otto identity and
// compatibility fields belong above this transport, inside encrypted app traffic.
const upstreamRelayPaths = [
  "packages/relay/src",
  "packages/protocol/src/daemon-endpoints.ts",
  "packages/protocol/src/connection-offer.ts",
  "packages/protocol/src/websocket-message-limit.ts",
  "packages/client/src/daemon-client-relay-e2ee-transport.ts",
  "packages/client/src/daemon-client-websocket-transport.ts",
  "packages/client/src/daemon-client-transport.ts",
  "packages/client/src/daemon-client-transport-types.ts",
  "packages/client/src/daemon-client-transport-utils.ts",
  "packages/server/src/server/relay-transport.ts",
  "packages/server/src/server/relay-runtime.ts",
  "packages/server/src/server/websocket/encrypted-relay-socket.ts",
];
const relayChanges = git(
  "diff",
  "--name-only",
  "--no-renames",
  base.sha,
  "--",
  ...upstreamRelayPaths,
)
  .split("\n")
  .filter(Boolean);

const seamCounts = new Map();
const unmarked = [];
let markedLines = 0;
for (const file of modified) {
  if (registry[file]) {
    seamCounts.set("registry", (seamCounts.get("registry") ?? 0) + 1);
    continue;
  }
  let text;
  try {
    text = readFileSync(path.join(root, file), "utf8");
  } catch {
    continue;
  }
  const seams = [...text.matchAll(MARKER)].map((match) => match[1]);
  if (seams.length === 0) {
    unmarked.push(file);
    continue;
  }
  markedLines += seams.length;
  for (const seam of new Set(seams)) {
    seamCounts.set(seam, (seamCounts.get(seam) ?? 0) + 1);
  }
}

const stat = git("diff", "--shortstat", "--diff-filter=M", base.sha).trim();
console.log(`Paseo base: v${base.version} (${base.sha.slice(0, 9)})`);
console.log(`Paseo files modified: ${modified.length}  (${stat || "no changes"})`);
console.log(`Paseo files deleted:  ${deleted.length}`);
console.log(`Otto files added:     ${added.length}`);
console.log(`OTTO markers:         ${markedLines}`);
for (const [seam, count] of [...seamCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${seam.padEnd(20)} ${count} file(s)`);
}
if (VERBOSE) {
  for (const file of modified) console.log(`  M ${file}`);
  for (const file of deleted) console.log(`  D ${file}`);
}
console.log(`Upstream relay boundary: ${relayChanges.length === 0 ? "unchanged" : "CHANGED"}`);
if (relayChanges.length > 0) {
  console.log("Relay-facing transport must match the pinned Paseo base:");
  for (const file of relayChanges) console.log(`  ${file}`);
  if (CHECK) process.exit(1);
}
if (baseMismatch) {
  console.log(
    `\nOTTO_PASEO_BASE_VERSION is ${identityBase}, but paseo-base.json records ${base.version}.`,
  );
  if (CHECK) process.exit(1);
}
if (unmarked.length > 0) {
  console.log(`\nModified Paseo files without an OTTO(...) marker (${unmarked.length}):`);
  for (const file of unmarked) console.log(`  ${file}`);
  if (CHECK) process.exit(1);
}
