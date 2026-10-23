/**
 * Curated presets for the mined-repo (SWE-bench-style) benchmark flow.
 *
 * The raw `otto brain bench --repo-*` flags mine any workspace on demand; these
 * presets name a few known-good, dependency-light workspaces so a repeatable
 * "curated" run is one flag instead of five. Each preset still needs the caller
 * to point `--repo-dir` at a working copy to mine, because the harness resets
 * that copy hard (git reset --hard + git clean -fd) between tasks - it must never
 * be aimed at a checkout with work you care about.
 *
 * Presets target this repo's own TypeScript/vitest workspaces (the miner keys off
 * `.test.ts` companions), so the flow runs out of the box against a spare
 * otto-code clone.
 */

/** One curated mining preset. */
export interface CuratedRepo {
  /** Short handle used on the command line (`--curated <name>`). */
  name: string;
  /** npm workspace name, e.g. `@otto-code/protocol`. */
  workspace: string;
  /** Workspace path relative to the repo root, e.g. `packages/protocol`. */
  workspaceDir: string;
  /** Git ref whose history is mined for fix commits. */
  ref: string;
  /** How many mined tasks to run. */
  maxTasks: number;
  /** One-line note shown in the preset listing. */
  note: string;
}

export const CURATED_REPOS: CuratedRepo[] = [
  {
    name: "protocol",
    workspace: "@otto-code/protocol",
    workspaceDir: "packages/protocol",
    ref: "origin/main",
    maxTasks: 3,
    note: "schema/validation workspace - fast suite, no heavy deps",
  },
  {
    name: "brain",
    workspace: "@otto-code/brain",
    workspaceDir: "packages/brain",
    ref: "origin/main",
    maxTasks: 3,
    note: "the brain package itself - pure-logic tests (vram, gguf, bench)",
  },
];

/** Look up a curated preset by its handle. */
export function findCuratedRepo(name: string): CuratedRepo | null {
  return CURATED_REPOS.find((r) => r.name === name) ?? null;
}

/** A one-per-line listing of the available presets, for help/error text. */
export function describeCuratedRepos(): string {
  return CURATED_REPOS.map((r) => `  ${r.name.padEnd(10)} ${r.workspace} - ${r.note}`).join("\n");
}
