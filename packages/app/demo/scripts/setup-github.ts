import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { materializeTemplate } from "../staging/materialize";
import { resolveDemoRemote } from "../staging/remote";

type PrState = "open" | "draft" | "closed" | "merged";

interface DemoPr {
  branch: string;
  title: string;
  body: string;
  state: PrState;
  checkState: "success" | "failure" | "pending";
  comment: string;
}

const DEMO_PRS: DemoPr[] = [
  {
    branch: "demo/checkout-flow",
    title: "Build the checkout flow",
    body: "Adds the first checkout flow for the storefront demo.",
    state: "open",
    checkState: "success",
    comment: "The layout looks good. Can we add a loading state before merge?",
  },
  {
    branch: "demo/observability-dashboard",
    title: "Add observability dashboard",
    body: "Adds the dashboard surface used by the telemetry walkthrough.",
    state: "draft",
    checkState: "pending",
    comment: "Draft review: the API shape is still settling.",
  },
  {
    branch: "demo/rate-limit-guard",
    title: "Guard the rate limit window",
    body: "Rejects requests that exceed the configured rate limit window.",
    state: "open",
    checkState: "failure",
    comment: "The failing integration check needs attention before this can merge.",
  },
  {
    branch: "demo/legacy-metrics",
    title: "Remove the legacy metrics endpoint",
    body: "Closes the old metrics endpoint after the migration.",
    state: "closed",
    checkState: "success",
    comment: "Closing this in favor of the replacement implementation.",
  },
  {
    branch: "demo/initial-scaffold",
    title: "Publish the initial service scaffold",
    body: "The original scaffold that is now part of the default branch.",
    state: "merged",
    checkState: "success",
    comment: "Thanks, this is now shipped.",
  },
];

const DEMO_ISSUES = [
  {
    title: "Add an empty-state illustration",
    body: "The empty state should explain what happens next.",
    labels: ["enhancement"],
    state: "open" as const,
  },
  {
    title: "Telemetry retries can loop forever",
    body: "Stop retrying after the configured attempt budget.",
    labels: ["bug", "priority: high"],
    state: "open" as const,
  },
  {
    title: "Document the old ingest endpoint",
    body: "The migration notes now cover this endpoint.",
    labels: ["documentation"],
    state: "closed" as const,
  },
];

function command(name: string, args: string[], cwd?: string): string {
  return execFileSync(name, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function git(args: string[], cwd: string): string {
  return command("git", args, cwd);
}

function gh(args: string[], cwd?: string): string {
  return command("gh", args, cwd);
}

function hasRepo(fullName: string): boolean {
  try {
    gh(["repo", "view", fullName, "--json", "name"]);
    return true;
  } catch {
    return false;
  }
}

function existingPrNumber(fullName: string, branch: string): number | undefined {
  const raw = gh([
    "pr",
    "list",
    "--repo",
    fullName,
    "--head",
    branch,
    "--state",
    "all",
    "--json",
    "number",
    "--jq",
    ".[0].number",
  ]);
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

async function createBranch(repoPath: string, branch: string, marker: string): Promise<string> {
  git(["checkout", "-B", branch, "main"], repoPath);
  const markerPath = path.join(repoPath, `.otto-demo-${marker}.md`);
  await writeFile(markerPath, `${marker}\n`);
  git(["add", path.basename(markerPath)], repoPath);
  git(
    [
      "-c",
      "user.name=Otto Demo",
      "-c",
      "user.email=demo@otto-code.me",
      "commit",
      "--no-verify",
      "-m",
      `demo: stage ${marker}`,
    ],
    repoPath,
  );
  git(["push", "--force-with-lease", "origin", `${branch}:${branch}`], repoPath);
  return git(["rev-parse", branch], repoPath);
}

function seedChecks(fullName: string, sha: string, state: DemoPr["checkState"]): void {
  for (const context of ["CI / unit tests", "CI / typecheck"]) {
    gh([
      "api",
      `repos/${fullName}/statuses/${sha}`,
      "--method",
      "POST",
      "-f",
      `state=${state}`,
      "-f",
      `context=${context}`,
      "-f",
      `description=Otto demo ${state} check`,
      "-f",
      `target_url=https://example.com/otto-demo/${encodeURIComponent(context)}`,
    ]);
  }
}

function ensureLabels(fullName: string): void {
  for (const [name, color] of [
    ["enhancement", "a2eeef"],
    ["bug", "d73a4a"],
    ["priority: high", "b60205"],
    ["documentation", "0075ca"],
  ] as const) {
    gh(["label", "create", name, "--repo", fullName, "--color", color, "--force"]);
  }
}

function ensureIssues(fullName: string): void {
  for (const issue of DEMO_ISSUES) {
    const existing = gh([
      "issue",
      "list",
      "--repo",
      fullName,
      "--state",
      "all",
      "--search",
      `in:title ${issue.title}`,
      "--json",
      "number,title",
      "--jq",
      `.[].title | select(. == "${issue.title}")`,
    ]);
    if (existing) continue;
    const args = [
      "issue",
      "create",
      "--repo",
      fullName,
      "--title",
      issue.title,
      "--body",
      issue.body,
    ];
    for (const label of issue.labels) args.push("--label", label);
    const url = gh(args);
    if (issue.state === "closed")
      gh(["issue", "close", url.split("/").pop() ?? "", "--repo", fullName]);
  }
}

async function ensurePr(fullName: string, repoPath: string, spec: DemoPr): Promise<void> {
  const sha = await createBranch(repoPath, spec.branch, spec.branch.replaceAll("/", "-"));
  seedChecks(fullName, sha, spec.checkState);
  let number = existingPrNumber(fullName, spec.branch);
  if (!number) {
    const url = gh([
      "pr",
      "create",
      "--repo",
      fullName,
      "--head",
      spec.branch,
      "--base",
      "main",
      "--title",
      spec.title,
      "--body",
      spec.body,
      ...(spec.state === "draft" ? ["--draft"] : []),
    ]);
    number = Number(url.split("/").pop());
  }
  gh(["pr", "comment", String(number), "--repo", fullName, "--body", spec.comment]);
  if (spec.state === "open") {
    gh(["pr", "review", String(number), "--repo", fullName, "--comment", "--body", spec.comment]);
  }
  if (spec.state === "closed") gh(["pr", "close", String(number), "--repo", fullName]);
  if (spec.state === "merged")
    gh(["pr", "merge", String(number), "--repo", fullName, "--squash", "--delete-branch=false"]);
}

async function main(): Promise<void> {
  gh(["auth", "status"]);
  const reposRoot = await mkdtemp(path.join(tmpdir(), "otto-demo-github-"));
  try {
    for (const template of ["mango-storefront", "pulse-api"]) {
      const remote = resolveDemoRemote(template, "otto-demos");
      const fullName = `${remote.owner}/${remote.name}`;
      const repo = await materializeTemplate(template, { reposRoot, originOwner: remote.owner });
      if (!hasRepo(fullName)) {
        // materializeTemplate already installed the GitHub remote. Create the
        // empty remote first, then use that existing origin for the initial push.
        gh(["repo", "create", fullName, "--private"]);
      }
      git(["push", "--force-with-lease", "origin", "main:main"], repo.path);
      ensureLabels(fullName);
      ensureIssues(fullName);
      for (const spec of DEMO_PRS) await ensurePr(fullName, repo.path, spec);
      await repo.cleanup();
    }
  } finally {
    // materializeTemplate owns the repository directories. The root itself is
    // left as a harmless temp directory so an interrupted setup is recoverable.
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
