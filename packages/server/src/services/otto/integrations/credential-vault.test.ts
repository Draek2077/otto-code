import { expect, it } from "vitest";
import {
  CredentialVaultUnavailableError,
  KeyringCredentialVault,
  type CredentialVaultKey,
} from "./credential-vault.js";

const key: CredentialVaultKey = { hostId: "host", integrationId: "atlassian", connectionId: "one" };
const account = (value: CredentialVaultKey) =>
  Buffer.from(JSON.stringify([value.hostId, value.integrationId, value.connectionId])).toString(
    "base64url",
  );
function fixture() {
  const values = new Map<string, string>();
  const reads: string[] = [];
  let denial: string | null = null;
  const vault = new KeyringCredentialVault({
    create(service, name) {
      expect(service).toBe("Otto Integration Authorization");
      return {
        getPassword() {
          reads.push(name);
          if (denial === "read") throw new Error("sensitive native error");
          return values.get(name);
        },
        setPassword(value) {
          if (denial === "write") throw new Error(value);
          values.set(name, value);
        },
        deletePassword() {
          return values.delete(name);
        },
      };
    },
  });
  return {
    vault,
    values,
    reads,
    deny: (value: string) => {
      denial = value;
    },
  };
}
it("is inert until a credential operation is requested", () => {
  const f = fixture();
  expect(f.reads).toEqual([]);
  expect(f.values.size).toBe(0);
});
it("reads the original 0.9 single-entry identity without migration", async () => {
  const f = fixture();
  f.values.set(account(key), "preserved-secret");
  const before = [...f.values];
  expect(await f.vault.get(key)).toBe("preserved-secret");
  expect([...f.values]).toEqual(before);
});
it("reads bounded 0.9 chunk manifests without rewriting", async () => {
  const f = fixture();
  const name = account(key);
  f.values.set(`${name}:chunks`, JSON.stringify({ version: 1, partCount: 2 }));
  f.values.set(`${name}:chunk:0`, "first-");
  f.values.set(`${name}:chunk:1`, "second");
  const before = [...f.values];
  expect(await f.vault.get(key)).toBe("first-second");
  expect([...f.values]).toEqual(before);
});
it("stores Unicode secrets in bounded immutable chunks and isolates hosts", async () => {
  const f = fixture();
  const secret = "🔒".repeat(800);
  await f.vault.put(key, secret);
  expect(await f.vault.get(key)).toBe(secret);
  expect(await f.vault.get({ ...key, hostId: "other" })).toBeNull();
  for (const [name, value] of f.values)
    if (!name.endsWith(":chunks")) expect(Buffer.byteLength(value)).toBeLessThanOrEqual(1024);
});
it("requires a new identity for rotation and keeps the original secret", async () => {
  const f = fixture();
  await f.vault.put(key, "first");
  await expect(f.vault.put(key, "second")).rejects.toBeInstanceOf(CredentialVaultUnavailableError);
  await f.vault.put({ ...key, connectionId: "two" }, "second");
  expect(await f.vault.get(key)).toBe("first");
  expect(await f.vault.get({ ...key, connectionId: "two" })).toBe("second");
});
it("removes only the exact credential and its referenced chunks", async () => {
  const f = fixture();
  await f.vault.put(key, "x".repeat(3000));
  const other = { ...key, integrationId: "other" };
  await f.vault.put(other, "keep");
  expect(await f.vault.delete(key)).toBe(true);
  expect(await f.vault.get(key)).toBeNull();
  expect(await f.vault.get(other)).toBe("keep");
  expect(await f.vault.delete(key)).toBe(false);
});
it("refuses malformed or oversized manifests without scanning unrelated entries", async () => {
  const f = fixture();
  f.values.set(`${account(key)}:chunks`, JSON.stringify({ version: 1, partCount: 999999 }));
  await expect(f.vault.get(key)).rejects.toBeInstanceOf(CredentialVaultUnavailableError);
  expect(f.reads).toEqual([`${account(key)}:chunks`]);
});
it("fails closed on missing chunks and never returns a partial secret", async () => {
  const f = fixture();
  f.values.set(`${account(key)}:chunks`, JSON.stringify({ version: 1, partCount: 2 }));
  f.values.set(`${account(key)}:chunk:0`, "partial");
  await expect(f.vault.get(key)).rejects.toBeInstanceOf(CredentialVaultUnavailableError);
});
it("redacts native errors and preserves prior credentials after a denied rotation", async () => {
  const f = fixture();
  await f.vault.put(key, "original");
  f.deny("write");
  await expect(f.vault.put({ ...key, connectionId: "two" }, "private token")).rejects.toThrow(
    "Secure credential storage is unavailable on this host.",
  );
  expect(await f.vault.get(key)).toBe("original");
  f.deny("read");
  await expect(f.vault.get(key)).rejects.not.toHaveProperty("cause");
});
it("rejects oversized input before any secret is stored", async () => {
  const f = fixture();
  await expect(f.vault.put(key, "x".repeat(131073))).rejects.toBeInstanceOf(
    CredentialVaultUnavailableError,
  );
  expect(f.values.size).toBe(0);
});
