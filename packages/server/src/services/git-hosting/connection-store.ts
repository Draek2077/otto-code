import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  ForgeConnectionSchema,
  ForgeConnectionBindingSchema,
  type ForgeConnection,
  type ForgeConnectionsAction,
  type ForgeConnectionsOverview,
} from "@otto-code/protocol/forge-connections";
import type { IntegrationAuthorizationService } from "../../server/integration-authorization/integration-authorization-service.js";
import { writeJsonFileAtomic } from "../../server/atomic-file.js";
import type { ForgeService } from "../forge-service.js";

const StoreSchema = z.object({
  connections: z.array(ForgeConnectionSchema),
  defaults: z.array(ForgeConnectionBindingSchema),
  projects: z.record(z.string(), z.array(ForgeConnectionBindingSchema)),
});
type Store = z.infer<typeof StoreSchema>;

export function normalizeForgeHost(host: string): string {
  const url = new URL(`https://${host.trim().toLowerCase()}`);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Enter a server hostname, without a URL path or credentials.");
  }
  return url.hostname === "ssh.github.com" ? "github.com" : url.host;
}

export interface ConnectionCredential {
  account: string;
  secret: string;
}
export interface ForgeConnectionStoreOptions {
  filePath: string;
  authorization: Pick<
    IntegrationAuthorizationService,
    "readSecret" | "saveSecret" | "deleteConnection"
  >;
  validate: (
    input: Extract<ForgeConnectionsAction, { kind: "save" }>,
  ) => Promise<ConnectionCredential>;
  createService: (
    connection: ForgeConnection,
    readCredential: () => Promise<string>,
  ) => ForgeService;
  resolveProjectId: (cwd: string) => Promise<string | null>;
  projectExists: (projectId: string) => Promise<boolean>;
}

/** Otto-owned connection selection; Paseo's provider adapters remain reusable. */
export class ForgeConnectionStore {
  private data: Store = { connections: [], defaults: [], projects: {} };
  private readonly services = new Map<string, ForgeService>();
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ForgeConnectionStoreOptions) {}

  async initialize(): Promise<void> {
    try {
      this.data = StoreSchema.parse(JSON.parse(await readFile(this.options.filePath, "utf8")));
    } catch (error) {
      // A corrupt store must not silently restore the ambient account.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  invalidate(forge: string, cwd: string): void {
    for (const connection of this.data.connections.filter((c) => c.forge === forge)) {
      this.services.get(`${connection.id}:${connection.revision}`)?.invalidate({ cwd });
    }
  }

  overview(projectId?: string): ForgeConnectionsOverview {
    return structuredClone({
      connections: this.data.connections,
      defaults: this.data.defaults,
      overrides: projectId ? (this.data.projects[projectId] ?? []) : [],
      projectId: projectId ?? null,
    });
  }

  forgeForHost(host: string): string | null {
    const matches = new Set(
      this.data.connections
        .filter((c) => new URL(`https://${c.host}`).hostname === host)
        .map((c) => c.forge),
    );
    return matches.size === 1 ? [...matches][0]! : null;
  }

  async forCwd(cwd: string, forge: string, host: string): Promise<ForgeService | null> {
    return this.resolve(forge, host, await this.options.resolveProjectId(cwd));
  }

  resolve(forge: string, host: string, projectId: string | null = null): ForgeService | null {
    host = normalizeForgeHost(host);
    const matches = (binding: { forge: string; host: string }) =>
      binding.forge === forge && binding.host === host;
    const selected =
      (projectId ? this.data.projects[projectId]?.find(matches) : undefined) ??
      this.data.defaults.find(matches);
    if (!selected) return null;
    const connection = this.data.connections.find((c) => c.id === selected.connectionId);
    if (!connection || !matches(connection)) {
      throw new Error(
        "The selected Git connection is unavailable. Choose a connection in Project Settings.",
      );
    }
    const key = `${connection.id}:${connection.revision}`;
    let service = this.services.get(key);
    if (!service) {
      service = this.options.createService(connection, async () => {
        // Retired adapters cannot execute queued work under a replaced identity.
        if (
          !this.data.connections.some(
            (c) => c.id === connection.id && c.revision === connection.revision,
          )
        ) {
          throw new Error("The Git connection changed. Retry the operation.");
        }
        const secret = await this.options.authorization.readSecret(this.secretKey(connection));
        if (!secret) throw new Error(`Reconnect ${connection.label} in Git connections.`);
        return secret;
      });
      this.services.set(key, service);
    }
    return service;
  }

  async manage(action: ForgeConnectionsAction): Promise<ForgeConnectionsOverview> {
    if (
      "projectId" in action &&
      action.projectId &&
      !(await this.options.projectExists(action.projectId))
    ) {
      throw new Error("Project not found on this host.");
    }
    if (action.kind === "list") return this.overview(action.projectId);
    const operation = this.queue.then(() => this.mutate(action));
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async mutate(
    action: Exclude<ForgeConnectionsAction, { kind: "list" }>,
  ): Promise<ForgeConnectionsOverview> {
    const next = structuredClone(this.data);
    let saved: ForgeConnection | undefined;
    if (action.kind === "save") {
      saved = await this.save(next, action);
      if (action.useForScope)
        this.select(next, {
          kind: "select",
          projectId: action.projectId,
          forge: saved.forge,
          host: saved.host,
          connectionId: saved.id,
        });
    } else if (action.kind === "select") {
      this.select(next, action);
    } else {
      const existing = next.connections.find((c) => c.id === action.id);
      if (!existing || existing.revision !== action.expectedRevision)
        throw new Error("This connection changed. Reload before removing it.");
      // Keep references to deleted connections: deletion must never silently switch accounts.
      next.connections = next.connections.filter((c) => c.id !== action.id);
    }
    try {
      await writeJsonFileAtomic(this.options.filePath, next);
    } catch (error) {
      if (saved)
        await this.options.authorization.deleteConnection(this.secretKey(saved)).catch(() => {});
      throw error;
    }
    const retired = this.data.connections.filter(
      (old) => !next.connections.some((c) => c.id === old.id && c.revision === old.revision),
    );
    this.data = next;
    for (const connection of retired) {
      const key = `${connection.id}:${connection.revision}`;
      this.services.get(key)?.dispose?.();
      this.services.delete(key);
      await this.options.authorization.deleteConnection(this.secretKey(connection)).catch(() => {});
    }
    for (const listener of this.listeners) listener();
    return this.overview("projectId" in action ? action.projectId : undefined);
  }

  private async save(
    next: Store,
    action: Extract<ForgeConnectionsAction, { kind: "save" }>,
  ): Promise<ForgeConnection> {
    const existing = action.id ? next.connections.find((c) => c.id === action.id) : undefined;
    if (action.id && (!existing || existing.revision !== action.expectedRevision)) {
      throw new Error("This connection changed. Reload before saving.");
    }
    const host = normalizeForgeHost(action.host);
    const label = action.label.trim();
    if (!label) throw new Error("Give the connection a name.");
    if (existing && (existing.forge !== action.forge || existing.host !== host)) {
      throw new Error("Create a new connection to change its provider or server.");
    }
    const credential = await this.options.validate({ ...action, host });
    if (existing && existing.account !== credential.account) {
      throw new Error(
        "This credential belongs to another account. Create a new connection for that account.",
      );
    }
    const connection: ForgeConnection = {
      id: existing?.id ?? randomUUID(),
      forge: action.forge,
      host,
      label,
      account: credential.account,
      method: action.method,
      revision: (existing?.revision ?? 0) + 1,
    };
    // Versioned vault keys let a failed metadata write leave the old connection usable.
    await this.options.authorization.saveSecret({
      ...this.secretKey(connection),
      value: credential.secret,
    });
    next.connections = next.connections.filter((c) => c.id !== connection.id).concat(connection);
    return connection;
  }

  private select(next: Store, action: Extract<ForgeConnectionsAction, { kind: "select" }>): void {
    const host = normalizeForgeHost(action.host);
    const matches = (binding: { forge: string; host: string }) =>
      binding.forge === action.forge && binding.host === host;
    if (
      action.connectionId &&
      !next.connections.some((c) => c.id === action.connectionId && matches(c))
    ) {
      throw new Error("Choose a connection for this provider and server.");
    }
    const bindings = (
      action.projectId ? (next.projects[action.projectId] ?? []) : next.defaults
    ).filter((b) => !matches(b));
    if (action.connectionId)
      bindings.push({ forge: action.forge, host, connectionId: action.connectionId });
    if (action.projectId) next.projects[action.projectId] = bindings;
    else next.defaults = bindings;
  }

  private secretKey(connection: ForgeConnection) {
    return { integrationId: "forge", connectionId: `${connection.id}:${connection.revision}` };
  }

  dispose(): void {
    for (const service of this.services.values()) service.dispose?.();
    this.services.clear();
    this.listeners.clear();
  }
}
