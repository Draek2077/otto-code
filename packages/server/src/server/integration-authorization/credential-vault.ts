import type { CredentialVaultAvailability as CredentialVaultAvailabilityProtocol } from "@otto-code/protocol/integration-authorization";

/** Stable, daemon-local identity for an opaque secret stored in a credential vault. */
export interface CredentialVaultKey {
  hostId: string;
  integrationId: string;
  connectionId: string;
}

export type CredentialVaultAvailability = CredentialVaultAvailabilityProtocol;

/**
 * The only interface allowed to hold integration credentials. Implementations
 * must never log values, and callers must never persist values alongside
 * IntegrationConnectionMetadata.
 */
export interface CredentialVault {
  getAvailability(): Promise<CredentialVaultAvailability>;
  get(key: CredentialVaultKey): Promise<string | null>;
  put(key: CredentialVaultKey, value: string): Promise<void>;
  delete(key: CredentialVaultKey): Promise<boolean>;
}

export class CredentialVaultUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`Secure credential storage is unavailable: ${reason}`);
    this.name = "CredentialVaultUnavailableError";
  }
}

/**
 * Safe default until a host has a reviewed OS-keyring backend. It fails closed;
 * no filesystem or daemon-config fallback is permitted.
 */
export class UnavailableCredentialVault implements CredentialVault {
  constructor(private readonly reason: string) {}

  async getAvailability(): Promise<CredentialVaultAvailability> {
    return { status: "unavailable", reason: this.reason };
  }

  async get(_key: CredentialVaultKey): Promise<string | null> {
    throw new CredentialVaultUnavailableError(this.reason);
  }

  async put(_key: CredentialVaultKey, _value: string): Promise<void> {
    throw new CredentialVaultUnavailableError(this.reason);
  }

  async delete(_key: CredentialVaultKey): Promise<boolean> {
    throw new CredentialVaultUnavailableError(this.reason);
  }
}

const KEYRING_SERVICE_NAME = "Otto Integration Authorization";
const KEYRING_PROBE_ACCOUNT = "otto-integration-vault-probe";
const KEYRING_BACKEND_NAME = "os-keyring";
const KEYRING_UNAVAILABLE_REASON = "The daemon host credential vault is unavailable.";
// Windows Credential Manager rejects larger generic credential blobs. Keep each
// opaque chunk below the observed platform limit while retaining OS-keyring-only
// storage on every platform.
const KEYRING_SECRET_CHUNK_BYTES = 1024;
const KEYRING_CHUNK_MANIFEST_VERSION = 1;

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(value: string): void;
  deletePassword(): boolean;
}

interface KeyringEntryFactory {
  create(service: string, account: string): KeyringEntry;
}

/**
 * OS-backed vault used by the daemon on supported hosts. The provider identity
 * is encoded into the keyring account name, never the credential value, so a
 * single daemon can safely own several connector authorizations.
 */
export class KeyringCredentialVault implements CredentialVault {
  constructor(private readonly entries: KeyringEntryFactory) {}

  async getAvailability(): Promise<CredentialVaultAvailability> {
    try {
      this.entries.create(KEYRING_SERVICE_NAME, KEYRING_PROBE_ACCOUNT).getPassword();
      return { status: "available", backend: KEYRING_BACKEND_NAME };
    } catch {
      return { status: "unavailable", reason: KEYRING_UNAVAILABLE_REASON };
    }
  }

  async get(key: CredentialVaultKey): Promise<string | null> {
    return this.withEntries(key, (entries) => {
      const manifest = readChunkManifest(entries.manifest.getPassword());
      if (!manifest) return entries.base.getPassword();

      const chunks = Array.from({ length: manifest.partCount }, (_, index) => {
        const value = entries.part(index).getPassword();
        if (value === null) throw new Error("Credential vault chunk is missing.");
        return value;
      });
      return chunks.join("");
    });
  }

  async put(key: CredentialVaultKey, value: string): Promise<void> {
    this.withEntries(key, (entries) => {
      const previousManifest = readChunkManifest(entries.manifest.getPassword());
      const chunks = splitKeyringSecret(value);

      if (chunks.length === 1) {
        entries.base.setPassword(value);
        deleteChunkedSecret(entries, previousManifest?.partCount ?? 0);
        return;
      }

      for (const [index, chunk] of chunks.entries()) {
        entries.part(index).setPassword(chunk);
      }
      entries.manifest.setPassword(
        JSON.stringify({ version: KEYRING_CHUNK_MANIFEST_VERSION, partCount: chunks.length }),
      );
      entries.base.deletePassword();
      for (let index = chunks.length; index < (previousManifest?.partCount ?? 0); index += 1) {
        entries.part(index).deletePassword();
      }
    });
  }

  async delete(key: CredentialVaultKey): Promise<boolean> {
    return this.withEntries(key, (entries) => {
      const manifest = readChunkManifest(entries.manifest.getPassword());
      const deletedBase = entries.base.deletePassword();
      const deletedManifest = entries.manifest.deletePassword();
      let deletedPart = false;
      for (let index = 0; index < (manifest?.partCount ?? 0); index += 1) {
        deletedPart = entries.part(index).deletePassword() || deletedPart;
      }
      return deletedBase || deletedManifest || deletedPart;
    });
  }

  private withEntries<T>(
    key: CredentialVaultKey,
    operation: (entries: {
      base: KeyringEntry;
      manifest: KeyringEntry;
      part: (index: number) => KeyringEntry;
    }) => T,
  ): T {
    try {
      const account = keyringAccountName(key);
      return operation({
        base: this.entries.create(KEYRING_SERVICE_NAME, account),
        manifest: this.entries.create(KEYRING_SERVICE_NAME, `${account}:chunks`),
        part: (index) => this.entries.create(KEYRING_SERVICE_NAME, `${account}:chunk:${index}`),
      });
    } catch {
      throw new CredentialVaultUnavailableError(KEYRING_UNAVAILABLE_REASON);
    }
  }
}

/**
 * Loads the native vault lazily. A missing native binding must leave the
 * daemon usable but make connector authorization unavailable, never fall back
 * to a plaintext file or Electron renderer storage.
 */
export async function createDaemonCredentialVault(): Promise<CredentialVault> {
  try {
    const keyring = await import("@napi-rs/keyring");
    return new KeyringCredentialVault({
      create(service, account) {
        return new keyring.Entry(service, account);
      },
    });
  } catch {
    return new UnavailableCredentialVault(KEYRING_UNAVAILABLE_REASON);
  }
}

function keyringAccountName(key: CredentialVaultKey): string {
  return Buffer.from(JSON.stringify([key.hostId, key.integrationId, key.connectionId])).toString(
    "base64url",
  );
}

function readChunkManifest(value: string | null): { partCount: number } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; partCount?: unknown };
    if (
      parsed.version !== KEYRING_CHUNK_MANIFEST_VERSION ||
      typeof parsed.partCount !== "number" ||
      !Number.isInteger(parsed.partCount) ||
      parsed.partCount < 2
    ) {
      throw new Error("Invalid credential vault chunk manifest.");
    }
    return { partCount: parsed.partCount };
  } catch {
    throw new CredentialVaultUnavailableError(KEYRING_UNAVAILABLE_REASON);
  }
}

function splitKeyringSecret(value: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (chunkBytes > 0 && chunkBytes + characterBytes > KEYRING_SECRET_CHUNK_BYTES) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  chunks.push(chunk);
  return chunks;
}

function deleteChunkedSecret(
  entries: { manifest: KeyringEntry; part: (index: number) => KeyringEntry },
  partCount: number,
): void {
  entries.manifest.deletePassword();
  for (let index = 0; index < partCount; index += 1) {
    entries.part(index).deletePassword();
  }
}
