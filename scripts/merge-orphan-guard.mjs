#!/usr/bin/env node
// Guard against silently orphaning Otto's own modules during an upstream merge.
//
// The merge doctrine is "Paseo owns the architecture, Otto owns the feature
// set": upstream's structural files are resolved to THEIRS, and Otto's features
// live in their own files hanging off that structure. That is what keeps future
// merges cheap, and it is also the exact shape of a silent feature loss - an
// Otto-only module's sole call site usually lives inside an upstream file, so
// resolving that file to THEIRS leaves the module on disk, compiling, passing
// its own tests, and reachable from nothing. `editor-targets/` went that way in
// the v0.2.5 merge and nobody noticed for weeks.
//
// Neither playbook sweep catches it: the orphaned code is self-consistent, and
// UI feature loss has no compile signal at all. So we snapshot which Otto-only
// modules have live importers BEFORE the merge, and diff against that after
// resolving. A module whose importer count falls to zero is a dropped feature,
// not a cleanup.
//
//   node scripts/merge-orphan-guard.mjs --baseline --at v0.6.1   # clean tree, before merging
//   node scripts/merge-orphan-guard.mjs --check                  # after resolving conflicts
//
// The baseline lands in .tmp/ (gitignored), so the merge cannot disturb it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix } from "node:path";

const BASELINE_PATH = ".tmp/merge-orphan-baseline.json";
const UPSTREAM_TAG_NS = "refs/upstream-tags";

const args = process.argv.slice(2);
const MODE = args.includes("--check") ? "check" : "baseline";
const AT = args[args.indexOf("--at") + 1];
const VERBOSE = args.includes("--verbose");

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
const gitLines = (...a) =>
  git(...a)
    .split("\n")
    .filter(Boolean);
const heading = (t) => console.log("\n\x1b[1m" + t + "\x1b[0m");
const red = (t) => "\x1b[31m" + t + "\x1b[0m";

// Only source modules can be orphaned; fixtures and declarations cannot.
const SOURCE_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const isTest = (f) => /\.(test|spec)\.[a-z]+$/.test(f) || f.includes("/__fixtures__/");
const isSource = (f) => SOURCE_RE.test(f) && !f.endsWith(".d.ts");

// Metro/tsc resolution, approximated. Exactness is not required: the baseline
// and the check run the identical resolver, so a specifier this misses is
// missed on both sides and cannot raise a false alarm. What matters is only
// that the two runs are comparable.
const SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".web.ts",
  ".web.tsx",
  ".native.ts",
  ".native.tsx",
  ".electron.ts",
  ".electron.tsx",
  ".shared.ts",
  "/index.ts",
  "/index.tsx",
  "/index.web.ts",
  "/index.web.tsx",
  "/index.native.ts",
  "/index.native.tsx",
  "/index.js",
];

function resolveSpecifier(spec, fromFile, fileSet) {
  let base;
  if (spec.startsWith("@/")) base = posix.join("packages/app/src", spec.slice(2));
  else if (spec.startsWith(".")) base = posix.normalize(posix.join(dirname(fromFile), spec));
  else return null; // bare package specifier - cross-package, out of scope here
  base = base.split("\\").join("/");
  // Server and CLI import TypeScript modules through .js specifiers.
  const candidates = base.endsWith(".js") ? [base.slice(0, -3), base] : [base];
  for (const candidate of candidates) {
    for (const suffix of SUFFIXES) {
      const hit = candidate + suffix;
      if (fileSet.has(hit)) return hit;
    }
  }
  return null;
}

const IMPORT_RE = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;

// target path -> Set(importer paths). Reads the worktree rather than a tree
// object, so --check sees the resolved state after a merge.
function buildImporterIndex(files) {
  const fileSet = new Set(files);
  const importers = new Map();
  for (const file of files) {
    if (!existsSync(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // A conflicted file still carries both sides, so both read as live call
    // sites. That is why --check belongs after resolution, not during it.
    for (const match of text.matchAll(IMPORT_RE)) {
      const target = resolveSpecifier(match[1], file, fileSet);
      if (!target || target === file) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  }
  return importers;
}

const trackedSources = () => gitLines("ls-files").filter(isSource);

const liveImporters = (index, file) =>
  [...(index.get(file) ?? [])].filter((f) => !isTest(f)).sort();

if (MODE === "baseline") {
  if (!AT) {
    console.error("--baseline requires --at <upstream tag or sha>");
    process.exit(2);
  }
  const target = git("rev-parse", UPSTREAM_TAG_NS + "/" + AT + "^{commit}").trim();
  const mergeBase = git("merge-base", "HEAD", "upstream/main").trim();

  // "Otto-only" means we invented it: present in our tree, absent from the
  // merge target, AND absent from the merge base. That last clause is what
  // makes this rename-proof. Without it every upstream file renamed inside the
  // merge window looks like an Otto invention. explorer-sidebar.tsx is exactly
  // that case: an upstream file renamed to compact-explorer-sidebar.tsx, whose
  // edits git carries across the rename, and which needs no guarding at all.
  const inHead = gitLines("ls-tree", "-r", "--name-only", "HEAD").filter(isSource);
  const inTarget = new Set(gitLines("ls-tree", "-r", "--name-only", target));
  const inBase = new Set(gitLines("ls-tree", "-r", "--name-only", mergeBase));
  const ottoOnly = inHead.filter((f) => !inTarget.has(f) && !inBase.has(f) && !isTest(f)).sort();

  const index = buildImporterIndex(trackedSources());
  const entries = {};
  let alreadyUnused = 0;
  for (const file of ottoOnly) {
    const live = liveImporters(index, file);
    entries[file] = live;
    if (live.length === 0) alreadyUnused += 1;
  }

  mkdirSync(".tmp", { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    head: git("rev-parse", "HEAD").trim(),
    target: { ref: AT, commit: target },
    mergeBase,
    entries,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n");

  heading("Orphan baseline captured");
  console.log("  target         : " + AT + "  " + target.slice(0, 9));
  console.log("  merge base     : " + mergeBase.slice(0, 9));
  console.log("  Otto-only mods : " + Object.keys(entries).length);
  console.log("  already unused : " + alreadyUnused + "  (pre-existing, not the merge's doing)");
  console.log("  written to     : " + BASELINE_PATH);
  console.log("\n  After resolving conflicts: node scripts/merge-orphan-guard.mjs --check");
} else {
  if (!existsSync(BASELINE_PATH)) {
    console.error("No baseline at " + BASELINE_PATH + ". Capture it before merging.");
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const index = buildImporterIndex(trackedSources());

  const orphaned = [];
  const deleted = [];
  for (const [file, before] of Object.entries(baseline.entries)) {
    if (before.length === 0) continue; // already unused at baseline; not a regression
    if (!existsSync(file)) {
      deleted.push({ file, before });
      continue;
    }
    if (liveImporters(index, file).length === 0) orphaned.push({ file, before });
  }

  heading("Orphan check");
  console.log("  baseline       : " + baseline.head.slice(0, 9) + " -> " + baseline.target.ref);
  console.log("  modules tracked: " + Object.keys(baseline.entries).length);

  if (deleted.length > 0) {
    heading("Otto modules deleted by the merge (" + deleted.length + ")");
    for (const { file, before } of deleted) {
      console.log("  " + red(file));
      const shown = VERBOSE ? before : before.slice(0, 3);
      for (const importer of shown) console.log("      was imported by " + importer);
    }
  }
  if (orphaned.length > 0) {
    heading("Otto modules that lost every importer (" + orphaned.length + ")");
    for (const { file, before } of orphaned) {
      console.log("  " + red(file));
      const shown = VERBOSE ? before : before.slice(0, 3);
      for (const importer of shown) console.log("      lost call site: " + importer);
    }
  }
  if (deleted.length === 0 && orphaned.length === 0) {
    console.log("\n  clear - every Otto module that had a call site still has one");
  } else {
    console.log("\n  Each entry is an Otto feature whose call site left with a THEIRS resolution.");
    console.log("  Re-attach it to upstream's new structure, or record the drop in the ledger.");
    process.exitCode = 1;
  }
}
