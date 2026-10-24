import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AtlassianAccountService } from "./account.js";
import { KeyringCredentialVault } from "../integrations/credential-vault.js";
import {
  FileIntegrationRegistry,
  IntegrationRegistryConflictError,
} from "../integrations/registry.js";

const parent = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected fixture root");
    await rm(root, { recursive: true });
  }
});
async function fixture(legacy: unknown = {}) {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "atlassian-account-"));
  roots.push(root);
  const file = path.join(root, "registry.json");
  const secrets = new Map<string, string>();
  let opens = 0;
  const vault = new KeyringCredentialVault({
    create: (_service, account) => ({
      getPassword: () => secrets.get(account),
      setPassword: (value) => {
        secrets.set(account, value);
      },
      deletePassword: () => secrets.delete(account),
    }),
  });
  const real = new FileIntegrationRegistry(file);
  const state = { conflict: false, lost: false };
  const service = new AtlassianAccountService({
    hostId: "host",
    legacy: async () => legacy,
    vault: async () => {
      opens++;
      return vault;
    },
    registry: {
      read: () => real.read(),
      update: async (input) => {
        if (state.conflict) throw new IntegrationRegistryConflictError();
        const result = await real.update(input);
        if (state.lost) throw new Error("Response lost after publication");
        return result;
      },
    },
  });
  const config = {
    email: "fixture@example.test",
    siteUrl: "fixture",
    route: { kind: "site" as const },
  };
  async function save(
    credential: { kind: "keep" | "remove" } | { kind: "replace"; value: string },
  ) {
    return service.save({ expectedRevision: (await service.read()).revision, config, credential });
  }
  return { service, file, secrets, state, config, save, opens: () => opens };
}
it("reads preserved account settings without opening the vault or migrating config", async () => {
  const legacy = {
    gitHosting: {
      providers: {
        atlassian: { email: "old@example.test", apiToken: "old-secret", jiraSiteUrl: "old" },
      },
    },
  };
  const bytes = JSON.stringify(legacy);
  const f = await fixture(legacy);
  expect(await f.service.read()).toMatchObject({
    config: { email: "old@example.test", siteUrl: "https://old.atlassian.net" },
    credential: { stored: true, source: "preserved" },
  });
  expect(await f.service.resolve()).toMatchObject({ apiToken: "old-secret" });
  expect(f.opens()).toBe(0);
  expect(JSON.stringify(legacy)).toBe(bytes);
  await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
});
it("keeps secrets out of registry bytes and every safe snapshot", async () => {
  const f = await fixture();
  const saved = await f.save({ kind: "replace", value: "new-private-token" });
  expect(saved).toMatchObject({
    config: { siteUrl: "https://fixture.atlassian.net" },
    credential: { stored: true, source: "stored" },
  });
  expect(JSON.stringify(saved)).not.toContain("new-private-token");
  expect(await readFile(f.file, "utf8")).not.toContain("new-private-token");
  expect(await f.service.resolve()).toMatchObject({
    email: "fixture@example.test",
    apiToken: "new-private-token",
  });
});
it("uses scoped-token route metadata without returning credentials", async () => {
  const f = await fixture();
  const saved = await f.service.save({
    expectedRevision: (await f.service.read()).revision,
    config: { ...f.config, route: { kind: "scoped", cloudId: "cloud-123" } },
    credential: { kind: "replace", value: "token" },
  });
  expect(saved.config?.route).toEqual({ kind: "scoped", cloudId: "cloud-123" });
  expect(JSON.stringify(saved)).not.toContain('"token"');
});
it("rejects blank replacement and email/token identity mixing before any write", async () => {
  const f = await fixture();
  await expect(f.save({ kind: "replace", value: " " })).rejects.toMatchObject({
    kind: "validation",
  });
  expect(f.opens()).toBe(0);
  await f.save({ kind: "replace", value: "first" });
  const current = await f.service.read();
  await expect(
    f.service.save({
      expectedRevision: current.revision,
      config: { ...f.config, email: "other@example.test" },
      credential: { kind: "keep" },
    }),
  ).rejects.toMatchObject({ kind: "validation" });
  expect(await f.service.resolve()).toMatchObject({
    email: "fixture@example.test",
    apiToken: "first",
  });
});
it("rejects stale revisions before opening secure storage", async () => {
  const f = await fixture();
  const first = await f.service.read();
  await f.save({ kind: "replace", value: "first" });
  const opens = f.opens();
  await expect(
    f.service.save({
      expectedRevision: first.revision,
      config: f.config,
      credential: { kind: "replace", value: "stale" },
    }),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(f.opens()).toBe(opens);
  expect(await f.service.resolve()).toMatchObject({ apiToken: "first" });
});
it("cleans only an uncommitted new credential on a proven metadata conflict", async () => {
  const f = await fixture();
  await f.save({ kind: "replace", value: "first" });
  const prior = [...f.secrets];
  f.state.conflict = true;
  await expect(f.save({ kind: "replace", value: "second" })).rejects.toMatchObject({
    kind: "conflict",
  });
  expect([...f.secrets]).toEqual(prior);
  expect(await f.service.resolve()).toMatchObject({ apiToken: "first" });
});
it("retains a credential when the metadata publication outcome is unknown", async () => {
  const f = await fixture();
  f.state.lost = true;
  await expect(f.save({ kind: "replace", value: "published" })).rejects.toMatchObject({
    kind: "unavailable",
  });
  expect(await f.service.resolve()).toMatchObject({ apiToken: "published" });
});
it("rotates and removes only this account's referenced credential", async () => {
  const f = await fixture();
  await f.save({ kind: "replace", value: "first" });
  await f.save({ kind: "replace", value: "second" });
  expect([...f.secrets.values()].join(" ")).not.toContain("first");
  expect(await f.service.resolve()).toMatchObject({ apiToken: "second" });
  await f.save({ kind: "remove" });
  expect(await f.service.resolve()).toBeNull();
  expect(f.secrets.size).toBe(0);
});
it("explicit removal suppresses preserved credentials without rewriting old config", async () => {
  const legacy = {
    gitHosting: {
      providers: { atlassian: { email: "fixture@example.test", apiToken: "old-secret" } },
    },
  };
  const bytes = JSON.stringify(legacy);
  const f = await fixture(legacy);
  await f.save({ kind: "remove" });
  expect(await f.service.resolve()).toBeNull();
  expect(JSON.stringify(legacy)).toBe(bytes);
});
it("preserves unrelated integrations and unknown registry/account metadata", async () => {
  const f = await fixture();
  await writeFile(
    f.file,
    JSON.stringify({ version: 1, future: { keep: true }, connections: { zoom: { keep: "yes" } } }),
  );
  await f.save({ kind: "keep" });
  const record = JSON.parse(await readFile(f.file, "utf8"));
  expect(record.future).toEqual({ keep: true });
  expect(record.connections.zoom).toEqual({ keep: "yes" });
});
it("refuses corruption without repairing or overwriting the file", async () => {
  const f = await fixture();
  await writeFile(f.file, "{corrupt");
  await expect(f.service.read()).rejects.toThrow();
  expect(await readFile(f.file, "utf8")).toBe("{corrupt");
  expect(f.opens()).toBe(0);
});
