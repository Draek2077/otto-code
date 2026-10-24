import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AtlassianConfigSchema as ConfigSchema,
  SaveAtlassianAccountSchema,
} from "@getpaseo/plugin/otto/atlassian-settings";
import type { CredentialVault, CredentialVaultKey } from "../integrations/credential-vault.js";
import {
  IntegrationRegistryConflictError,
  type IntegrationRegistry,
  type IntegrationRegistrySnapshot,
} from "../integrations/registry.js";
import {
  normalizeAtlassianSite,
  readLegacyAtlassian,
  type AtlassianCredential,
} from "./credentials.js";

const StoredSchema = ConfigSchema.extend({
  credentialId: z.string().uuid().nullable(),
}).passthrough();
export type AtlassianAccountConfig = z.infer<typeof ConfigSchema>;
export interface AtlassianAccountSnapshot {
  revision: string;
  config: AtlassianAccountConfig | null;
  credential: { stored: boolean; source: "stored" | "preserved" | "none" };
}
export class AtlassianAccountError extends Error {
  constructor(
    readonly kind: "validation" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}
function validatedSave(value: unknown) {
  const parsed = SaveAtlassianAccountSchema.safeParse(value);
  if (!parsed.success)
    throw new AtlassianAccountError(
      "validation",
      "Enter valid Atlassian account settings and an explicit credential action.",
    );
  const input = parsed.data;
  const siteUrl = input.config.siteUrl.trim() ? normalizeAtlassianSite(input.config.siteUrl) : "";
  if (siteUrl === null || (input.credential.kind === "replace" && !input.credential.value.trim()))
    throw new AtlassianAccountError(
      "validation",
      "Use an Atlassian Cloud site and a nonempty API token replacement.",
    );
  return { ...input, config: { ...input.config, siteUrl } };
}
/** Shared Jira/Bitbucket account. No credential ever enters a metadata snapshot. */
export class AtlassianAccountService {
  constructor(
    private readonly ports: {
      hostId: string;
      registry: IntegrationRegistry;
      vault: () => Promise<CredentialVault>;
      /** Read preserved Otto config on this host only; never rewrite or migrate it. */
      legacy: () => Promise<unknown>;
    },
  ) {}
  private vaultKey(connectionId: string): CredentialVaultKey {
    return { hostId: this.ports.hostId, integrationId: "atlassian", connectionId };
  }
  private async describe(registry: IntegrationRegistrySnapshot) {
    const raw = registry.connections.atlassian;
    if (raw !== undefined) {
      const stored = StoredSchema.safeParse(raw);
      if (!stored.success)
        throw new AtlassianAccountError(
          "unavailable",
          "The shared Atlassian settings need repair; they were left unchanged.",
        );
      const { email, siteUrl, route, credentialId } = stored.data;
      return {
        snapshot: {
          revision: registry.revision,
          config: { email, siteUrl, route },
          credential: {
            stored: credentialId !== null,
            source: credentialId === null ? ("none" as const) : ("stored" as const),
          },
        },
        stored: stored.data,
        legacy: null,
      };
    }
    const legacy = readLegacyAtlassian(await this.ports.legacy(), registry.revision);
    const config = legacy
      ? { email: legacy.email, siteUrl: legacy.siteUrl, route: legacy.route }
      : null;
    return {
      snapshot: {
        revision: registry.revision,
        config,
        credential: {
          stored: legacy !== null,
          source: legacy ? ("preserved" as const) : ("none" as const),
        },
      },
      stored: null,
      legacy,
    };
  }
  async read(): Promise<AtlassianAccountSnapshot> {
    return (await this.describe(await this.ports.registry.read())).snapshot;
  }
  async resolve(): Promise<AtlassianCredential | null> {
    const current = await this.describe(await this.ports.registry.read());
    if (current.legacy) return current.legacy;
    if (!current.stored?.credentialId) return null;
    const apiToken = await (
      await this.ports.vault()
    ).get(this.vaultKey(current.stored.credentialId));
    if (!apiToken)
      throw new AtlassianAccountError(
        "unavailable",
        "The shared Atlassian credential is unavailable in this host's secure storage.",
      );
    return {
      revision: current.snapshot.revision,
      email: current.stored.email,
      siteUrl: current.stored.siteUrl,
      route: current.stored.route,
      apiToken,
    };
  }
  private async retire(
    previous: string | null | undefined,
    next: string | null,
    vault: CredentialVault | null,
  ) {
    if (!previous || previous === next) return;
    try {
      const secure = vault ?? (await this.ports.vault());
      await secure.delete(this.vaultKey(previous));
    } catch {
      throw new AtlassianAccountError(
        "unavailable",
        "The account settings were saved, but secure credential cleanup failed. Reload before making another change.",
      );
    }
  }
  async save(value: unknown): Promise<AtlassianAccountSnapshot> {
    const input = validatedSave(value);
    const registry = await this.ports.registry.read();
    if (registry.revision !== input.expectedRevision)
      throw new AtlassianAccountError(
        "conflict",
        "Shared integration settings changed. Reload before saving.",
      );
    const current = await this.describe(registry);
    if (
      input.credential.kind === "keep" &&
      current.snapshot.credential.stored &&
      current.snapshot.config?.email !== input.config.email
    )
      throw new AtlassianAccountError(
        "validation",
        "Replace the API token when changing the Atlassian account email.",
      );
    const config = input.config;
    let credentialId = current.stored?.credentialId ?? null;
    let vault: CredentialVault | null = null;
    if (input.credential.kind === "remove") credentialId = null;
    else if (
      input.credential.kind === "replace" ||
      (input.credential.kind === "keep" && current.legacy)
    ) {
      const secret =
        input.credential.kind === "replace" ? input.credential.value : current.legacy!.apiToken;
      vault = await this.ports.vault();
      credentialId = randomUUID();
      // Explicit saving imports the preserved secret. Merely reading/resolving
      // it never copies it or rewrites the legacy host configuration.
      await vault.put(this.vaultKey(credentialId), secret);
    }
    let saved: IntegrationRegistrySnapshot;
    try {
      saved = await this.ports.registry.update({
        expectedRevision: input.expectedRevision,
        integrationId: "atlassian",
        value: { ...current.stored, ...config, credentialId },
      });
    } catch (error) {
      if (error instanceof IntegrationRegistryConflictError) {
        if (vault && credentialId) await vault.delete(this.vaultKey(credentialId));
        throw new AtlassianAccountError(
          "conflict",
          "Shared integration settings changed. Reload before saving.",
        );
      }
      // A filesystem failure can occur after publication. Do not delete the
      // new vault entry or blindly repeat a write with an unknown outcome.
      throw new AtlassianAccountError(
        "unavailable",
        "The account save outcome is unknown. Reload shared integration settings before saving again.",
      );
    }
    await this.retire(current.stored?.credentialId, credentialId, vault);
    return (await this.describe(saved)).snapshot;
  }
}
