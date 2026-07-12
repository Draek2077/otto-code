import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Turns a checked-in demo template (see templates/<name>/) into a real git
 * checkout with authored commit history, an optional feature branch, and an
 * optional uncommitted working-changes overlay. The materialized repo is what
 * gets registered as an Otto project for demo capture, so everything the UI
 * derives from git (log, branches, diffs) is authentic.
 */

export interface TemplateAuthor {
  name: string;
  email: string;
}

export interface TemplateCommit {
  /** Directory under templates/<name>/commits/ holding this commit's files. */
  dir: string;
  message: string;
  /** ISO timestamp used for both author and committer dates. */
  date: string;
  /** Index into the manifest's authors array. */
  author: number;
}

export interface TemplateManifest {
  name: string;
  defaultBranch: string;
  authors: TemplateAuthor[];
  commits: TemplateCommit[];
  featureBranch?: {
    name: string;
    /** 1-based index of the main-branch commit the feature branch starts from. */
    branchFromCommit: number;
    commits: TemplateCommit[];
  };
  /** Directory of repo-relative files applied after all commits, left uncommitted. */
  workingChanges?: string;
}

export interface MaterializedRepo {
  name: string;
  path: string;
  defaultBranch: string;
  /** Synthetic origin used so the UI groups the project under owner/repo. */
  originUrl: string;
  cleanup(): Promise<void>;
}

const TEMPLATES_ROOT = path.resolve(__dirname, "templates");

/** Root for materialized demo repos; override to control the path shown in captures. */
export function resolveDemoReposRoot(): string {
  const override = process.env.DEMO_REPOS_ROOT?.trim();
  return override && override.length > 0 ? override : path.join(tmpdir(), "otto-demos");
}

function git(repoPath: string, args: string[], env?: Record<string, string>): void {
  execFileSync("git", args, {
    cwd: repoPath,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
}

async function loadManifest(templateName: string): Promise<TemplateManifest> {
  const manifestPath = path.join(TEMPLATES_ROOT, templateName, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as TemplateManifest;
  if (!Array.isArray(manifest.commits) || manifest.commits.length === 0) {
    throw new Error(`Template ${templateName} has no commits in ${manifestPath}`);
  }
  return manifest;
}

function commitAll(repoPath: string, commit: TemplateCommit, authors: TemplateAuthor[]): void {
  const author = authors[commit.author];
  if (!author) {
    throw new Error(`Commit ${commit.dir} references missing author index ${commit.author}`);
  }
  git(repoPath, ["add", "-A"]);
  git(
    repoPath,
    [
      "-c",
      `user.name=${author.name}`,
      "-c",
      `user.email=${author.email}`,
      "commit",
      "--no-verify",
      "-m",
      commit.message,
    ],
    {
      GIT_AUTHOR_DATE: commit.date,
      GIT_COMMITTER_DATE: commit.date,
    },
  );
}

async function overlayCommitDir(input: {
  templateName: string;
  repoPath: string;
  dir: string;
}): Promise<void> {
  const sourceDir = path.join(TEMPLATES_ROOT, input.templateName, "commits", input.dir);
  if (!existsSync(sourceDir)) {
    throw new Error(`Template ${input.templateName} is missing commit dir ${sourceDir}`);
  }
  await cp(sourceDir, input.repoPath, { recursive: true });
}

function revParse(repoPath: string, ref: string): string {
  return execFileSync("git", ["rev-parse", ref], { cwd: repoPath, stdio: "pipe" })
    .toString()
    .trim();
}

/**
 * Materializes templates/<templateName> into <reposRoot>/<templateName>.
 * The destination is wiped first so re-runs are deterministic.
 */
export async function materializeTemplate(
  templateName: string,
  options?: { reposRoot?: string; originOwner?: string },
): Promise<MaterializedRepo> {
  const manifest = await loadManifest(templateName);
  const reposRoot = options?.reposRoot ?? resolveDemoReposRoot();
  const repoPath = path.join(reposRoot, manifest.name);
  const originOwner = options?.originOwner ?? "otto-demos";
  // Deliberately NOT github.com: a github origin makes the daemon's GitHub
  // forge layer poll a repo that doesn't exist (gh errors surface in the UI).
  // Any remote host still yields the owner/repo project display name.
  const originUrl = `https://git.demoforge.dev/${originOwner}/${manifest.name}.git`;

  await rm(repoPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await mkdir(repoPath, { recursive: true });

  git(repoPath, ["init", "-b", manifest.defaultBranch]);
  git(repoPath, ["config", "commit.gpgsign", "false"]);
  git(repoPath, ["config", "core.autocrlf", "false"]);
  // Origin is display-only: the daemon reads it for project grouping and never fetches.
  git(repoPath, ["remote", "add", "origin", originUrl]);

  const mainHeads: string[] = [];
  for (const commit of manifest.commits) {
    await overlayCommitDir({ templateName, repoPath, dir: commit.dir });
    commitAll(repoPath, commit, manifest.authors);
    mainHeads.push(revParse(repoPath, "HEAD"));
  }

  if (manifest.featureBranch) {
    const { name, branchFromCommit, commits } = manifest.featureBranch;
    const baseSha = mainHeads[branchFromCommit - 1];
    if (!baseSha) {
      throw new Error(
        `featureBranch.branchFromCommit=${branchFromCommit} is out of range for ${templateName}`,
      );
    }
    git(repoPath, ["checkout", "-b", name, baseSha]);
    for (const commit of commits) {
      await overlayCommitDir({ templateName, repoPath, dir: commit.dir });
      commitAll(repoPath, commit, manifest.authors);
    }
    git(repoPath, ["checkout", manifest.defaultBranch]);
  }

  if (manifest.workingChanges) {
    const overlayDir = path.join(TEMPLATES_ROOT, templateName, manifest.workingChanges);
    if (!existsSync(overlayDir)) {
      throw new Error(`Template ${templateName} is missing working-changes dir ${overlayDir}`);
    }
    await cp(overlayDir, repoPath, { recursive: true });
  }

  return {
    name: manifest.name,
    path: repoPath,
    defaultBranch: manifest.defaultBranch,
    originUrl,
    cleanup: async () => {
      await rm(repoPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}
