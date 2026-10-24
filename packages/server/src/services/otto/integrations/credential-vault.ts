import { randomUUID } from "node:crypto";
import { z } from "zod";

/** Daemon-only credentials. The tuple preserves Otto 0.9's OS-keyring identity. */
export interface CredentialVaultKey {
  hostId: string;
  integrationId: string;
  connectionId: string;
}
export interface CredentialVault {
  get(key: CredentialVaultKey): Promise<string | null>;
  /** Immutable identity: credential rotation must allocate a new connectionId. */
  put(key: CredentialVaultKey, value: string): Promise<void>;
  delete(key: CredentialVaultKey): Promise<boolean>;
}
export interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): unknown;
}
export interface KeyringEntries {
  create(service: string, account: string): KeyringEntry;
}
const SERVICE = "Otto Integration Authorization";
const CHUNK_BYTES = 1024;
const MAX_PARTS = 128;
const Manifest = z.discriminatedUnion("version", [
  z.object({ version: z.literal(1), partCount: z.number().int().min(2).max(MAX_PARTS) }),
  z.object({
    version: z.literal(2),
    partCount: z.number().int().min(1).max(MAX_PARTS),
    generation: z.string().uuid(),
  }),
]);
type ChunkManifest = z.infer<typeof Manifest>;
export class CredentialVaultUnavailableError extends Error {
  constructor() {
    // Native errors may contain secret material. Never attach their message or cause.
    super("Secure credential storage is unavailable on this host.");
    this.name = "CredentialVaultUnavailableError";
  }
}
function accountName(key: CredentialVaultKey): string {
  const tuple = [key.hostId, key.integrationId, key.connectionId];
  if (tuple.some((part) => !part || part.length > 256)) throw new Error("Invalid vault identity");
  return Buffer.from(JSON.stringify(tuple)).toString("base64url");
}
function manifest(raw: string | null | undefined): ChunkManifest | null {
  if (raw == null) return null;
  return Manifest.parse(JSON.parse(raw));
}
function chunks(value: string): string[] {
  if (!value || Buffer.byteLength(value) > CHUNK_BYTES * MAX_PARTS)
    throw new Error("Invalid credential size");
  const result: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of value) {
    const length = Buffer.byteLength(character);
    if (bytes + length > CHUNK_BYTES) {
      result.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += length;
  }
  result.push(current);
  return result;
}
/** No files, global configuration, process launches or keyring access on construction. */
export class KeyringCredentialVault implements CredentialVault {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly entries: KeyringEntries) {}
  private entry(account: string): KeyringEntry {
    return this.entries.create(SERVICE, account);
  }
  private part(account: string, value: ChunkManifest, index: number): KeyringEntry {
    // COMPAT(otto09Vault): added v0.10.0; retain legacy read through 2027-04-24.
    const suffix = value.version === 1 ? `chunk:${index}` : `chunk:${value.generation}:${index}`;
    return this.entry(`${account}:${suffix}`);
  }
  private async serialized<T>(
    key: CredentialVaultKey,
    operation: (account: string) => T,
  ): Promise<T> {
    let account: string;
    try {
      account = accountName(key);
    } catch {
      throw new CredentialVaultUnavailableError();
    }
    const previous = this.pending.get(account) ?? Promise.resolve();
    const result = previous
      .catch(() => undefined)
      .then(() => {
        try {
          return operation(account);
        } catch {
          throw new CredentialVaultUnavailableError();
        }
      });
    this.pending.set(account, result);
    try {
      return await result;
    } finally {
      if (this.pending.get(account) === result) this.pending.delete(account);
    }
  }
  get(key: CredentialVaultKey): Promise<string | null> {
    return this.serialized(key, (account) => {
      const value = manifest(this.entry(`${account}:chunks`).getPassword());
      if (!value) return this.entry(account).getPassword() ?? null;
      const parts = Array.from({ length: value.partCount }, (_, index) => {
        const part = this.part(account, value, index).getPassword();
        if (part == null || Buffer.byteLength(part) > CHUNK_BYTES) throw new Error("Missing chunk");
        return part;
      });
      return parts.join("");
    });
  }
  put(key: CredentialVaultKey, value: string): Promise<void> {
    return this.serialized(key, (account) => {
      const parts = chunks(value);
      const pointer = this.entry(`${account}:chunks`);
      if (pointer.getPassword() != null || this.entry(account).getPassword() != null)
        throw new Error("Allocate a new credential identity before rotation");
      const next: ChunkManifest = { version: 2, generation: randomUUID(), partCount: parts.length };
      // Parts are immutable and unreferenced until the final pointer write. A
      // failed write cannot corrupt the credential referenced by old metadata.
      parts.forEach((part, index) => this.part(account, next, index).setPassword(part));
      pointer.setPassword(JSON.stringify(next));
    });
  }
  delete(key: CredentialVaultKey): Promise<boolean> {
    return this.serialized(key, (account) => {
      const pointer = this.entry(`${account}:chunks`);
      const value = manifest(pointer.getPassword());
      const base = this.entry(account);
      const existed = value !== null || base.getPassword() != null;
      // Keep the pointer if a part deletion fails, so subsequent cleanup can
      // still identify the exact remaining entries. No broad keyring sweep.
      if (value)
        for (let index = 0; index < value.partCount; index += 1)
          this.part(account, value, index).deletePassword();
      base.deletePassword();
      pointer.deletePassword();
      return existed;
    });
  }
}
/** Loading the binding does not read or write the user's keyring. */
export async function createDaemonCredentialVault(): Promise<CredentialVault> {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new KeyringCredentialVault({
      create: (service, account) => new Entry(service, account),
    });
  } catch {
    throw new CredentialVaultUnavailableError();
  }
}
