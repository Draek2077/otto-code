import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "pino";
import type { ProjectScaffoldStep } from "@otto-code/protocol/messages";
import type { GitHostingService } from "../../services/git-hosting/types.js";
import { runGitCommand } from "../../utils/run-git-command.js";
import {
  createProjectScaffoldService,
  getScaffoldOutcome,
  ProjectScaffoldError,
} from "./project-scaffold-service.js";

// Real git against a real temp directory: the whole point of this service is
// the filesystem and git side effects, so mocking them would test nothing.

const silentLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  trace: () => {},
} as unknown as Logger;

function createService(input: {
  progress: ProjectScaffoldStep[];
  hosting?: GitHostingService | null;
}) {
  return createProjectScaffoldService({
    logger: silentLogger,
    resolveHostingProvider: async () => input.hosting ?? null,
    onProgress: (step) => input.progress.push(step),
  });
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path)
    .then((entry) => entry.isDirectory())
    .catch(() => false);
}

describe("createProjectScaffoldService", () => {
  let parentDirectory: string;
  let progress: ProjectScaffoldStep[];

  beforeEach(async () => {
    parentDirectory = await mkdtemp(join(tmpdir(), "otto-scaffold-"));
    progress = [];
    // The service intentionally commits with the host's own git identity. A CI
    // machine may not have one configured, so supply it through the environment
    // the spawned git inherits rather than teaching the service about tests.
    process.env.GIT_AUTHOR_NAME = "Otto Test";
    process.env.GIT_AUTHOR_EMAIL = "test@example.com";
    process.env.GIT_COMMITTER_NAME = "Otto Test";
    process.env.GIT_COMMITTER_EMAIL = "test@example.com";
  });

  afterEach(async () => {
    await rm(parentDirectory, { recursive: true, force: true });
  });

  it("creates a plain directory and reports one step", async () => {
    const service = createService({ progress });

    const outcome = await service.scaffold({
      parentDirectory,
      folderName: "plain-thing",
      git: { kind: "none" },
    });

    expect(outcome.path).toBe(join(parentDirectory, "plain-thing"));
    expect(await isDirectory(outcome.path!)).toBe(true);
    expect(outcome.steps.map((step) => [step.id, step.status])).toEqual([
      ["create_directory", "done"],
      // register_project belongs to the session, not this service.
      ["register_project", "skipped"],
    ]);
  });

  it("initializes a repo with starter files on the requested branch and commits them", async () => {
    const service = createService({ progress });

    const outcome = await service.scaffold({
      parentDirectory,
      folderName: "fresh-repo",
      git: {
        kind: "init",
        initialBranch: "main",
        addReadme: true,
        gitignoreTemplate: "node",
        initialCommit: true,
      },
    });

    const path = outcome.path!;
    expect(await isDirectory(join(path, ".git"))).toBe(true);
    expect(await readFile(join(path, "README.md"), "utf8")).toBe("# fresh-repo\n");
    expect(await readFile(join(path, ".gitignore"), "utf8")).toContain("node_modules/");

    const branch = await runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: path });
    expect(branch.stdout.trim()).toBe("main");

    // A commit exists and it contains the starter files.
    const files = await runGitCommand(["show", "--name-only", "--format=", "HEAD"], { cwd: path });
    expect(files.stdout).toContain("README.md");
    expect(files.stdout).toContain(".gitignore");
  });

  it("skips the starter-files step when none were requested", async () => {
    const service = createService({ progress });

    const outcome = await service.scaffold({
      parentDirectory,
      folderName: "bare-repo",
      git: { kind: "init", initialBranch: "main" },
    });

    expect(outcome.steps.map((step) => step.id)).not.toContain("starter_files");
    expect(await isDirectory(join(outcome.path!, ".git"))).toBe(true);
  });

  it("clones an existing repository into the named folder", async () => {
    // A real local repo to clone from - no network involved.
    const origin = join(parentDirectory, "origin");
    await runGitCommand(["init", "--initial-branch", "main", origin], { cwd: parentDirectory });
    await runGitCommand(["commit", "--allow-empty", "-m", "seed"], {
      cwd: origin,
      envOverlay: {
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    });

    const service = createService({ progress });
    const outcome = await service.scaffold({
      parentDirectory,
      folderName: "cloned-thing",
      git: { kind: "clone", url: origin },
    });

    expect(outcome.path).toBe(join(parentDirectory, "cloned-thing"));
    expect(await isDirectory(join(outcome.path!, ".git"))).toBe(true);
    expect(outcome.remoteUrl).toBe(origin);
    expect(outcome.steps.map((step) => [step.id, step.status])).toEqual([
      ["git_clone", "done"],
      ["register_project", "skipped"],
    ]);
  });

  it("derives the folder name from the clone URL when none was given", async () => {
    // The source lives in its own subdirectory so the derived name is free.
    const sources = join(parentDirectory, "sources");
    await mkdir(sources);
    const origin = join(sources, "seed-repo");
    await runGitCommand(["init", "--initial-branch", "main", origin], { cwd: sources });

    const service = createService({ progress });
    const outcome = await service.scaffold({
      parentDirectory,
      folderName: undefined,
      git: { kind: "clone", url: origin },
    });

    expect(outcome.path).toBe(join(parentDirectory, "seed-repo"));
  });

  it("refuses a name that would escape the parent directory", async () => {
    const service = createService({ progress });

    await expect(
      service.scaffold({
        parentDirectory,
        folderName: "../escape",
        git: { kind: "none" },
      }),
    ).rejects.toMatchObject({ code: "invalid_name" });
  });

  it("refuses to overwrite an existing path", async () => {
    const service = createService({ progress });
    await service.scaffold({ parentDirectory, folderName: "taken", git: { kind: "none" } });

    await expect(
      service.scaffold({ parentDirectory, folderName: "taken", git: { kind: "none" } }),
    ).rejects.toMatchObject({ code: "already_exists" });
  });

  it("reports a missing parent directory before creating anything", async () => {
    const service = createService({ progress });

    await expect(
      service.scaffold({
        parentDirectory: join(parentDirectory, "nope"),
        folderName: "thing",
        git: { kind: "none" },
      }),
    ).rejects.toMatchObject({ code: "parent_not_found" });
  });

  it("creates the remote, wires origin and pushes", async () => {
    // A bare repo standing in for the provider's freshly created remote.
    const remotePath = join(parentDirectory, "remote.git");
    await runGitCommand(["init", "--bare", "--initial-branch", "main", remotePath], {
      cwd: parentDirectory,
    });

    const hosting = {
      createRepository: async () => ({
        fullName: "acme/pushed",
        cloneUrl: remotePath,
        webUrl: null,
        defaultBranch: "main",
      }),
    } as unknown as GitHostingService;

    const service = createService({ progress, hosting });
    const outcome = await service.scaffold({
      parentDirectory,
      folderName: "pushed",
      git: {
        kind: "init",
        initialBranch: "main",
        addReadme: true,
        remote: {
          providerId: "github",
          owner: "acme",
          name: "pushed",
          visibility: "private",
        },
      },
    });

    expect(outcome.remoteUrl).toBe(remotePath);
    expect(outcome.steps.map((step) => [step.id, step.status])).toEqual([
      ["create_directory", "done"],
      ["git_init", "done"],
      ["starter_files", "done"],
      // Implied by the remote even though initialCommit was not set.
      ["initial_commit", "done"],
      ["create_remote", "done"],
      ["push", "done"],
      ["register_project", "skipped"],
    ]);

    // The remote really received the branch.
    const remoteBranches = await runGitCommand(["branch", "--list"], { cwd: remotePath });
    expect(remoteBranches.stdout).toContain("main");
  });

  it("keeps the created directory and reports the failed step when the provider fails", async () => {
    const hosting = {
      createRepository: async () => {
        throw new Error("provider said no");
      },
    } as unknown as GitHostingService;

    const service = createService({ progress, hosting });
    const error = await service
      .scaffold({
        parentDirectory,
        folderName: "half-built",
        git: {
          kind: "init",
          initialBranch: "main",
          remote: {
            providerId: "github",
            owner: null,
            name: "half-built",
            visibility: "private",
          },
        },
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ProjectScaffoldError);
    const outcome = getScaffoldOutcome(error);
    // The local repo is real and usable; only the remote half failed.
    expect(outcome?.path).toBe(join(parentDirectory, "half-built"));
    expect(await isDirectory(join(parentDirectory, "half-built", ".git"))).toBe(true);
    expect(outcome?.steps.find((step) => step.id === "create_remote")).toMatchObject({
      status: "failed",
    });
    expect(outcome?.steps.find((step) => step.id === "push")).toMatchObject({
      status: "skipped",
    });
  });

  it("reports a provider that cannot create repositories rather than failing late", async () => {
    const service = createService({ progress, hosting: null });

    const error = await service
      .scaffold({
        parentDirectory,
        folderName: "no-provider",
        git: {
          kind: "init",
          remote: {
            providerId: "github",
            owner: null,
            name: "no-provider",
            visibility: "private",
          },
        },
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: "provider_unavailable" });
  });

  it("streams every step transition to onProgress", async () => {
    const service = createService({ progress });
    await service.scaffold({
      parentDirectory,
      folderName: "watched",
      git: { kind: "init", initialBranch: "main", addReadme: true, initialCommit: true },
    });

    expect(progress.filter((step) => step.status === "running").map((step) => step.id)).toEqual([
      "create_directory",
      "git_init",
      "starter_files",
      "initial_commit",
    ]);
  });
});
