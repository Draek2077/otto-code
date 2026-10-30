import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CredentialVault, CredentialVaultKey } from "./credential-vault.js";
import {
  IntegrationRegistryConflictError,
  type IntegrationRegistry,
  type IntegrationRegistrySnapshot,
} from "./registry.js";

const Identity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/);
const Reference = z
  .object({ secretId: z.string().uuid().nullable(), revision: z.string().uuid() })
  .passthrough();
const Namespace = z
  .object({ version: z.literal(1), secrets: z.record(z.string(), Reference) })
  .passthrough();
export interface IntegrationSecretScope {
  integrationId: string;
  connectionId: string;
}
export class IntegrationSecretError extends Error {
  constructor(
    readonly kind: "conflict" | "unavailable" | "uncertain" | "retirement",
    message: string,
  ) {
    super(message);
  }
}

/** Shared daemon-only authorization storage. This is not an RPC or config DTO.
 * Each token/client bundle is one immutable vault value. Only its opaque pointer
 * lives in the authorization registry; ordinary refresh never rewrites user config.
 */
export class IntegrationAuthorizationSecrets {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly ports: {
      hostId: string;
      registry: IntegrationRegistry;
      vault(): Promise<CredentialVault>;
    },
  ) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.catch(() => undefined).then(operation);
    this.pending = result;
    return result;
  }

  private namespace(snapshot: IntegrationRegistrySnapshot, scope: IntegrationSecretScope) {
    Identity.parse(scope.integrationId);
    Identity.parse(scope.connectionId);
    const raw = Object.hasOwn(snapshot.connections, scope.integrationId)
      ? snapshot.connections[scope.integrationId]
      : undefined;
    return raw === undefined ? { version: 1 as const, secrets: {} } : Namespace.parse(raw);
  }

  private key(scope: IntegrationSecretScope, secretId: string): CredentialVaultKey {
    return {
      hostId: this.ports.hostId,
      integrationId: scope.integrationId,
      connectionId: `${scope.connectionId}:${secretId}`,
    };
  }

  read(scope: IntegrationSecretScope): Promise<{ revision: string; value: string | null }> {
    return this.exclusive(async () => {
      const snapshot = await this.ports.registry.read();
      const namespace = this.namespace(snapshot, scope);
      const reference = Object.hasOwn(namespace.secrets, scope.connectionId)
        ? namespace.secrets[scope.connectionId]
        : undefined;
      const revision = reference?.revision ?? "absent";
      if (!reference?.secretId) return { revision, value: null };
      try {
        const value = await (await this.ports.vault()).get(this.key(scope, reference.secretId));
        if (value === null) throw new Error("Missing authorization bundle");
        return { revision, value };
      } catch {
        throw new IntegrationSecretError(
          "unavailable",
          "Stored authorization is unavailable. Reconnect this integration on its host.",
        );
      }
    });
  }

  replace(
    input: IntegrationSecretScope & {
      expectedRevision: string;
      value: string | null;
      admit?: () => boolean;
    },
  ): Promise<{ revision: string }> {
    return this.exclusive(async () => {
      const current = await this.ports.registry.read();
      const namespace = this.namespace(current, input);
      const old = Object.hasOwn(namespace.secrets, input.connectionId)
        ? namespace.secrets[input.connectionId]
        : undefined;
      if ((old?.revision ?? "absent") !== input.expectedRevision) throw this.conflict();
      if (input.admit && !input.admit()) throw this.conflict();
      const secrets = { ...namespace.secrets };
      const nextId = input.value === null ? null : randomUUID();
      const nextRevision = randomUUID();
      let vault: CredentialVault | null = null;
      if (nextId !== null) {
        try {
          vault = await this.ports.vault();
          await vault.put(this.key(input, nextId), input.value!);
        } catch {
          // A failed native write may leave unreferenced chunks. Never reuse
          // this identity or retire the active credential; there is no retry.
          throw new IntegrationSecretError(
            "uncertain",
            "Authorization storage did not complete. Reload its host state before reconnecting.",
          );
        }
      }
      await this.checkPublicationAdmission(input, nextId, vault);
      // Retain a revisioned tombstone after removal. A late callback holding an
      // old "absent" read must not resurrect a disconnected authorization.
      secrets[input.connectionId] = { ...old, secretId: nextId, revision: nextRevision };
      try {
        await this.ports.registry.update({
          expectedRevision: current.revision,
          integrationId: input.integrationId,
          value: { ...namespace, secrets },
        });
      } catch (error) {
        if (!(error instanceof IntegrationRegistryConflictError)) {
          // Atomic publication may have completed before an I/O error. Deleting
          // the new key here could destroy the credential referenced on disk.
          throw new IntegrationSecretError(
            "uncertain",
            "The authorization outcome is unknown. Reload before reconnecting.",
          );
        }
        await this.retireUnpublished(input, nextId, vault);
        throw this.conflict();
      }
      if (old?.secretId) {
        try {
          await (vault ?? (await this.ports.vault())).delete(this.key(input, old.secretId));
        } catch {
          throw new IntegrationSecretError(
            "retirement",
            "Authorization was updated, but its previous credential could not be retired on this host. Reload before further changes.",
          );
        }
      }
      return { revision: nextRevision };
    });
  }

  private conflict() {
    return new IntegrationSecretError(
      "conflict",
      "Authorization changed elsewhere. Reload before reconnecting.",
    );
  }

  private async retireUnpublished(
    scope: IntegrationSecretScope,
    secretId: string | null,
    vault: CredentialVault | null,
  ): Promise<void> {
    if (secretId === null || !vault) return;
    try {
      await vault.delete(this.key(scope, secretId));
    } catch {
      throw new IntegrationSecretError(
        "retirement",
        "An unpublished authorization credential could not be retired on this host. Reload before further changes.",
      );
    }
  }

  private async checkPublicationAdmission(
    input: IntegrationSecretScope & { admit?: () => boolean },
    secretId: string | null,
    vault: CredentialVault | null,
  ): Promise<void> {
    if (!input.admit || input.admit()) return;
    await this.retireUnpublished(input, secretId, vault);
    throw this.conflict();
  }
}
