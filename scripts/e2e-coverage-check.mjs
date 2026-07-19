#!/usr/bin/env node
// Cross-references projects/e2e-qa-coverage/coverage-matrix.md against the spec
// files that actually exist in packages/app/e2e/. Fails when the matrix names a
// spec that is gone (stale row) or a spec on disk has no matrix row (unmapped),
// so coverage bookkeeping cannot silently drift. Pure file analysis; no daemon.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const e2eDir = path.join(repoRoot, "packages", "app", "e2e");
const matrixPath = path.join(repoRoot, "projects", "e2e-qa-coverage", "coverage-matrix.md");

const diskSpecs = new Set(
  (await readdir(e2eDir)).filter((name) => name.endsWith(".spec.ts")).sort(),
);

const matrix = await readFile(matrixPath, "utf8");

// Spec references are backtick-quoted `*.spec.ts` names inside matrix rows.
const matrixSpecs = new Set(
  [...matrix.matchAll(/`([\w.-]+\.spec\.ts)`/g)].map((match) => match[1]),
);

const stale = [...matrixSpecs].filter((name) => !diskSpecs.has(name)).sort();
const unmapped = [...diskSpecs].filter((name) => !matrixSpecs.has(name)).sort();

// Per-category scoreboard: count status marks per "## <category>" section.
const sections = matrix.split(/^## /m).slice(1);
const scoreboard = sections.map((section) => {
  const title = section.slice(0, section.indexOf("\n")).trim();
  // Status cells are matched with flexible padding so oxfmt table reflow
  // (which pads cells to column width) cannot break the scoreboard.
  const covered = (section.match(/\|\s*✅\s*\|/g) ?? []).length;
  const partial = (section.match(/\|\s*🟡\s*\|/g) ?? []).length;
  const gaps = (section.match(/\|\s*❌\s*\|/g) ?? []).length;
  return { title, covered, partial, gaps, total: covered + partial + gaps };
});

console.log("E2E coverage scoreboard\n");
const width = Math.max(...scoreboard.map((row) => row.title.length));
let totals = { covered: 0, partial: 0, gaps: 0, total: 0 };
for (const row of scoreboard) {
  totals = {
    covered: totals.covered + row.covered,
    partial: totals.partial + row.partial,
    gaps: totals.gaps + row.gaps,
    total: totals.total + row.total,
  };
  const pct = row.total === 0 ? 0 : Math.round((row.covered / row.total) * 100);
  console.log(
    `  ${row.title.padEnd(width)}  ✅ ${String(row.covered).padStart(2)}  🟡 ${row.partial}  ❌ ${String(row.gaps).padStart(2)}  (${pct}% covered)`,
  );
}
const totalPct = totals.total === 0 ? 0 : Math.round((totals.covered / totals.total) * 100);
console.log(
  `\n  ${"TOTAL".padEnd(width)}  ✅ ${totals.covered}  🟡 ${totals.partial}  ❌ ${totals.gaps}  (${totalPct}% covered)`,
);
console.log(
  `\n  Spec files on disk: ${diskSpecs.size} — all claimed by the matrix: ${unmapped.length === 0 ? "yes" : "NO"}`,
);

let failed = false;
if (stale.length > 0) {
  failed = true;
  console.error("\nStale matrix rows (spec named in matrix but not on disk):");
  for (const name of stale) console.error(`  - ${name}`);
}
if (unmapped.length > 0) {
  failed = true;
  console.error("\nUnmapped specs (on disk but no matrix row claims them):");
  for (const name of unmapped) console.error(`  - ${name}`);
  console.error(
    "\nAdd each spec to a category row in projects/e2e-qa-coverage/coverage-matrix.md.",
  );
}

process.exit(failed ? 1 : 0);
