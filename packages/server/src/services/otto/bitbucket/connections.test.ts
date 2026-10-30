import path from "node:path";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { expect, it, onTestFinished } from "vitest";
import { BitbucketConnectionsStore } from "./connections.js";
import { FileIntegrationRegistry, type IntegrationRegistry } from "../integrations/registry.js";
import type { CredentialVaultKey } from "../integrations/credential-vault.js";
import { bitbucketProjectForCwd } from "./project.js";

function legacy() {
  return {
    connections: [
      {
        id: "work",
        forge: "bitbucket-cloud",
        host: "bitbucket.org",
        label: "Work",
        account: "Work account",
        method: "token",
        revision: 3,
        unknown: "retained",
      },
    ],
    defaults: [{ forge: "bitbucket-cloud", host: "bitbucket.org", connectionId: "work" }],
    projects: {
      special: [{ forge: "bitbucket-cloud", host: "bitbucket.org", connectionId: "missing" }],
    },
    otherField: { keep: true },
  };
}
async function fixture(
  old: unknown = legacy(),
  registryPort?: (registry: IntegrationRegistry) => IntegrationRegistry,
  legacyRead?: () => Promise<string | null>,
) {
  const scratch = path.resolve(import.meta.dirname, "../../../../../..", ".tmp");
  await mkdir(scratch, { recursive: true });
  const home = await mkdtemp(path.join(scratch, "bitbucket-connections-"));
  onTestFinished(() => rm(home, { recursive: true, force: true }));
  const file = path.join(home, "accounts.json");
  const registry = new FileIntegrationRegistry(file);
  const keys = new Map([
    ["work:3", JSON.stringify({ email: "work@example.test", apiToken: "old-private-key" })],
  ]);
  let vaultReads = 0;
  let sharedReads = 0;
  const writes: string[] = [];
  const vault = {
    get: async (key: CredentialVaultKey) => {
      expect(key.hostId).toBe("host");
      expect(key.integrationId).toBe("forge");
      vaultReads++;
      return keys.get(key.connectionId) ?? null;
    },
    put: async (key: CredentialVaultKey, value: string) => {
      expect(keys.has(key.connectionId)).toBe(false);
      keys.set(key.connectionId, value);
      writes.push(key.connectionId);
    },
    delete: async (key: CredentialVaultKey) => keys.delete(key.connectionId),
  };
  const oldBytes = old === null ? null : JSON.stringify(old);
  const store = new BitbucketConnectionsStore({
    hostId: "host",
    registry: registryPort?.(registry) ?? registry,
    vault: async () => vault,
    legacy: legacyRead ?? (async () => oldBytes),
    shared: async () => {
      sharedReads++;
      return { email: "shared@example.test", apiToken: "shared-key", revision: "shared" };
    },
    projectExists: async (id) => id === "special",
  });
  return {
    store,
    keys,
    file,
    writes,
    oldBytes,
    vaultReads: () => vaultReads,
    sharedReads: () => sharedReads,
  };
}
it("reads preserved named connections without reading secrets or creating metadata", async () => {
  const f = await fixture();
  expect(await f.store.read()).toMatchObject({
    selectedId: "work",
    connections: [{ id: "work", label: "Work", email: null, revision: 3 }],
  });
  expect(f.vaultReads()).toBe(0);
  await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
});
it("uses the original 0.9 keyring tuple and JSON credential without migration", async () => {
  const f = await fixture();
  expect(await f.store.resolve()).toMatchObject({
    email: "work@example.test",
    apiToken: "old-private-key",
  });
  expect(f.vaultReads()).toBe(1);
  expect(f.sharedReads()).toBe(0);
});
it("refuses importing a legacy source changed during credential work", async () => {
  const before = legacy(),
    after = { ...legacy(), otherField: { keep: false } };
  let reads = 0;
  const f = await fixture(before, undefined, async () =>
    JSON.stringify(reads++ < 2 ? before : after),
  );
  const opened = await f.store.read();
  await expect(
    f.store.write(opened.revision, {
      kind: "save",
      id: "work",
      label: "Changed",
      email: "work@example.test",
      credential: { kind: "keep" },
      select: true,
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(f.writes).toEqual(["work:4"]);
  expect(f.keys.has("work:4")).toBe(false);
  expect(f.keys.get("work:3")).toBe(
    JSON.stringify({ email: "work@example.test", apiToken: "old-private-key" }),
  );
  await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
});
it("never falls through when a project's explicitly selected connection is missing", async () => {
  const f = await fixture();
  await expect(f.store.resolve("special")).rejects.toThrow("has not switched accounts");
  expect(f.sharedReads()).toBe(0);
  expect(f.vaultReads()).toBe(0);
});
it("keeps unknown legacy fields and private credentials separate during an explicit save", async () => {
  const f = await fixture();
  const opened = await f.store.read();
  const saved = await f.store.write(opened.revision, {
    kind: "save",
    id: "work",
    label: "Updated work",
    email: "work@example.test",
    credential: { kind: "keep" },
    select: true,
  });
  expect(saved.connections).toEqual([
    {
      id: "work",
      label: "Updated work",
      email: "work@example.test",
      account: "work@example.test",
      revision: 4,
    },
  ]);
  expect(JSON.stringify(saved)).not.toContain("old-private-key");
  const disk = await readFile(f.file, "utf8");
  expect(disk).not.toContain("old-private-key");
  expect(JSON.parse(disk).connections.bitbucket).toMatchObject({
    otherField: { keep: true },
    connections: [{ unknown: "retained" }],
  });
  expect(f.keys.has("work:4")).toBe(true);
  expect(f.keys.has("work:3")).toBe(false);
});
it("refuses stale writes before touching the keyring", async () => {
  const f = await fixture();
  await expect(
    f.store.write("stale", {
      kind: "save",
      label: "Other",
      email: "new@example.test",
      credential: { kind: "replace", value: "new-private-key" },
      select: true,
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(f.writes).toEqual([]);
});
it("serializes competing saves so only one originating revision can publish", async () => {
  const f = await fixture();
  const opened = await f.store.read();
  const action = {
    kind: "save" as const,
    id: "work",
    label: "Work",
    email: "work@example.test",
    credential: { kind: "replace" as const, value: "replacement" },
    select: true,
  };
  const results = await Promise.allSettled([
    f.store.write(opened.revision, action),
    f.store.write(opened.revision, action),
  ]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(f.writes).toEqual(["work:4"]);
});
it("retains references to a removed account instead of silently using the shared identity", async () => {
  const f = await fixture();
  const snapshot = await f.store.read();
  await f.store.write(snapshot.revision, { kind: "remove", id: "work" });
  await expect(f.store.resolve()).rejects.toThrow("has not switched accounts");
  expect(f.sharedReads()).toBe(0);
});
it("keeps a new credential for reconciliation after an unknown publication outcome", async () => {
  const f = await fixture(null, (registry) => ({
    read: () => registry.read(),
    update: async () => {
      throw new Error("Publication outcome unknown");
    },
  }));
  const opened = await f.store.read();
  await expect(
    f.store.write(opened.revision, {
      kind: "save",
      label: "Work",
      email: "work@example.test",
      credential: { kind: "replace", value: "private" },
      select: true,
    }),
  ).rejects.toMatchObject({ kind: "unavailable" });
  expect(f.writes).toHaveLength(1);
  expect(f.keys.has(f.writes[0])).toBe(true);
});
it("refuses corrupt legacy metadata rather than selecting an ambient account", async () => {
  const f = await fixture({ broken: true });
  await expect(f.store.resolve()).rejects.toMatchObject({ kind: "unavailable" });
  expect(f.sharedReads()).toBe(0);
});
it("resolves an outside worktree to its owning project, with path-segment boundaries", () => {
  expect(
    bitbucketProjectForCwd(
      path.resolve("worktrees/task/src"),
      [{ cwd: path.resolve("worktrees/task"), projectId: "owning-project" }],
      [{ rootPath: path.resolve("projects/repo"), projectId: "main-project" }],
    ),
  ).toBe("owning-project");
  expect(
    bitbucketProjectForCwd(
      path.resolve("projects/repository"),
      [],
      [{ rootPath: path.resolve("projects/repo"), projectId: "main-project" }],
    ),
  ).toBeUndefined();
});
