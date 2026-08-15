import { describe, expect, test } from "vitest";
import {
  CredentialVaultUnavailableError,
  KeyringCredentialVault,
  type CredentialVaultKey,
} from "./credential-vault.js";

class TestKeyringEntry {
  constructor(
    private readonly values: Map<string, string>,
    private readonly key: string,
  ) {}

  getPassword(): string | null {
    return this.values.get(this.key) ?? null;
  }

  setPassword(value: string): void {
    this.values.set(this.key, value);
  }

  deletePassword(): boolean {
    return this.values.delete(this.key);
  }
}

function createVault(): KeyringCredentialVault {
  const values = new Map<string, string>();
  return new KeyringCredentialVault({
    create(service, account) {
      return new TestKeyringEntry(values, `${service}:${account}`);
    },
  });
}

const PRIMARY_KEY: CredentialVaultKey = {
  hostId: "host-a",
  integrationId: "zoom-team-chat",
  connectionId: "primary",
};

describe("KeyringCredentialVault", () => {
  test("keeps each daemon connection in its own OS-keyring entry", async () => {
    const vault = createVault();

    await vault.put(PRIMARY_KEY, "refresh-token-a");
    await vault.put({ ...PRIMARY_KEY, connectionId: "secondary" }, "refresh-token-b");

    await expect(vault.get(PRIMARY_KEY)).resolves.toBe("refresh-token-a");
    await expect(vault.get({ ...PRIMARY_KEY, connectionId: "secondary" })).resolves.toBe(
      "refresh-token-b",
    );
    await expect(vault.delete(PRIMARY_KEY)).resolves.toBe(true);
    await expect(vault.get(PRIMARY_KEY)).resolves.toBeNull();
  });

  test("splits oversized opaque secrets without leaving the OS keyring", async () => {
    const vault = createVault();
    const secret = "token-".repeat(700);

    await vault.put(PRIMARY_KEY, secret);

    await expect(vault.get(PRIMARY_KEY)).resolves.toBe(secret);
    await expect(vault.delete(PRIMARY_KEY)).resolves.toBe(true);
    await expect(vault.get(PRIMARY_KEY)).resolves.toBeNull();
  });

  test("reports unavailable and fails closed when the OS keyring cannot be opened", async () => {
    const vault = new KeyringCredentialVault({
      create() {
        throw new Error("keyring offline");
      },
    });

    await expect(vault.getAvailability()).resolves.toEqual({
      status: "unavailable",
      reason: "The daemon host credential vault is unavailable.",
    });
    await expect(vault.put(PRIMARY_KEY, "refresh-token")).rejects.toBeInstanceOf(
      CredentialVaultUnavailableError,
    );
  });
});
