#!/usr/bin/env node
// Reports how far Otto has drifted from upstream Paseo since the last merge.
//
// Git already knows *what* we last took — it's `git merge-base HEAD upstream/main`,
// and it stays accurate as long as upstream is ingested with a real merge (never a
// squash or rebase). This script reads that baseline and answers the two questions
// that actually gate a merge decision:
//
//   1. How much has upstream moved, and is a release tag available to merge at?
//   2. Did any of it land in a subsystem this fork has independently rebuilt?
//
// (2) is the expensive failure mode. The forge abstraction (upstream #1913) shipped
// the same concern as our git-hosting layer while we were building it, and nobody
// noticed until the merge. WATCHLIST exists so that never happens silently again —
// read docs/upstream-merges.md for the intent ledger that records what we
// deliberately skipped and why.
//
// Usage: node scripts/upstream-status.mjs [--verbose]

import { execFileSync } from "node:child_process";

const VERBOSE = process.argv.includes("--verbose");

// Subsystems this fork owns a rival or heavily-extended implementation of. An
// upstream commit touching these needs a human read, not a merge driver — it may
// be reinventing something we already ship. Keep in sync with the initiative list
// in CLAUDE.md; a path here costs one line of output and saves a rewrite.
const WATCHLIST = [
  {
    label: "subagents",
    paths: [
      "packages/app/src/subagents/",
      "packages/server/src/server/agent/providers/claude/task-transcript-watcher",
      "packages/server/src/server/agent/providers/claude/workflow-transcript-watcher",
      "packages/server/src/server/agent/subagent-usage",
      "packages/server/src/server/agent/claude-subagent-usage",
    ],
  },
  {
    label: "git-hosting",
    paths: [
      "packages/server/src/services/git-hosting/",
      "packages/server/src/services/github-service",
      "packages/server/src/services/forge",
      "packages/app/src/git/",
      "packages/protocol/src/git-hosting",
    ],
  },
  {
    label: "preview/browser-tools",
    paths: ["packages/server/src/server/preview/", "packages/server/src/server/browser-tools/"],
  },
  {
    label: "visualizer",
    paths: ["packages/visualizer/", "packages/app/src/visualizer/", "vendor/agent-flow/"],
  },
  {
    label: "personalities/teams",
    paths: [
      "packages/server/src/server/agent/agent-personalities",
      "packages/app/src/personalities/",
      "packages/app/src/teams/",
    ],
  },
  {
    label: "artifacts",
    paths: ["packages/server/src/server/artifact/", "packages/app/src/components/artifacts/"],
  },
  {
    label: "openai-compat provider",
    paths: ["packages/server/src/server/agent/providers/openai-compat"],
  },
  { label: "text editor", paths: ["packages/app/src/editor/", "packages/server/src/server/file/"] },
  {
    label: "context management",
    paths: [
      "packages/server/src/server/agent/context-management/",
      "packages/app/src/context-management/",
    ],
  },
];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function gitLines(...args) {
  const out = git(...args);
  return out ? out.split("\n") : [];
}

function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

let baseline;
try {
  baseline = git("merge-base", "HEAD", "upstream/main");
} catch {
  console.error("Could not resolve `git merge-base HEAD upstream/main`.");
  console.error("Run `git fetch upstream` first (remote: https://github.com/getpaseo/paseo.git).");
  process.exit(1);
}

const baselineTag = (() => {
  try {
    return git("describe", "--tags", "--abbrev=0", baseline);
  } catch {
    return "(no tag)";
  }
})();
const baselineDate = git("log", "-1", "--format=%ad", "--date=short", baseline);

const tipSha = git("rev-parse", "--short", "upstream/main");
const tipDate = git("log", "-1", "--format=%ad", "--date=short", "upstream/main");
const tipDescribe = (() => {
  try {
    return git("describe", "--tags", "upstream/main");
  } catch {
    return "(no tag)";
  }
})();

// A release tag exactly at the tip means upstream is at a clean, shipped point.
// Anything else means the tip is mid-flight — see the cadence section of
// docs/upstream-merges.md for why we wait for the tag.
const tipIsTagged = !/-\d+-g[0-9a-f]+$/.test(tipDescribe) && tipDescribe !== "(no tag)";

heading("Baseline");
console.log(`  last merged : ${baseline.slice(0, 9)}  ${baselineTag}  (${baselineDate})`);
console.log(`  upstream tip: ${tipSha}  ${tipDescribe}  (${tipDate})`);

const commits = gitLines(
  "log",
  "--format=%h\t%ad\t%s",
  "--date=short",
  `${baseline}..upstream/main`,
);
if (commits.length === 0) {
  console.log("\n\x1b[32mUp to date with upstream/main.\x1b[0m");
  process.exit(0);
}

// Release tags we could merge at, newest last. Merging at a tag rather than at
// main is the whole point of the cadence policy.
const availableTags = gitLines("tag", "--merged", "upstream/main", "--sort=creatordate").filter(
  (t) => /^v\d+\.\d+\.\d+$/.test(t) && !gitLines("tag", "--merged", baseline).includes(t),
);

heading("Drift");
console.log(`  commits          : ${commits.length}`);

const upstreamFiles = new Set(gitLines("diff", "--name-only", baseline, "upstream/main"));
const ourFiles = new Set(gitLines("diff", "--name-only", baseline, "HEAD"));
const intersection = [...upstreamFiles].filter((f) => ourFiles.has(f)).sort();
const upstreamAdds = gitLines("diff", "--diff-filter=A", "--name-only", baseline, "upstream/main");
const upstreamDels = new Set(
  gitLines("diff", "--diff-filter=D", "--name-only", baseline, "upstream/main"),
);
const deletedButOursChanged = [...upstreamDels].filter((f) => ourFiles.has(f)).sort();

console.log(`  files they moved : ${upstreamFiles.size}`);
console.log(`  files we moved   : ${ourFiles.size}`);
console.log(`  \x1b[33mboth sides\x1b[0m       : ${intersection.length}   <- conflict surface`);
console.log(`  clean new files  : ${upstreamAdds.filter((f) => !ourFiles.has(f)).length}`);

heading("Release tags available to merge at");
if (availableTags.length === 0) {
  console.log("  none — upstream has not tagged a release since our baseline");
} else {
  for (const tag of availableTags) console.log(`  ${tag}`);
}
if (!tipIsTagged) {
  console.log(
    `  \x1b[33mnote:\x1b[0m upstream/main is mid-flight (${tipDescribe}); prefer merging at a tag`,
  );
}

// The headline check: did upstream touch anything we've independently rebuilt?
heading("Watchlist — upstream work in subsystems we own");
let anyHits = false;
for (const { label, paths } of WATCHLIST) {
  const hits = gitLines("log", "--format=%h\t%s", `${baseline}..upstream/main`, "--", ...paths);
  if (hits.length === 0) continue;
  anyHits = true;
  console.log(`\n  \x1b[33m${label}\x1b[0m — ${hits.length} commit(s)`);
  const shown = VERBOSE ? hits : hits.slice(0, 5);
  for (const line of shown) {
    const [sha, subject] = line.split("\t");
    console.log(`    ${sha}  ${subject}`);
  }
  if (!VERBOSE && hits.length > shown.length) {
    console.log(`    … ${hits.length - shown.length} more (--verbose)`);
  }
}
if (!anyHits) console.log("  clear — no upstream work in our differentiated subsystems");

// Upstream deleting or renaming a file we've modified will not auto-resolve, and
// the rebrand makes it worse: every `paseo-*`-named file we renamed shows up here
// the moment upstream touches it.
if (deletedButOursChanged.length > 0) {
  heading(
    `Delete/modify hazards — upstream removed these, we changed them (${deletedButOursChanged.length})`,
  );
  const shown = VERBOSE ? deletedButOursChanged : deletedButOursChanged.slice(0, 15);
  for (const f of shown) console.log(`  ${f}`);
  if (!VERBOSE && deletedButOursChanged.length > shown.length) {
    console.log(`  … ${deletedButOursChanged.length - shown.length} more (--verbose)`);
  }
}

// Files both sides rewrote heavily need hand-reconciliation, not a merge driver.
const churn = [];
for (const f of intersection) {
  const ours = gitLines("diff", "--numstat", baseline, "HEAD", "--", f)[0];
  const theirs = gitLines("diff", "--numstat", baseline, "upstream/main", "--", f)[0];
  if (!ours || !theirs) continue;
  const sum = (row) =>
    row
      .split("\t")
      .slice(0, 2)
      .reduce((a, n) => a + (Number(n) || 0), 0);
  const o = sum(ours);
  const t = sum(theirs);
  if (o > 200 && t > 200) churn.push({ f, o, t });
}
churn.sort((a, b) => b.o + b.t - (a.o + a.t));

if (churn.length > 0) {
  heading(`Hand-merge hotspots — both sides changed >200 lines (${churn.length})`);
  const shown = VERBOSE ? churn : churn.slice(0, 12);
  for (const { f, o, t } of shown) {
    console.log(`  ours:${String(o).padStart(5)}  theirs:${String(t).padStart(5)}   ${f}`);
  }
  if (!VERBOSE && churn.length > shown.length) {
    console.log(`  … ${churn.length - shown.length} more (--verbose)`);
  }
}

console.log("\nIntent ledger (what we took and deliberately skipped): docs/upstream-merges.md");
