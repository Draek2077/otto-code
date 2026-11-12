import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import {
  readGitFetchPolicy,
  saveGitFetchPolicy,
  fetchWorkspaceGit,
} from "@getpaseo/plugin/otto/workspace-git";
import { WorkspaceGitHost, initialGitFetchPolicy } from "./host.js";
import { GitFetchSettingsStore } from "./settings.js";

const roots: string[] = [];
function prepare() {
  const home = mkdtempSync(path.join(tmpdir(), "otto-git-host-"));
  roots.push(home);
  const store = new GitFetchSettingsStore(home);
  const workspace = vi.fn(
    async (id: string): Promise<{ cwd: string; archivedAt: string | null } | null> =>
      id === "workspace" ? { cwd: path.join(home, "owning-project"), archivedAt: null } : null,
  );
  const policy = vi.fn(),
    fetch = vi.fn(async () => {});
  const host = new WorkspaceGitHost({ store, hostId: "host", workspace, policy, fetch });
  return { home, store, workspace, policy, fetch, host };
}
afterEach(() => {
  for (const home of roots.splice(0)) rmSync(home, { recursive: true, force: true });
});

test("construction and policy reads start no Git operation", async () => {
  const f = prepare();
  expect(f.fetch).not.toHaveBeenCalled();
  const response = readGitFetchPolicy.output.parse(
    await f.host.invoke(readGitFetchPolicy.name, { hostId: "host" }),
  );
  expect(response.ok).toBe(true);
  expect(f.policy).toHaveBeenCalledExactlyOnceWith({ enabled: true, intervalSeconds: 180 });
  expect(f.fetch).not.toHaveBeenCalled();
});

test("a policy is applied only after its revision-pinned save succeeds", async () => {
  const f = prepare(),
    initial = f.store.read();
  const saved = saveGitFetchPolicy.output.parse(
    await f.host.invoke(saveGitFetchPolicy.name, {
      hostId: "host",
      expectedRevision: initial.revision,
      patch: { enabled: false },
    }),
  );
  expect(saved.ok).toBe(true);
  expect(f.policy).toHaveBeenCalledExactlyOnceWith({ enabled: false, intervalSeconds: 180 });
  const stale = saveGitFetchPolicy.output.parse(
    await f.host.invoke(saveGitFetchPolicy.name, {
      hostId: "host",
      expectedRevision: initial.revision,
      patch: { intervalSeconds: 60 },
    }),
  );
  expect(stale).toEqual({
    ok: false,
    error: { kind: "conflict", message: "Git fetch settings changed. Reload before saving." },
  });
  expect(f.policy).toHaveBeenCalledTimes(1);
  expect(f.fetch).not.toHaveBeenCalled();
});

test("manual Fetch resolves only the selected host's actual active workspace", async () => {
  const f = prepare();
  const response = fetchWorkspaceGit.output.parse(
    await f.host.invoke(fetchWorkspaceGit.name, {
      hostId: "host",
      workspaceId: "workspace",
      cwd: "/untrusted-client-path",
    }),
  );
  expect(response).toEqual({ ok: true, value: { remote: "origin" } });
  expect(f.workspace).toHaveBeenCalledExactlyOnceWith("workspace");
  expect(f.fetch).toHaveBeenCalledExactlyOnceWith(path.join(f.home, "owning-project"));
});

test("a mismatched host cannot read settings or launch a fetch", async () => {
  const f = prepare();
  const response = fetchWorkspaceGit.output.parse(
    await f.host.invoke(fetchWorkspaceGit.name, {
      hostId: "other-host",
      workspaceId: "workspace",
    }),
  );
  expect(response.ok).toBe(false);
  const read = readGitFetchPolicy.output.parse(
    await f.host.invoke(readGitFetchPolicy.name, { hostId: "other-host" }),
  );
  expect(read.ok).toBe(false);
  expect(f.workspace).not.toHaveBeenCalled();
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.policy).not.toHaveBeenCalled();
});

test.each(["missing", "archived"])(
  "refuses a %s workspace before any Git command",
  async (state) => {
    const f = prepare();
    f.workspace.mockResolvedValueOnce(
      state === "missing" ? null : { cwd: "/archived", archivedAt: "past" },
    );
    const response = fetchWorkspaceGit.output.parse(
      await f.host.invoke(fetchWorkspaceGit.name, {
        hostId: "host",
        workspaceId: "workspace",
      }),
    );
    expect(response.ok).toBe(false);
    expect(f.fetch).not.toHaveBeenCalled();
  },
);

test("a Git failure returns useful recovery without exposing raw host diagnostics", async () => {
  const f = prepare();
  f.fetch.mockRejectedValueOnce(new Error("do-not-return-this-private-diagnostic"));
  const response = fetchWorkspaceGit.output.parse(
    await f.host.invoke(fetchWorkspaceGit.name, {
      hostId: "host",
      workspaceId: "workspace",
    }),
  );
  expect(response).toEqual({
    ok: false,
    error: {
      kind: "failed",
      message:
        "The host could not acknowledge Git fetch. Check its Git access and repository state before trying again.",
    },
  });
});

test("unreadable inherited settings disable automatic fetch without resetting the file", () => {
  const f = prepare(),
    report = vi.fn();
  writeFileSync(path.join(f.home, "otto-config.json"), "invalid-private-settings");
  expect(initialGitFetchPolicy(f.store, report)).toEqual({ enabled: false, intervalSeconds: 180 });
  expect(report).toHaveBeenCalledTimes(1);
  expect(f.fetch).not.toHaveBeenCalled();
});
