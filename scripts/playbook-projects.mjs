// The boilerplate-project corpus: reads templates from test-documents/projects,
// materializes them as real git repos, and runs their declared build.
//
// Imported by BOTH callers - scripts/dev-agent-bootstrap.mjs (the usage
// playbooks) and the Playwright E2E suites. That sharing is the point, not a
// convenience: an agent driving Otto by hand and a spec asserting about Otto have
// to be working against identical ground truth, or a green suite stops being
// evidence about the thing the agent just looked at. See
// projects/usage-playbooks/usage-playbooks.md.
//
// A materialized repo has:
//   - `main` at one commit: the template's tree/ verbatim, which builds green
//   - one `break/<slug>` branch per manifest entry, each a partial overlay on
//     main whose build fails in a specific, documented way
//
// Overlays are file-level, not patches: breaks/<slug>/tree/ replaces only the
// files it contains. A break variant is therefore as small as the mistake, and
// its diff against main reads as the mistake and nothing else.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const TEMPLATE_ROOT = path.join(repoRoot, "test-documents", "projects");

// Commits are authored with an explicit identity rather than the machine's. A
// scripted run must not assume the user has configured git, and must not attribute
// fixture commits to them if they have.
const COMMIT_IDENTITY = [
  "-c",
  "user.name=Otto Playbooks",
  "-c",
  "user.email=playbooks@otto.local",
  "-c",
  "commit.gpgsign=false",
];

export function listTemplates() {
  if (!existsSync(TEMPLATE_ROOT)) {
    return [];
  }
  return readdirSync(TEMPLATE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(TEMPLATE_ROOT, name, "playbook.json")))
    .sort();
}

export function readTemplate(name) {
  const dir = path.join(TEMPLATE_ROOT, name);
  const manifestPath = path.join(dir, "playbook.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Unknown template "${name}". Available: ${listTemplates().join(", ") || "(none)"}`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return {
    name,
    dir,
    treeDir: path.join(dir, "tree"),
    label: manifest.label ?? name,
    description: manifest.description ?? "",
    tool: manifest.tool ?? null,
    toolVersionArgs: manifest.toolVersionArgs ?? ["--version"],
    build: manifest.build ?? null,
    test: manifest.test ?? null,
    breaks: manifest.breaks ?? [],
  };
}

// A missing toolchain is a skip, not a failure: the materialized repo is still
// worth having for highlighting, the file tree, diffs and the editor. Only the
// build is unavailable, and saying so beats pretending the fixture is broken.
export function probeToolchain(template) {
  if (!template.tool) {
    return { available: true, version: null };
  }
  try {
    const output = execFileSync(template.tool, template.toolVersionArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { available: true, version: output.trim().split("\n")[0] ?? null };
  } catch {
    return { available: false, version: null };
  }
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commitAll(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, ...COMMIT_IDENTITY, "commit", "-m", message);
}

/**
 * Creates the template's repo at `targetDir`.
 *
 * Returns { dir, template, created, branches }. When the directory already holds
 * a git repo and `force` is false, nothing is touched and `created` is false -
 * re-running a playbook must land in the same state, not rebuild it.
 */
export function materializeTemplate({ name, targetDir, force = false }) {
  const template = readTemplate(name);
  const isRepo = existsSync(path.join(targetDir, ".git"));

  if (isRepo && !force) {
    return { dir: targetDir, template, created: false, branches: listBranches(targetDir) };
  }
  if (isRepo) {
    rmSync(targetDir, { recursive: true, force: true });
  }

  mkdirSync(targetDir, { recursive: true });
  cpSync(template.treeDir, targetDir, { recursive: true });

  git(targetDir, "init", "-b", "main");
  commitAll(targetDir, `feat: ${template.label} boilerplate`);

  for (const variant of template.breaks) {
    const overlay = path.join(template.dir, "breaks", variant.slug, "tree");
    if (!existsSync(overlay)) {
      throw new Error(`Template "${name}" declares break "${variant.slug}" with no ${overlay}`);
    }
    const branch = `break/${variant.slug}`;
    git(targetDir, "checkout", "-q", "-b", branch, "main");
    // Partial overlay: only the files the variant carries are replaced.
    cpSync(overlay, targetDir, { recursive: true, force: true });
    commitAll(targetDir, `fix: ${variant.detail ?? variant.slug}`);
    git(targetDir, "checkout", "-q", "main");
  }

  return { dir: targetDir, template, created: true, branches: listBranches(targetDir) };
}

export function listBranches(dir) {
  return git(dir, "branch", "--format=%(refname:short)")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function runStep(dir, argv) {
  try {
    const output = execFileSync(argv[0], argv.slice(1), {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: "passed", output };
  } catch (error) {
    const stdout = error.stdout ?? "";
    const stderr = error.stderr ?? "";
    return { status: "failed", output: `${stdout}${stderr}`.trim() || String(error.message) };
  }
}

/**
 * Runs the template's build and test in `dir`. Both are argv arrays, so there is
 * no shell to quote for and nothing that behaves differently on Windows.
 *
 * `expectFailure: true` inverts the verdict - used on a break branch, where a
 * build that *passes* means the error scenario has silently stopped working.
 */
export function runTemplateChecks({ dir, template, expectFailure = false }) {
  const toolchain = probeToolchain(template);
  if (!toolchain.available) {
    return { status: "skipped", reason: `${template.tool} not on PATH`, steps: [] };
  }

  const steps = [];
  for (const [label, argv] of [
    ["build", template.build],
    ["test", template.test],
  ]) {
    if (!argv) continue;
    const result = runStep(dir, argv);
    steps.push({ label, ...result });
    if (result.status === "failed") break;
  }

  const anyFailed = steps.some((step) => step.status === "failed");
  if (expectFailure) {
    return anyFailed
      ? { status: "failed-as-expected", steps }
      : { status: "unexpectedly-passed", steps };
  }
  return { status: anyFailed ? "failed" : "passed", steps };
}
