import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { expect, it, onTestFinished } from "vitest";
import { BitbucketConnectionsStore } from "./connections.js";
import { BitbucketConnectionsRpc } from "./rpc.js";
import { FileIntegrationRegistry } from "../integrations/registry.js";
import type { CredentialVaultKey } from "../integrations/credential-vault.js";
import {
  readBitbucketWorkspaces,
  createBitbucketRepository,
  setBitbucketThreadResolution,
} from "@getpaseo/plugin/otto/bitbucket-connections";
async function fixture() {
  const scratch = path.resolve(import.meta.dirname, "../../../../../..", ".tmp");
  await mkdir(scratch, { recursive: true });
  const home = await mkdtemp(path.join(scratch, "bitbucket-rpc-"));
  if (path.dirname(home) !== scratch) throw new Error("Fixture escaped its own scratch directory");
  onTestFinished(() => rm(home, { recursive: true, force: true }));
  const keys = new Map<string, string>();
  const key = (entry: CredentialVaultKey) => JSON.stringify(entry);
  const store = new BitbucketConnectionsStore({
    hostId: "host",
    registry: new FileIntegrationRegistry(path.join(home, "accounts.json")),
    vault: async () => ({
      get: async (entry) => keys.get(key(entry)) ?? null,
      put: async (entry, value) => {
        keys.set(key(entry), value);
      },
      delete: async (entry) => keys.delete(key(entry)),
    }),
    shared: async () => null,
    legacy: async () => null,
    projectExists: async (id) => id === "project",
  });
  const initial = await store.read();
  const saved = await store.write(initial.revision, {
    kind: "save",
    label: "Work",
    email: "work@example.test",
    credential: { kind: "replace", value: "fixture-only" },
    select: true,
  });
  const requests: { url: string; method: string }[] = [];
  const commands: unknown[] = [];
  const rpc = new BitbucketConnectionsRpc(
    "host",
    store,
    async (url, init) => {
      requests.push({ url: String(url), method: init?.method ?? "GET" });
      if (String(url).includes("/user/workspaces"))
        return Response.json({
          values: [{ administrator: true, workspace: { slug: "work", name: "Work" } }],
        });
      return Response.json({ full_name: "work/report", name: "Report", is_private: true });
    },
    async (input) => {
      commands.push(input);
    },
  );
  return { rpc, store, saved, requests, commands };
}
it("serves workspace discovery through the typed owning-host RPC", async () => {
  const f = await fixture();
  const result = readBitbucketWorkspaces.output.parse(
    await f.rpc.invoke(readBitbucketWorkspaces.name, { hostId: "host" }),
  );
  expect(result).toEqual({
    ok: true,
    value: { workspaces: [{ id: "work", label: "Work", administrator: true }], truncated: false },
  });
  expect(f.requests).toEqual([
    { url: "https://api.bitbucket.org/2.0/user/workspaces?pagelen=50", method: "GET" },
  ]);
});
it("rejects a wrong host before any request or mutation", async () => {
  const f = await fixture();
  expect(await f.rpc.invoke(readBitbucketWorkspaces.name, { hostId: "other" })).toMatchObject({
    ok: false,
    error: { kind: "validation" },
  });
  expect(f.requests).toEqual([]);
});
it("rejects a stale account revision before creating a repository", async () => {
  const f = await fixture();
  await f.store.write(f.saved.revision, { kind: "select", connectionId: null });
  expect(
    await f.rpc.invoke(createBitbucketRepository.name, {
      hostId: "host",
      workspace: "work",
      name: "Report",
      description: "",
      private: true,
      expectedRevision: f.saved.revision,
    }),
  ).toMatchObject({ ok: false, error: { kind: "conflict" } });
  expect(f.requests).toEqual([]);
});
it("routes discussion resolution to its validated host handler", async () => {
  const f = await fixture();
  const input = {
    hostId: "host",
    cwd: "/registered/repo",
    expectedRevision: f.saved.revision,
    number: 17,
    commentId: 42,
    resolved: true,
  };
  expect(await f.rpc.invoke(setBitbucketThreadResolution.name, input)).toEqual({
    ok: true,
    value: { resolved: true },
  });
  expect(f.commands).toEqual([input]);
  expect(f.requests).toEqual([]);
});
