#!/usr/bin/env node
// Reports how far Otto has drifted from upstream Paseo since the last merge.
//
// Git already knows *what* we last took - it's `git merge-base HEAD upstream/main`,
// and it stays accurate as long as upstream is ingested with a real merge (never a
// squash or rebase). This script reads that baseline and answers the two questions
// that actually gate a merge decision:
//
//   1. How much has upstream moved, and is a release tag available to merge at?
//   2. Did any of it land in a subsystem this fork has independently rebuilt?
//
// (2) is the expensive failure mode. The forge abstraction (upstream #1913) shipped
// the same concern as our git-hosting layer while we were building it, and nobody
// noticed until the merge. WATCHLIST exists so that never happens silently again -
// read docs/upstream-merges.md for the intent ledger that records what we
// deliberately skipped and why.
//
// Upstream tags are read from a private ref namespace, never from `refs/tags/`.
// Otto cuts its own `vX.Y.Z` releases, so the two tag namespaces collide by name:
// a plain `git fetch upstream --tags` silently refuses every colliding tag, and
// the local `v0.4.0` then resolves to *our* release commit. That is not a
// cosmetic mixup - it made this script report "upstream has not tagged a release"
// while three upstream releases were sitting there. Everything below resolves
// upstream releases through UPSTREAM_TAG_NS and peels them to commits itself.
//
// Usage: node scripts/upstream-status.mjs [--verbose] [--at <upstream tag>]
//
// `--at` measures drift against the release you actually intend to merge instead
// of against upstream/main. Since the policy says merge at a tag, the default
// (main) always overstates the work: at the v0.2.5 baseline, main showed 442
// commits and 838 overlapping files while the v0.4.0 target was 280 and 696.

import { execFileSync } from "node:child_process";

const VERBOSE = process.argv.includes("--verbose");
const AT_INDEX = process.argv.indexOf("--at");
const AT_TAG = AT_INDEX === -1 ? null : process.argv[AT_INDEX + 1];

// Upstream tags land here instead of refs/tags/ so they cannot collide with
// Otto's own release tags. Set up with the command printed below on first run.
const UPSTREAM_TAG_NS = "refs/upstream-tags";
const UPSTREAM_TAG_REFSPEC = `+refs/tags/*:${UPSTREAM_TAG_NS}/*`;

// Subsystems this fork owns a rival or heavily-extended implementation of. An
// upstream commit touching these needs a human read, not a merge driver - it may
// be reinventing something we already ship. Keep in sync with the initiative list
// in CLAUDE.md; a path here costs one line of output and saves a rewrite.
const WATCHLIST = [
  {
    label: "subagents",
    paths: [
      "packages/app/src/subagents/",
      "packages/server/src/server/agent/providers/claude/task-transcript-watcher.ts",
      "packages/server/src/server/agent/providers/claude/workflow-transcript-watcher.ts",
      "packages/server/src/server/agent/subagent-usage.ts",
    ],
  },
  {
    label: "git-hosting",
    paths: [
      "packages/server/src/services/git-hosting/",
      "packages/server/src/services/github-service.ts",
      "packages/server/src/services/forge-cli-command.ts",
      "packages/server/src/services/forge-registry.ts",
      "packages/server/src/services/forge-resolver.ts",
      "packages/server/src/services/forge-service.ts",
      "packages/app/src/git/",
      "packages/protocol/src/git-hosting.ts",
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
    // All three original paths here were dead: `agent-personalities` without the
    // `.ts` is not a git pathspec match for `agent-personalities.ts`, and the two
    // app directories never existed. The entry matched nothing while upstream
    // built `agent-profiles/` - the exact rival abstraction it exists to catch -
    // across four commits in v0.4.0. The dead-path self-check below exists so a
    // silently-matching-nothing entry can never happen again.
    label: "personalities/teams",
    paths: [
      "packages/protocol/src/default-personalities.ts",
      "packages/protocol/src/agent-profiles.ts",
      "packages/server/src/server/agent/agent-profiles.ts",
      "packages/server/src/server/agent/agent-teams.ts",
      "packages/app/src/context-management/use-personality-memory.ts",
      "packages/app/src/components/active-team-group-switcher.tsx",
      // Upstream's rival: host-wide reusable agent profiles (#3208).
      "packages/app/src/agent-profiles/",
    ],
  },
  {
    // The duplicate renderer at components/markdown/mermaid/ that this entry
    // used to track is gone from both sides; the fence renderer is the survivor.
    label: "mermaid",
    paths: ["packages/app/src/components/markdown/fence/mermaid/"],
  },
  {
    // This entry used to claim Otto retained chat rooms and agent loops after
    // upstream deleted them in #3053. It did not: we ingested that deletion
    // (94bda1f92), so the server, CLI and app sides are gone from both trees.
    // What survives is the protocol half, still exported from messages.ts with
    // no handler behind it - watch it so a future upstream loop feature is
    // recognised as a rebuild rather than merged on top of dead schema.
    label: "agent loops (protocol remnant)",
    paths: ["packages/protocol/src/loop/"],
  },
  {
    label: "artifacts",
    paths: ["packages/server/src/server/artifact/", "packages/app/src/components/artifacts/"],
  },
  {
    label: "openai-compat provider",
    paths: [
      "packages/server/src/server/agent/providers/openai-compat-agent.ts",
      "packages/server/src/server/agent/providers/openai-compat-tools.ts",
      "packages/server/src/server/agent/providers/openai-compat-mcp.ts",
    ],
  },
  {
    label: "text editor",
    paths: [
      "packages/app/src/editor/",
      "packages/server/src/server/file-explorer/",
      "packages/server/src/server/file-download/",
      "packages/server/src/server/file-upload/",
    ],
  },
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

function isAncestor(maybeAncestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", maybeAncestor, descendant], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// Semver ordering, prerelease-aware: 0.4.0 sorts after 0.4.0-beta.2, which sorts
// after 0.3.1. Upstream ships betas between minors, so creatordate ordering is
// not enough to answer "what is the newest stable tag we could merge at".
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { core: core.split(".").map(Number), pre: pre ? pre.split(".") : null };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (!left.pre && !right.pre) return 0;
  if (!left.pre) return 1; // a release outranks any of its prereleases
  if (!right.pre) return -1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    if (/^\d+$/.test(l) && /^\d+$/.test(r)) return Number(l) - Number(r);
    return l < r ? -1 : 1;
  }
  return 0;
}

const RELEASE_TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

// Reads the namespaced upstream tags and peels annotated ones to their commit.
function readUpstreamTags() {
  const rows = gitLines(
    "for-each-ref",
    "--format=%(refname:strip=2)\t%(objectname)\t%(*objectname)\t%(creatordate:short)",
    `${UPSTREAM_TAG_NS}/`,
  );
  return rows
    .map((row) => {
      const [name, object, peeled, date] = row.split("\t");
      return { name, commit: peeled || object, date };
    })
    .filter((tag) => RELEASE_TAG.test(tag.name))
    .sort((a, b) => compareVersions(a.name, b.name));
}

const fetchSpecs = gitLines("config", "--get-all", "remote.upstream.fetch");
if (!fetchSpecs.includes(UPSTREAM_TAG_REFSPEC)) {
  console.error("Upstream tags are not mapped into their own ref namespace.");
  console.error("Without it, Otto's own release tags shadow Paseo's and this report lies.");
  console.error("\nRun once, then re-run this script:\n");
  console.error(`  git config --add remote.upstream.fetch '${UPSTREAM_TAG_REFSPEC}'`);
  console.error("  git fetch upstream");
  process.exit(1);
}

let baseline;
try {
  baseline = git("merge-base", "HEAD", "upstream/main");
} catch {
  console.error("Could not resolve `git merge-base HEAD upstream/main`.");
  console.error("Run `git fetch upstream` first (remote: https://github.com/getpaseo/paseo.git).");
  process.exit(1);
}

const upstreamTags = readUpstreamTags();
if (upstreamTags.length === 0) {
  console.error(`No upstream tags under ${UPSTREAM_TAG_NS}/. Run \`git fetch upstream\`.`);
  process.exit(1);
}

// Newest upstream release already contained in what we merged.
const baselineTag =
  upstreamTags.toReversed().find((tag) => isAncestor(tag.commit, baseline))?.name ?? "(no tag)";
const baselineDate = git("log", "-1", "--format=%ad", "--date=short", baseline);

const tipSha = git("rev-parse", "upstream/main");
const tipDate = git("log", "-1", "--format=%ad", "--date=short", "upstream/main");
const tipTag = upstreamTags.find((tag) => tag.commit === tipSha);
const newestOnTip = upstreamTags
  .toReversed()
  .find((tag) => isAncestor(tag.commit, "upstream/main"));

// A release tag exactly at the tip means upstream is at a clean, shipped point.
// Anything else means the tip is mid-flight - see the cadence section of
// docs/upstream-merges.md for why we wait for the tag.
const tipIsTagged = Boolean(tipTag);
const tipDescribe = (() => {
  if (tipTag) return tipTag.name;
  if (!newestOnTip) return "(no tag)";
  const ahead = gitLines("rev-list", `${newestOnTip.commit}..upstream/main`).length;
  return `${newestOnTip.name}+${ahead}`;
})();

// Everything below (drift, watchlist, hazards, hotspots) is measured against
// `target`. It is upstream/main unless --at names a release, in which case the
// numbers describe the merge we are actually planning.
let target = "upstream/main";
let targetLabel = null;
if (AT_TAG) {
  const wanted = upstreamTags.find((tag) => tag.name === AT_TAG || tag.name === `v${AT_TAG}`);
  if (!wanted) {
    console.error(`No upstream tag ${AT_TAG} under ${UPSTREAM_TAG_NS}/.`);
    console.error(
      "Available:",
      upstreamTags
        .map((tag) => tag.name)
        .slice(-8)
        .join(", "),
    );
    process.exit(1);
  }
  target = wanted.commit;
  targetLabel = `${wanted.name}  ${wanted.commit.slice(0, 9)}  (${wanted.date})`;
}

heading("Baseline");
console.log(`  last merged : ${baseline.slice(0, 9)}  ${baselineTag}  (${baselineDate})`);
console.log(`  upstream tip: ${tipSha.slice(0, 9)}  ${tipDescribe}  (${tipDate})`);
console.log(`  measuring to: ${targetLabel ?? "upstream/main (pass --at <tag> for a release)"}`);

const commits = gitLines("log", "--format=%h\t%ad\t%s", "--date=short", `${baseline}..${target}`);
if (commits.length === 0) {
  console.log(`\n\x1b[32mUp to date with ${AT_TAG ?? "upstream/main"}.\x1b[0m`);
  process.exit(0);
}

// Release tags we could merge at, newest last. Merging at a tag rather than at
// main is the whole point of the cadence policy. Prereleases are excluded: the
// policy forbids merging a -beta/-rc outright.
const availableTags = upstreamTags.filter(
  (tag) =>
    !tag.name.includes("-") &&
    isAncestor(tag.commit, "upstream/main") &&
    !isAncestor(tag.commit, baseline),
);

// The cadence rule is "don't stretch past two minor releases", so what matters is
// how many distinct minor lines have shipped since our baseline, not tag count.
const minorLinesBehind = new Set(
  availableTags.map((tag) => tag.name.replace(/^v/, "").split(".").slice(0, 2).join(".")),
).size;

heading("Drift");
console.log(`  commits          : ${commits.length}`);

const upstreamFiles = new Set(gitLines("diff", "--name-only", baseline, target));
const ourFiles = new Set(gitLines("diff", "--name-only", baseline, "HEAD"));
const intersection = [...upstreamFiles].filter((f) => ourFiles.has(f)).sort();
const upstreamAdds = gitLines("diff", "--diff-filter=A", "--name-only", baseline, target);
const upstreamDels = new Set(gitLines("diff", "--diff-filter=D", "--name-only", baseline, target));
const deletedButOursChanged = [...upstreamDels].filter((f) => ourFiles.has(f)).sort();

console.log(`  files they moved : ${upstreamFiles.size}`);
console.log(`  files we moved   : ${ourFiles.size}`);
console.log(`  \x1b[33mboth sides\x1b[0m       : ${intersection.length}   <- conflict surface`);
console.log(`  clean new files  : ${upstreamAdds.filter((f) => !ourFiles.has(f)).length}`);

heading("Release tags available to merge at");
if (availableTags.length === 0) {
  console.log("  none - upstream has not tagged a release since our baseline");
} else {
  const newest = availableTags.at(-1);
  for (const tag of availableTags) {
    const marker = tag === newest ? " <- newest stable, merge here" : "";
    console.log(`  ${tag.name.padEnd(16)} ${tag.commit.slice(0, 9)}  (${tag.date})${marker}`);
  }
  // By SHA, never by tag name: `git merge v0.4.0` would take Otto's own release.
  console.log(`\n  git merge ${newest.commit}   # ${newest.name}, by SHA - the tag name is ours`);
}
if (minorLinesBehind >= 2) {
  console.log(
    `  \x1b[33mnote:\x1b[0m ${minorLinesBehind} minor release(s) behind; the cadence policy caps this at two`,
  );
}
if (!tipIsTagged) {
  console.log(
    `  \x1b[33mnote:\x1b[0m upstream/main is mid-flight (${tipDescribe}); prefer merging at a tag`,
  );
}

// The headline check: did upstream touch anything we've independently rebuilt?
heading("Watchlist - upstream work in subsystems we own");
let anyHits = false;
for (const { label, paths } of WATCHLIST) {
  const hits = gitLines("log", "--format=%h\t%s", `${baseline}..${target}`, "--", ...paths);
  if (hits.length === 0) continue;
  anyHits = true;
  console.log(`\n  \x1b[33m${label}\x1b[0m - ${hits.length} commit(s)`);
  const shown = VERBOSE ? hits : hits.slice(0, 5);
  for (const line of shown) {
    const [sha, subject] = line.split("\t");
    console.log(`    ${sha}  ${subject}`);
  }
  if (!VERBOSE && hits.length > shown.length) {
    console.log(`    … ${hits.length - shown.length} more (--verbose)`);
  }
}
if (!anyHits) console.log("  clear - no upstream work in our differentiated subsystems");

// A watchlist path that matches nothing is worse than no watchlist at all: it
// reads as coverage and reports "clear". Every path must exist on one side or
// the other (ours, or upstream's rival tree). Checked on every run.
const deadPaths = [];
for (const { label, paths } of WATCHLIST) {
  for (const path of paths) {
    const known =
      gitLines("ls-tree", "-r", "--name-only", "HEAD", "--", path).length > 0 ||
      gitLines("ls-tree", "-r", "--name-only", "upstream/main", "--", path).length > 0;
    if (!known) deadPaths.push(`${label}: ${path}`);
  }
}
if (deadPaths.length > 0) {
  heading("Watchlist paths matching nothing - fix before trusting the section above");
  for (const entry of deadPaths) console.log(`  \x1b[31m${entry}\x1b[0m`);
}

// Upstream deleting or renaming a file we've modified will not auto-resolve, and
// the rebrand makes it worse: every `otto-*`-named file we renamed shows up here
// the moment upstream touches it.
if (deletedButOursChanged.length > 0) {
  heading(
    `Delete/modify hazards - upstream removed these, we changed them (${deletedButOursChanged.length})`,
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
  const theirs = gitLines("diff", "--numstat", baseline, target, "--", f)[0];
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
  heading(`Hand-merge hotspots - both sides changed >200 lines (${churn.length})`);
  const shown = VERBOSE ? churn : churn.slice(0, 12);
  for (const { f, o, t } of shown) {
    console.log(`  ours:${String(o).padStart(5)}  theirs:${String(t).padStart(5)}   ${f}`);
  }
  if (!VERBOSE && churn.length > shown.length) {
    console.log(`  … ${churn.length - shown.length} more (--verbose)`);
  }
}

console.log("\nIntent ledger (what we took and deliberately skipped): docs/upstream-merges.md");
