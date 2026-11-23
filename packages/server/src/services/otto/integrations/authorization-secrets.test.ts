import { describe, expect, it } from "vitest";
import { IntegrationAuthorizationSecrets } from "./authorization-secrets.js";
import {
  IntegrationRegistryConflictError,
  type IntegrationRegistry,
  type IntegrationRegistrySnapshot,
} from "./registry.js";
import type { CredentialVault, CredentialVaultKey } from "./credential-vault.js";

const scope = { integrationId: "connectors", connectionId: "notion" };
function fixture() {
  let serial = 0;
  let snapshot: IntegrationRegistrySnapshot = {
    revision: "0",
    connections: { unrelated: { preserved: true } },
  };
  const secrets = new Map<string, string>();
  const calls: Array<{ operation: string; key: CredentialVaultKey }> = [];
  let publication: "normal" | "conflict" | "unknown-after-write" = "normal";
  let failDelete = false;
  let vaultOpened = 0;
  let onPut: (() => void) | null = null;
  const registry: IntegrationRegistry = {
    read: async () => structuredClone(snapshot),
    update: async (input) => {
      if (publication === "conflict" || input.expectedRevision !== snapshot.revision)
        throw new IntegrationRegistryConflictError();
      snapshot = {
        revision: String(++serial),
        connections: { ...snapshot.connections, [input.integrationId]: input.value },
      };
      if (publication === "unknown-after-write") throw new Error("native detail must not escape");
      return structuredClone(snapshot);
    },
  };
  const vault: CredentialVault = {
    async get(key) {
      calls.push({ operation: "get", key });
      return secrets.get(JSON.stringify(key)) ?? null;
    },
    async put(key, value) {
      calls.push({ operation: "put", key });
      expect(secrets.has(JSON.stringify(key))).toBe(false);
      secrets.set(JSON.stringify(key), value);
      onPut?.();
    },
    async delete(key) {
      calls.push({ operation: "delete", key });
      if (failDelete) throw new Error("sensitive native diagnostic");
      return secrets.delete(JSON.stringify(key));
    },
  };
  const service = new IntegrationAuthorizationSecrets({
    hostId: "fixture-host",
    registry,
    vault: async () => {
      vaultOpened++;
      return vault;
    },
  });
  return {
    service,
    secrets,
    calls,
    snapshot: () => snapshot,
    vaultOpened: () => vaultOpened,
    setPublication(value: typeof publication) {
      publication = value;
    },
    failRetirement() {
      failDelete = true;
    },
    onPut(value: () => void) {
      onPut = value;
    },
  };
}

describe("daemon-only integration authorization secrets", () => {
  it("does not open the vault on construction or an absent credential read", async () => {
    const host = fixture();
    expect(host.vaultOpened()).toBe(0);
    expect(await host.service.read(scope)).toEqual({ revision: "absent", value: null });
    expect(host.vaultOpened()).toBe(0);
  });

  it("uses host-scoped immutable identities, keeps tokens out of metadata and rotates only after publication", async () => {
    const host = fixture();
    const initial = await host.service.replace({
      ...scope,
      expectedRevision: "absent",
      value: "old-refresh-token",
    });
    expect(JSON.stringify(host.snapshot())).not.toContain("old-refresh-token");
    const next = await host.service.replace({
      ...scope,
      expectedRevision: initial.revision,
      value: "new-refresh-token",
    });
    expect(await host.service.read(scope)).toEqual({
      revision: next.revision,
      value: "new-refresh-token",
    });
    expect(host.secrets.size).toBe(1);
    const puts = host.calls.filter((call) => call.operation === "put");
    expect(puts[0].key).toMatchObject({ hostId: "fixture-host", integrationId: "connectors" });
    expect(puts[0].key.connectionId).not.toBe(puts[1].key.connectionId);
    expect(host.snapshot().connections.unrelated).toEqual({ preserved: true });
  });

  it("rejects a stale refresh before any vault access and serializes competing generations", async () => {
    const host = fixture();
    const outcomes = await Promise.allSettled([
      host.service.replace({ ...scope, expectedRevision: "absent", value: "accepted" }),
      host.service.replace({ ...scope, expectedRevision: "absent", value: "stale" }),
    ]);
    expect(outcomes.map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
    expect(host.calls.filter((call) => call.operation === "put")).toHaveLength(1);
    expect((await host.service.read(scope)).value).toBe("accepted");
  });

  it("retires only an unpublished identity on a proven metadata conflict", async () => {
    const host = fixture();
    await host.service.replace({ ...scope, expectedRevision: "absent", value: "keep-me" });
    host.setPublication("conflict");
    await expect(
      host.service.replace({
        ...scope,
        expectedRevision: (await host.service.read(scope)).revision,
        value: "discard-me",
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect((await host.service.read(scope)).value).toBe("keep-me");
    expect(host.secrets.size).toBe(1);
  });

  it("keeps the newly published credential after an uncertain I/O outcome, without retry", async () => {
    const host = fixture();
    host.setPublication("unknown-after-write");
    await expect(
      host.service.replace({ ...scope, expectedRevision: "absent", value: "published" }),
    ).rejects.toMatchObject({ kind: "uncertain" });
    expect((await host.service.read(scope)).value).toBe("published");
    expect(host.calls.filter((call) => call.operation === "put")).toHaveLength(1);
    expect(host.calls.filter((call) => call.operation === "delete")).toHaveLength(0);
  });

  it("reports failed retirement while leaving the accepted replacement readable", async () => {
    const host = fixture();
    await host.service.replace({ ...scope, expectedRevision: "absent", value: "old" });
    host.failRetirement();
    await expect(
      host.service.replace({
        ...scope,
        expectedRevision: (await host.service.read(scope)).revision,
        value: "new",
      }),
    ).rejects.toMatchObject({ kind: "retirement" });
    expect((await host.service.read(scope)).value).toBe("new");
    expect(host.secrets.size).toBe(2);
  });

  it("disconnects by removing the pointer before retiring its old credential", async () => {
    const host = fixture();
    await host.service.replace({ ...scope, expectedRevision: "absent", value: "remove-me" });
    await host.service.replace({
      ...scope,
      expectedRevision: (await host.service.read(scope)).revision,
      value: null,
    });
    expect((await host.service.read(scope)).value).toBeNull();
    expect(host.secrets.size).toBe(0);
  });

  it("does not treat inherited object property names as installed credentials", async () => {
    const host = fixture();
    expect((await host.service.read({ ...scope, connectionId: "constructor" })).value).toBeNull();
    expect(host.vaultOpened()).toBe(0);
  });

  it("fails closed if a referenced credential disappears", async () => {
    const host = fixture();
    await host.service.replace({ ...scope, expectedRevision: "absent", value: "missing" });
    host.secrets.clear();
    await expect(host.service.read(scope)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("does not make independent connectors' refresh generations conflict", async () => {
    const host = fixture();
    const other = { ...scope, connectionId: "linear" };
    const first = await host.service.read(scope);
    const second = await host.service.read(other);
    await host.service.replace({
      ...scope,
      expectedRevision: first.revision,
      value: "notion-token",
    });
    await host.service.replace({
      ...other,
      expectedRevision: second.revision,
      value: "linear-token",
    });
    expect((await host.service.read(scope)).value).toBe("notion-token");
    expect((await host.service.read(other)).value).toBe("linear-token");
  });

  it("retains a removal revision so a late absent-state callback cannot resurrect a credential", async () => {
    const host = fixture();
    const original = await host.service.read(scope);
    const installed = await host.service.replace({
      ...scope,
      expectedRevision: original.revision,
      value: "token",
    });
    await host.service.replace({ ...scope, expectedRevision: installed.revision, value: null });
    const count = host.calls.length;
    await expect(
      host.service.replace({ ...scope, expectedRevision: original.revision, value: "stale" }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(host.calls).toHaveLength(count);
    expect((await host.service.read(scope)).value).toBeNull();
  });

  it("rejects revoked callback authority during vault work before publishing its pointer", async () => {
    const host = fixture();
    const initial = await host.service.replace({
      ...scope,
      expectedRevision: "absent",
      value: "working-grant",
    });
    let admitted = true;
    host.onPut(() => {
      admitted = false;
    });
    await expect(
      host.service.replace({
        ...scope,
        expectedRevision: initial.revision,
        value: "late-grant",
        admit: () => admitted,
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect((await host.service.read(scope)).value).toBe("working-grant");
    expect(host.secrets.size).toBe(1);
  });
});
