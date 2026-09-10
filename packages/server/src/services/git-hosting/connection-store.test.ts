import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ForgeService } from "../forge-service.js";
import { ForgeConnectionStore, normalizeForgeHost } from "./connection-store.js";
import { resolveForgeProjectScope } from "./project-scope.js";
import * as atomic from "../../server/atomic-file.js";

describe("Forge connection selection", () => {
  let directory: string;
  let store: ForgeConnectionStore;
  let secrets: Map<string, string>;
  let readers: Map<string, () => Promise<string>>;
  beforeEach(async () => {
    const scratch = path.resolve("../../.tmp");
    await mkdir(scratch, { recursive: true });
    directory = await mkdtemp(path.join(scratch, "forge-connections-"));
    secrets = new Map();
    readers = new Map();
    store = new ForgeConnectionStore({
      filePath: path.join(directory, "connections.json"),
      authorization: {
        readSecret: async ({ connectionId }) => secrets.get(connectionId) ?? null,
        saveSecret: async ({ connectionId, value }) => {
          secrets.set(connectionId, value);
        },
        deleteConnection: async ({ connectionId }) => {
          secrets.delete(connectionId);
        },
      },
      validate: async (input) => ({ account: input.account!, secret: input.secret! }),
      createService: (connection, readCredential) => {
        readers.set(`${connection.id}:${connection.revision}`, readCredential);
        return { invalidate: vi.fn(), dispose: vi.fn() } as unknown as ForgeService;
      },
      projectExists: async (id) => ["work", "personal"].includes(id),
      resolveProjectId: async (cwd) => (cwd.includes("work") ? "work" : "personal"),
    });
    await store.initialize();
  });
  afterEach(async () => {
    store.dispose();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  const save = (account: string, scope?: { projectId?: string; host?: string }) =>
    store.manage({
      kind: "save",
      forge: "github",
      host: scope?.host ?? "github.com",
      label: account,
      account,
      method: "token",
      secret: `fixture-${account}`,
      useForScope: true,
      projectId: scope?.projectId,
    });

  it("inherits host defaults, shares a project connection across worktrees, and isolates other projects", async () => {
    const personal = (await save("personal")).connections[0]!;
    const work = (await save("work", { projectId: "work" })).connections[1]!;
    const hostService = store.resolve("github", "github.com");
    const workService = await store.forCwd("/work", "github", "github.com");
    expect(workService).not.toBe(hostService);
    expect(await store.forCwd("/external-worktree", "github", "github.com")).toBe(workService);
    expect(await store.forCwd("/personal", "github", "github.com")).toBe(hostService);
    expect(await readers.get(`${personal.id}:1`)!()).toBe("fixture-personal");
    expect(await readers.get(`${work.id}:1`)!()).toBe("fixture-work");
    await store.manage({
      kind: "select",
      forge: "github",
      host: "github.com",
      projectId: "work",
      connectionId: null,
    });
    expect(await store.forCwd("/work", "github", "github.com")).toBe(hostService);
  });

  it("keeps credentials out of metadata and client responses, and restores selections after reload", async () => {
    await save("work", { projectId: "work" });
    const metadata = await readFile(path.join(directory, "connections.json"), "utf8");
    expect(metadata).not.toContain("fixture-work");
    expect(JSON.stringify(store.overview("work"))).not.toContain("fixture-work");
    const before = store.overview("work");
    await store.initialize();
    expect(store.overview("work")).toEqual(before);
  });

  it("does not fall back after an override is removed or its vault entry disappears", async () => {
    await save("personal");
    const work = (await save("work", { projectId: "work" })).connections[1]!;
    const service = await store.forCwd("/work", "github", "github.com");
    secrets.delete(`${work.id}:1`);
    await expect(readers.get(`${work.id}:1`)!()).rejects.toThrow("Reconnect");
    await store.manage({ kind: "remove", id: work.id, expectedRevision: 1 });
    await expect(store.forCwd("/work", "github", "github.com")).rejects.toThrow("unavailable");
    expect(store.resolve("github", "github.com")).not.toBe(service);
    expect(store.overview("work").overrides[0]?.connectionId).toBe(work.id);
  });

  it("isolates servers and rejects selecting a connection for another server or provider", async () => {
    const cloud = (await save("cloud")).connections[0]!;
    expect(store.resolve("github", "enterprise.example")).toBeNull();
    await expect(
      store.manage({
        kind: "select",
        forge: "github",
        host: "enterprise.example",
        connectionId: cloud.id,
      }),
    ).rejects.toThrow("provider and server");
    await expect(
      store.manage({ kind: "select", forge: "gitlab", host: "github.com", connectionId: cloud.id }),
    ).rejects.toThrow("provider and server");
    await expect(save("work", { projectId: "unknown" })).rejects.toThrow("Project not found");
  });

  it("replaces credentials atomically, retires old adapters, and rejects stale or different-account updates", async () => {
    const connection = (await save("work")).connections[0]!;
    const old = store.resolve("github", "github.com")!;
    const update = { kind: "save" as const, ...connection, expectedRevision: 1, secret: "rotated" };
    await expect(store.manage({ ...update, account: "other" })).rejects.toThrow("another account");
    await store.manage(update);
    expect(old.dispose).toHaveBeenCalledOnce();
    await expect(readers.get(`${connection.id}:1`)!()).rejects.toThrow("changed");
    expect(secrets.has(`${connection.id}:1`)).toBe(false);
    expect(secrets.get(`${connection.id}:2`)).toBe("rotated");
    await expect(store.manage(update)).rejects.toThrow("changed");
  });

  it("preserves the previous connection if its replacement cannot be persisted", async () => {
    const connection = (await save("work")).connections[0]!;
    vi.spyOn(atomic, "writeJsonFileAtomic").mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(
      store.manage({ kind: "save", ...connection, expectedRevision: 1, secret: "rotated" }),
    ).rejects.toThrow("disk unavailable");
    expect(store.overview().connections[0]?.revision).toBe(1);
    expect([...secrets.values()]).toEqual(["fixture-work"]);
  });

  it("resolves nested projects and external worktrees without matching sibling paths", () => {
    const projects = [
      { projectId: "work", rootPath: path.resolve("repo") },
      { projectId: "nested", rootPath: path.resolve("repo/nested") },
    ];
    const workspaces = [
      {
        projectId: "work",
        cwd: path.resolve("worktrees/feature/src"),
        worktreeRoot: path.resolve("worktrees/feature"),
      },
    ];
    expect(resolveForgeProjectScope(path.resolve("repo/nested/src"), projects, workspaces)).toBe(
      "nested",
    );
    expect(resolveForgeProjectScope(path.resolve("worktrees/feature"), projects, workspaces)).toBe(
      "work",
    );
    expect(resolveForgeProjectScope(path.resolve("repo-other"), projects, workspaces)).toBeNull();
    expect(
      resolveForgeProjectScope(
        path.resolve("worktrees/feature"),
        projects.map((p) => ({
          projectId: p.projectId,
          rootPath: p.rootPath,
          archivedAt: "today",
        })),
        workspaces,
      ),
    ).toBeNull();
  });

  it("normalizes endpoint hosts and rejects credential-bearing URLs", () => {
    expect(normalizeForgeHost(" GITHUB.COM ")).toBe("github.com");
    expect(normalizeForgeHost("forge.example:8443")).toBe("forge.example:8443");
    expect(() => normalizeForgeHost("someone:credential@github.com")).toThrow("hostname");
  });
});
