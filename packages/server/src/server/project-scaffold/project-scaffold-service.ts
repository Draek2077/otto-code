import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Logger } from "pino";
import type { ProjectScaffoldGit, ProjectScaffoldStep } from "@otto-code/protocol/messages";
import type { GitHostingService } from "../../services/git-hosting/types.js";
import { runGitCommand } from "../../utils/run-git-command.js";
import {
  buildProjectScaffoldStepPlan,
  buildReadmeContent,
  getGitignoreTemplateContent,
  resolveProjectFolderName,
  type ProjectScaffoldStepId,
} from "./project-scaffold-plan.js";

// Cloning a large repository routinely outruns the 30s default, and a push over
// a slow link is not much better. These are the only two git operations here
// that talk to the network, so they get their own budget.
const NETWORK_GIT_TIMEOUT_MS = 10 * 60_000;

export type ProjectScaffoldErrorCode =
  | "parent_not_found"
  | "invalid_name"
  | "already_exists"
  | "git_unavailable"
  | "git_failed"
  | "provider_unavailable"
  | "remote_failed"
  | "clone_failed"
  | "register_failed";

export class ProjectScaffoldError extends Error {
  readonly code: ProjectScaffoldErrorCode;

  constructor(code: ProjectScaffoldErrorCode, message: string) {
    super(message);
    this.name = "ProjectScaffoldError";
    this.code = code;
  }
}

export interface ProjectScaffoldRequestInput {
  parentDirectory: string;
  folderName: string | undefined;
  git: ProjectScaffoldGit;
}

export interface ProjectScaffoldOutcome {
  // Absolute path of the created directory. Set as soon as the directory
  // exists, so a later failure can still tell the user what is on disk.
  path: string | null;
  remoteUrl: string | null;
  steps: ProjectScaffoldStep[];
}

export interface ProjectScaffoldServiceDeps {
  logger: Logger;
  // Resolves a host-level hosting service for a provider id, or null when that
  // provider isn't configured on this daemon.
  resolveHostingProvider: (providerId: string) => Promise<GitHostingService | null>;
  // Emitted as each step starts and settles. Advisory only — the returned
  // outcome carries the authoritative step list.
  onProgress: (step: ProjectScaffoldStep) => void;
}

export interface ProjectScaffoldService {
  // Creates the directory and everything that was asked for inside it. Throws
  // ProjectScaffoldError on the first failed step; the caller reads
  // `outcome.steps` from the thrown error's partial outcome via getOutcome().
  scaffold(input: ProjectScaffoldRequestInput): Promise<ProjectScaffoldOutcome>;
}

// Tracks step results and pushes each transition to the client as it happens.
class StepRecorder {
  private readonly steps: ProjectScaffoldStep[] = [];

  constructor(
    private readonly plan: ProjectScaffoldStepId[],
    private readonly onProgress: (step: ProjectScaffoldStep) => void,
  ) {}

  async run<T>(id: ProjectScaffoldStepId, work: () => Promise<T>): Promise<T> {
    this.onProgress({ id, status: "running", detail: null });
    try {
      const result = await work();
      this.record({ id, status: "done", detail: null });
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.record({ id, status: "failed", detail });
      throw error;
    }
  }

  // A step the plan listed but the request turned out not to need.
  skip(id: ProjectScaffoldStepId, detail: string | null): void {
    this.record({ id, status: "skipped", detail });
  }

  private record(step: ProjectScaffoldStep): void {
    this.steps.push(step);
    this.onProgress(step);
  }

  // Steps that never started are reported as skipped so the client's list is
  // complete whether the run succeeded or stopped partway.
  snapshot(): ProjectScaffoldStep[] {
    const settled = new Set(this.steps.map((step) => step.id));
    return [
      ...this.steps,
      ...this.plan
        .filter((id) => !settled.has(id))
        .map((id): ProjectScaffoldStep => ({ id, status: "skipped", detail: null })),
    ];
  }
}

export function createProjectScaffoldService(
  deps: ProjectScaffoldServiceDeps,
): ProjectScaffoldService {
  async function isDirectory(path: string): Promise<boolean> {
    return stat(path)
      .then((entry) => entry.isDirectory())
      .catch(() => false);
  }

  async function pathExists(path: string): Promise<boolean> {
    return stat(path)
      .then(() => true)
      .catch(() => false);
  }

  async function git(args: string[], cwd: string, timeout?: number): Promise<string> {
    const result = await runGitCommand(args, { cwd, timeout, maxStderrBytes: 8192 });
    return result.stdout.trim();
  }

  async function writeStarterFiles(input: {
    targetPath: string;
    projectName: string;
    git: Extract<ProjectScaffoldGit, { kind: "init" }>;
  }): Promise<void> {
    if (input.git.addReadme) {
      await writeFile(
        join(input.targetPath, "README.md"),
        buildReadmeContent(input.projectName),
        "utf8",
      );
    }
    const templateId = input.git.gitignoreTemplate;
    if (templateId) {
      const content = getGitignoreTemplateContent(templateId);
      // An unknown template id from a newer client is not worth failing the
      // whole scaffold over — the repo is still perfectly usable without it.
      if (content) {
        await writeFile(join(input.targetPath, ".gitignore"), content, "utf8");
      } else {
        deps.logger.info({ templateId }, "Unknown .gitignore template, skipping");
      }
    }
  }

  async function runInitPath(input: {
    targetPath: string;
    projectName: string;
    git: Extract<ProjectScaffoldGit, { kind: "init" }>;
    recorder: StepRecorder;
    outcome: ProjectScaffoldOutcome;
  }): Promise<void> {
    const { targetPath, git: gitOptions, recorder, outcome } = input;

    await recorder.run("create_directory", async () => {
      await mkdir(targetPath, { recursive: false });
      outcome.path = targetPath;
    });

    await recorder.run("git_init", async () => {
      const args = ["init"];
      if (gitOptions.initialBranch?.trim()) {
        args.push("--initial-branch", gitOptions.initialBranch.trim());
      }
      await git(args, targetPath);
    });

    const hasStarterFiles = Boolean(gitOptions.addReadme) || Boolean(gitOptions.gitignoreTemplate);
    if (hasStarterFiles) {
      await recorder.run("starter_files", () =>
        writeStarterFiles({
          targetPath,
          projectName: input.projectName,
          git: gitOptions,
        }),
      );
    }

    // buildProjectScaffoldStepPlan already implies a commit whenever a remote
    // was requested; keep the two in agreement.
    const wantsCommit = Boolean(gitOptions.initialCommit) || Boolean(gitOptions.remote);
    if (wantsCommit) {
      await recorder.run("initial_commit", async () => {
        await git(["add", "-A"], targetPath);
        // `--allow-empty` covers "create a repo with a remote but no starter
        // files": there is nothing staged, and a push needs a commit regardless.
        await git(["commit", "--allow-empty", "-m", "Initial commit"], targetPath);
      });
    }

    const remote = gitOptions.remote;
    if (!remote) {
      return;
    }

    const created = await recorder.run("create_remote", async () => {
      const provider = await deps.resolveHostingProvider(remote.providerId);
      if (!provider) {
        throw new ProjectScaffoldError(
          "provider_unavailable",
          `Git hosting provider ${remote.providerId} is not configured on this host`,
        );
      }
      if (!provider.createRepository) {
        throw new ProjectScaffoldError(
          "provider_unavailable",
          `Git hosting provider ${remote.providerId} cannot create repositories`,
        );
      }
      return provider.createRepository({
        owner: remote.owner,
        name: remote.name,
        description: remote.description,
        visibility: remote.visibility,
      });
    });
    outcome.remoteUrl = created.cloneUrl;

    await recorder.run("push", async () => {
      await git(["remote", "add", "origin", created.cloneUrl], targetPath);
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], targetPath);
      await git(["push", "-u", "origin", branch], targetPath, NETWORK_GIT_TIMEOUT_MS);
    });
  }

  async function runClonePath(input: {
    parentDirectory: string;
    targetPath: string;
    folderName: string;
    url: string;
    recorder: StepRecorder;
    outcome: ProjectScaffoldOutcome;
  }): Promise<void> {
    await input.recorder.run("git_clone", async () => {
      // Clone into the parent with an explicit target so the directory name is
      // the one we validated, not whatever the URL happens to end with. `--`
      // keeps a URL that starts with a dash from being read as an option.
      await git(
        ["clone", "--", input.url, input.folderName],
        input.parentDirectory,
        NETWORK_GIT_TIMEOUT_MS,
      );
      input.outcome.path = input.targetPath;
      input.outcome.remoteUrl = input.url;
    });
  }

  return {
    async scaffold(input) {
      const parentDirectory = resolve(input.parentDirectory);
      const resolved = resolveProjectFolderName({
        folderName: input.folderName,
        git: input.git,
      });
      if (!resolved.folderName) {
        throw new ProjectScaffoldError(
          "invalid_name",
          `Invalid project folder name (${resolved.error ?? "empty"})`,
        );
      }
      const folderName = resolved.folderName;
      const targetPath = join(parentDirectory, folderName);

      if (!(await isDirectory(parentDirectory))) {
        throw new ProjectScaffoldError(
          "parent_not_found",
          `Directory not found: ${parentDirectory}`,
        );
      }
      // Checked up front for every path. Without this, `mkdir` would throw a
      // raw EEXIST and `git clone` would fail with its own wording — the client
      // needs one code it can turn into "that name is taken".
      if (await pathExists(targetPath)) {
        throw new ProjectScaffoldError("already_exists", `Already exists: ${targetPath}`);
      }

      const plan = buildProjectScaffoldStepPlan(input.git);
      const recorder = new StepRecorder(plan, deps.onProgress);
      const outcome: ProjectScaffoldOutcome = { path: null, remoteUrl: null, steps: [] };

      try {
        if (input.git.kind === "clone") {
          await runClonePath({
            parentDirectory,
            targetPath,
            folderName,
            url: input.git.url,
            recorder,
            outcome,
          });
        } else if (input.git.kind === "none") {
          await recorder.run("create_directory", async () => {
            await mkdir(targetPath, { recursive: false });
            outcome.path = targetPath;
          });
        } else {
          await runInitPath({
            targetPath,
            projectName: folderName,
            git: input.git,
            recorder,
            outcome,
          });
        }
      } catch (error) {
        outcome.steps = recorder.snapshot();
        throw attachOutcome(toScaffoldError(error, input.git.kind), outcome);
      }

      outcome.steps = recorder.snapshot();
      return outcome;
    },
  };
}

// The partial outcome of a failed scaffold, so the caller can report which
// steps ran and what landed on disk alongside the error.
const OUTCOME_KEY = Symbol("projectScaffoldOutcome");

interface ErrorWithOutcome {
  [OUTCOME_KEY]?: ProjectScaffoldOutcome;
}

function attachOutcome(error: Error, outcome: ProjectScaffoldOutcome): Error {
  (error as Error & ErrorWithOutcome)[OUTCOME_KEY] = outcome;
  return error;
}

export function getScaffoldOutcome(error: unknown): ProjectScaffoldOutcome | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  return (error as ErrorWithOutcome)[OUTCOME_KEY] ?? null;
}

// Everything below the plan layer throws plain Errors (git failures, fs errors,
// provider errors). Map them onto the wire codes the client branches on, using
// which phase we were in to disambiguate an otherwise identical git failure.
function toScaffoldError(error: unknown, gitKind: ProjectScaffoldGit["kind"]): Error {
  if (error instanceof ProjectScaffoldError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (isMissingGitError(error)) {
    return new ProjectScaffoldError("git_unavailable", "git is not installed or not in PATH");
  }
  if (gitKind === "clone") {
    return new ProjectScaffoldError("clone_failed", message);
  }
  return new ProjectScaffoldError("git_failed", message);
}

function isMissingGitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as { code?: string }).code === "ENOENT";
}
