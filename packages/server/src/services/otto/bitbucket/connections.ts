import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  BitbucketConnections,
  BitbucketConnectionAction,
} from "@getpaseo/plugin/otto/bitbucket-connections";
import type { CredentialVault } from "../integrations/credential-vault.js";
import {
  IntegrationRegistryConflictError,
  type IntegrationRegistry,
} from "../integrations/registry.js";
import type { BitbucketCredential } from "./http.js";

const Connection = z
  .object({
    id: z.string().min(1).max(128),
    forge: z.string(),
    host: z.string(),
    label: z.string(),
    account: z.string(),
    email: z.string().email().optional(),
    method: z.string(),
    revision: z.number().int().nonnegative(),
  })
  .passthrough();
const Binding = z
  .object({ forge: z.string(), host: z.string(), connectionId: z.string() })
  .passthrough();
const Stored = z
  .object({
    connections: z.array(Connection).max(100),
    defaults: z.array(Binding),
    projects: z.record(z.string(), z.array(Binding)),
  })
  .passthrough();
type StoredConnections = z.infer<typeof Stored>;
const Secret = z.object({ email: z.string().email(), apiToken: z.string().min(1) });
const matches = (value: { forge: string; host: string }) =>
  value.forge === "bitbucket-cloud" && value.host === "bitbucket.org";
export class BitbucketConnectionError extends Error {
  constructor(
    readonly kind: "validation" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}
export interface BitbucketConnectionPorts {
  hostId: string;
  registry: IntegrationRegistry;
  vault: () => Promise<CredentialVault>;
  legacy: () => Promise<string | null>;
  shared: () => Promise<BitbucketCredential | null>;
  projectExists: (id: string) => Promise<boolean>;
}
/** Only public account metadata is persisted; the shared OS vault owns all keys. */
export class BitbucketConnectionsStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly ports: BitbucketConnectionPorts) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private key(connection: z.infer<typeof Connection>) {
    return {
      hostId: this.ports.hostId,
      integrationId: "forge",
      connectionId: `${connection.id}:${connection.revision}`,
    };
  }
  private async load() {
    const registry = await this.ports.registry.read();
    const current = registry.connections.bitbucket;
    let legacy: string | null = null;
    let data: StoredConnections;
    try {
      // COMPAT(otto09ForgeConnections): added v0.10.0; retain read-only import until 2027-04-30.
      // Missing selected accounts/keys never fall through to the shared identity.
      if (current === undefined) {
        legacy = await this.ports.legacy();
        data =
          legacy === null
            ? { connections: [], defaults: [], projects: {} }
            : Stored.parse(JSON.parse(legacy));
      } else data = Stored.parse(current);
    } catch {
      throw new BitbucketConnectionError(
        "unavailable",
        "Git connection metadata needs repair. It was left unchanged; no alternate account was selected.",
      );
    }
    const revision = createHash("sha256")
      .update(JSON.stringify([registry.revision, legacy]))
      .digest("hex");
    return { registry, data, revision };
  }
  private async project(projectId?: string) {
    if (projectId && !(await this.ports.projectExists(projectId)))
      throw new BitbucketConnectionError("validation", "Choose a project on this host.");
  }
  private describe(
    data: StoredConnections,
    revision: string,
    projectId?: string,
  ): BitbucketConnections {
    const hostDefaultId = data.defaults.find(matches)?.connectionId ?? null;
    const projectOverrideId = projectId
      ? (data.projects[projectId]?.find(matches)?.connectionId ?? null)
      : null;
    return {
      revision,
      projectId: projectId ?? null,
      selectedId: projectOverrideId ?? hostDefaultId,
      hostDefaultId,
      projectOverrideId,
      connections: data.connections.filter(matches).map((connection) => ({
        id: connection.id,
        label: connection.label,
        account: connection.account,
        email: connection.email ?? null,
        revision: connection.revision,
      })),
    };
  }
  async read(projectId?: string): Promise<BitbucketConnections> {
    await this.project(projectId);
    const value = await this.load();
    return this.describe(value.data, value.revision, projectId);
  }
  async resolve(projectId?: string): Promise<BitbucketCredential | null> {
    await this.project(projectId);
    const current = await this.load();
    const selected = this.describe(current.data, current.revision, projectId).selectedId;
    if (!selected) return this.ports.shared();
    const connection = current.data.connections.find(
      (entry) => entry.id === selected && matches(entry),
    );
    if (!connection)
      throw new BitbucketConnectionError(
        "unavailable",
        "The selected Bitbucket connection was removed. Choose a connection explicitly; Otto has not switched accounts.",
      );
    const raw = await (await this.ports.vault()).get(this.key(connection));
    if (!raw)
      throw new BitbucketConnectionError(
        "unavailable",
        "Reconnect the selected Bitbucket account. Its credential is unavailable in this host's keyring.",
      );
    let secret: z.infer<typeof Secret>;
    try {
      secret = Secret.parse(JSON.parse(raw));
    } catch {
      throw new BitbucketConnectionError(
        "unavailable",
        "Reconnect the selected Bitbucket account; its stored credential needs repair.",
      );
    }
    return {
      ...secret,
      revision: JSON.stringify([connection.id, connection.revision, current.revision]),
    };
  }
  write(
    expectedRevision: string,
    action: BitbucketConnectionAction,
    projectId?: string,
  ): Promise<BitbucketConnections> {
    const run = this.pending
      .catch(() => undefined)
      .then(() => this.mutate(expectedRevision, action, projectId));
    this.pending = run;
    return run;
  }
  private select(data: StoredConnections, connectionId: string | null, projectId?: string) {
    if (
      connectionId &&
      !data.connections.some((entry) => entry.id === connectionId && matches(entry))
    )
      throw new BitbucketConnectionError("validation", "Choose an existing Bitbucket connection.");
    const bindings = projectId ? (data.projects[projectId] ?? []) : data.defaults;
    const next = bindings.filter((entry) => !matches(entry));
    if (connectionId) next.push({ forge: "bitbucket-cloud", host: "bitbucket.org", connectionId });
    if (projectId) data.projects[projectId] = next;
    else data.defaults = next;
  }
  private async saveConnection(
    data: StoredConnections,
    action: Extract<BitbucketConnectionAction, { kind: "save" }>,
  ) {
    const old = action.id
      ? data.connections.find((entry) => entry.id === action.id && matches(entry))
      : undefined;
    if (action.id && !old)
      throw new BitbucketConnectionError(
        "conflict",
        "This connection was removed. Reload before saving.",
      );
    if (data.connections.length >= 100 && !old)
      throw new BitbucketConnectionError(
        "validation",
        "Remove an unused connection before adding another.",
      );
    const vault = await this.ports.vault();
    let apiToken: string;
    if (action.credential.kind === "replace") apiToken = action.credential.value.trim();
    else {
      if (!old)
        throw new BitbucketConnectionError(
          "validation",
          "Enter an API token for the new Bitbucket connection.",
        );
      let secret: z.infer<typeof Secret>;
      try {
        secret = Secret.parse(JSON.parse((await vault.get(this.key(old))) ?? ""));
      } catch {
        throw new BitbucketConnectionError(
          "unavailable",
          "Replace the unavailable API token before saving this connection.",
        );
      }
      if (secret.email !== action.email)
        throw new BitbucketConnectionError(
          "validation",
          "Replace the API token when changing the Atlassian email.",
        );
      apiToken = secret.apiToken;
    }
    if (!apiToken)
      throw new BitbucketConnectionError(
        "validation",
        "Enter a nonempty API token; a blank value never removes a credential.",
      );
    const saved = {
      ...old,
      id: old?.id ?? randomUUID(),
      revision: (old?.revision ?? 0) + 1,
      forge: "bitbucket-cloud",
      host: "bitbucket.org",
      method: "token",
      label: action.label,
      email: action.email,
      account: action.email,
    };
    await vault.put(this.key(saved), JSON.stringify({ email: action.email, apiToken }));
    data.connections = data.connections.filter((entry) => entry.id !== saved.id).concat(saved);
    return { old, saved, vault };
  }
  private async mutate(
    expectedRevision: string,
    action: BitbucketConnectionAction,
    projectId?: string,
  ) {
    await this.project(projectId);
    const current = await this.load();
    if (current.revision !== expectedRevision)
      throw new BitbucketConnectionError(
        "conflict",
        "Git connections changed. Reload before saving.",
      );
    const data = structuredClone(current.data);
    let saved: Awaited<ReturnType<BitbucketConnectionsStore["saveConnection"]>> | undefined;
    let retired: z.infer<typeof Connection> | undefined;
    if (action.kind === "save") {
      saved = await this.saveConnection(data, action);
      if (action.select) this.select(data, saved.saved.id, projectId);
      retired = saved.old;
    } else if (action.kind === "select") this.select(data, action.connectionId, projectId);
    else {
      retired = data.connections.find((entry) => entry.id === action.id && matches(entry));
      if (!retired)
        throw new BitbucketConnectionError(
          "conflict",
          "This connection was removed. Reload before continuing.",
        );
      data.connections = data.connections.filter((entry) => entry.id !== action.id);
    }
    try {
      // The registry CAS cannot see an external edit to the read-only 0.9
      // source. Recheck that import's complete revision after vault work.
      if ((await this.load()).revision !== current.revision)
        throw new IntegrationRegistryConflictError();
      await this.ports.registry.update({
        expectedRevision: current.registry.revision,
        integrationId: "bitbucket",
        value: data,
      });
    } catch (error) {
      if (error instanceof IntegrationRegistryConflictError) {
        if (saved) await saved.vault.delete(this.key(saved.saved));
        throw new BitbucketConnectionError(
          "conflict",
          "Git connections changed. Reload before saving.",
        );
      }
      throw new BitbucketConnectionError(
        "unavailable",
        "The connection save outcome is unknown. Reload before continuing; its credential was retained for recovery.",
      );
    }
    for (const listener of this.listeners) listener();
    if (retired) {
      try {
        await (await this.ports.vault()).delete(this.key(retired));
      } catch {
        throw new BitbucketConnectionError(
          "unavailable",
          "Connection settings were saved, but secure credential cleanup failed. Reload before continuing.",
        );
      }
    }
    return this.read(projectId);
  }
}
