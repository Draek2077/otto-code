import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { WorkspaceGitServiceImpl } from "../../workspace-git-service.js";
import { fetchWorkspaceGitRemote } from "../../workspace-git-fetch.js";

test("manual Fetch joins linked-worktree requests and publishes real file-origin refs while automatic fetch is off", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "otto-fetch-"));
  const origin = path.join(root, "origin.git"),
    seed = path.join(root, "seed"),
    repo = path.join(root, "repo"),
    linked = path.join(root, "linked");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();
  const commit = () =>
    git(
      seed,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn(async (...args: Parameters<typeof fetchWorkspaceGitRemote>) => {
    await gate;
    return fetchWorkspaceGitRemote(...args);
  });
  const forge = vi.fn(async () => {
    throw new Error("Fetch must not query a forge");
  });
  const service = new WorkspaceGitServiceImpl({
    logger: pino({ level: "silent" }),
    paseoHome: path.join(root, "home"),
    ottoFetchPolicy: { enabled: false, intervalSeconds: 180 },
    deps: { runGitFetch: fetch, getPullRequestStatus: forge },
  });
  try {
    git(root, "init", "--bare", "--initial-branch=main", origin);
    git(root, "init", "--initial-branch=main", seed);
    commit();
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-u", "origin", "main");
    git(root, "clone", origin, repo);
    git(repo, "worktree", "add", "-b", "linked", linked);
    git(linked, "branch", "--set-upstream-to=origin/main", "linked");
    const before = git(repo, "rev-parse", "origin/main");
    commit();
    git(seed, "push", "origin", "main");
    const after = git(seed, "rev-parse", "HEAD");
    expect(before).not.toBe(after);
    expect(fetch).not.toHaveBeenCalled();
    const first = service.fetchWorkspace(repo),
      second = service.fetchWorkspace(linked);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(git(repo, "rev-parse", "origin/main")).toBe(after);
    expect(service.peekSnapshot(repo)?.git.behindOfOrigin).toBe(1);
    expect(service.peekSnapshot(linked)?.git.behindOfOrigin).toBe(1);
    expect(forge).not.toHaveBeenCalled();
    git(repo, "remote", "remove", "origin");
    await expect(service.fetchWorkspace(repo)).rejects.toThrow("origin remote");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
