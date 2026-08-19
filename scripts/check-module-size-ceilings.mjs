#!/usr/bin/env node
// Fails when one of the modules Otto feature code accumulates in has grown past its ceiling.
//
// The ceilings in module-size-ceilings.json may only ever be lowered. They exist because these
// files are registries: every new capability has a legitimate reason to add a line, so nothing
// stops them growing except a number that fails.
//
// When a file is over, the fix is almost never "raise the ceiling". It is to put the new code in
// a domain module beside Paseo's, the way server/session/<domain>/ and protocol/src/<domain>.ts
// already work.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const configPath = join(scriptDir, "module-size-ceilings.json");

// Counts newline characters, matching `wc -l`, which is how the ceilings were measured.
function countLines(absolutePath) {
  const text = readFileSync(absolutePath, "utf8");
  let lines = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  return lines;
}

const { ceilings } = JSON.parse(readFileSync(configPath, "utf8"));
const entries = Object.entries(ceilings);

const over = [];
const shrunk = [];

for (const [relativePath, ceiling] of entries) {
  let actual;
  try {
    actual = countLines(join(repoRoot, relativePath));
  } catch {
    console.error(`missing file in module-size-ceilings.json: ${relativePath}`);
    process.exitCode = 1;
    continue;
  }
  if (actual > ceiling) {
    over.push({ relativePath, actual, ceiling });
  } else if (actual < ceiling) {
    shrunk.push({ relativePath, actual, ceiling });
  }
}

if (shrunk.length > 0) {
  console.log("These modules are now under their ceiling. Lower the ceiling to lock the win in:");
  for (const { relativePath, actual, ceiling } of shrunk) {
    console.log(`  ${relativePath}: ${actual} lines, ceiling ${ceiling} (-${ceiling - actual})`);
  }
  console.log("");
}

if (over.length > 0) {
  console.error("Module size ceiling exceeded:");
  for (const { relativePath, actual, ceiling } of over) {
    console.error(`  ${relativePath}: ${actual} lines, ceiling ${ceiling} (+${actual - ceiling})`);
  }
  console.error("");
  console.error(
    "These files are registries, so adding to them always looks reasonable in isolation.",
  );
  console.error("Prefer giving the feature its own module beside Paseo's:");
  console.error("  daemon RPC handlers -> packages/server/src/server/session/<domain>/");
  console.error("  wire schemas        -> packages/protocol/src/<domain>.ts");
  console.error("Raise the ceiling only with an explicit reason; it is meant to ratchet downward.");
  process.exit(1);
}

if (process.exitCode !== 1) {
  console.log(`All ${entries.length} module size ceilings hold.`);
}
