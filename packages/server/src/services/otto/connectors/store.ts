import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ConnectorSummarySchema,
  ConnectorDiscoveredToolSchema,
  type ConnectorSetupInput,
  type ConnectorSummary,
} from "@getpaseo/plugin/otto/connectors";
import { IntegrationAuthorizationSecrets } from "../integrations/authorization-secrets.js";
import {
  IntegrationRegistryConflictError,
  type IntegrationRegistry,
  type IntegrationRegistrySnapshot,
} from "../integrations/registry.js";
import {
  ConnectorBundleSchema,
  ConnectorError,
  connectorServerSummary,
  connectorSetup,
  serializeConnectorBundle,
  type ConnectorBundle,
} from "./configuration.js";
import { legacyConnectorRecords } from "./legacy.js";

const Entry = ConnectorSummarySchema.extend({
  generation: z.string().min(1),
  fingerprint: z.string().min(1),
  verification: ConnectorSummarySchema.shape.verification.extend({
    tools: z.array(ConnectorDiscoveredToolSchema).max(1024),
  }),
}).passthrough();
const Namespace = z
  .object({ version: z.literal(1), entries: z.record(z.string(), Entry.nullable()) })
  .passthrough();
export type ConnectorEntry = z.infer<typeof Entry>;
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function conflict(): ConnectorError {
  return new ConnectorError("conflict", "Connectors changed. Reload before saving.");
}
function summary(entry: ConnectorEntry, includeTools = false): ConnectorSummary {
  return ConnectorSummarySchema.parse({
    id: entry.id,
    label: entry.label,
    catalogId: entry.catalogId,
    enabled: entry.enabled,
    disabledTools: entry.disabledTools,
    server: entry.server,
    authorization: entry.authorization,
    verification: {
      ...entry.verification,
      toolCount: entry.verification.tools.length,
      tools: includeTools
        ? entry.verification.tools.map(({ name, description, readOnly }) => ({
            name,
            description: description.slice(0, 2048),
            readOnly,
          }))
        : [],
    },
  });
}
export interface ConnectorStorePorts {
  registry: IntegrationRegistry;
  authorization: IntegrationAuthorizationSecrets;
  legacy(): Promise<string | null>;
}

/** Nonsecret connector settings and verification live separately from grants.
 * Preserved 0.9 records are read-only overlays until an explicit edit; tombstones
 * keep a removed legacy connector removed without rewriting the original file.
 */
export class ConnectorStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly ports: ConnectorStorePorts) {}
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.catch(() => undefined).then(operation);
    this.pending = result;
    return result;
  }
  private async load() {
    const persisted = await this.ports.registry.read();
    const raw = Object.hasOwn(persisted.connections, "connectors")
      ? persisted.connections.connectors
      : undefined;
    const namespace =
      raw === undefined ? { version: 1 as const, entries: {} } : Namespace.parse(raw);
    const legacyText = await this.ports.legacy();
    const legacyRoot = legacyText
      ? z
          .object({ connectors: z.array(z.unknown()).optional() })
          .passthrough()
          .parse(JSON.parse(legacyText))
      : {};
    const legacy = legacyConnectorRecords(legacyRoot.connectors ?? []);
    const entries = new Map([...legacy].map(([id, value]) => [id, value.entry]));
    for (const [id, entry] of Object.entries(namespace.entries)) {
      if (entry === null) entries.delete(id);
      else {
        if (id !== entry.id)
          throw new ConnectorError(
            "unavailable",
            "Connector identity metadata is invalid. It was left unchanged.",
          );
        entries.set(id, entry);
      }
    }
    if (entries.size > 1000)
      throw new ConnectorError(
        "unavailable",
        "This host exceeds the supported 1000 installed connectors. Its saved settings were left unchanged.",
      );
    return {
      persisted,
      namespace,
      legacy,
      entries,
      revision: hash(`${persisted.revision}\0${legacyText ?? ""}`),
    };
  }
  async read(
    focusId?: string,
  ): Promise<{ revision: string; connectors: ConnectorSummary[]; detail?: ConnectorSummary }> {
    const state = await this.load();
    const focused = focusId ? state.entries.get(focusId) : undefined;
    return {
      revision: state.revision,
      connectors: [...state.entries.values()].map((entry) => summary(entry)),
      ...(focused ? { detail: summary(focused, true) } : {}),
    };
  }
  private secretScope(entry: ConnectorEntry) {
    return {
      integrationId: "connectors",
      connectionId: `${hash(entry.id).slice(0, 32)}.${entry.generation}`,
    };
  }
  async open(
    id: string,
  ): Promise<{ revision: string; entry: ConnectorEntry; bundle: ConnectorBundle }> {
    const state = await this.load();
    const entry = state.entries.get(id);
    if (!entry) throw new ConnectorError("validation", "This connector is no longer installed.");
    if (entry.server.type === "unavailable")
      throw new ConnectorError(
        "unavailable",
        "Reconfigure this preserved connector before using it. Its original settings remain unchanged.",
      );
    const value = await this.ports.authorization.read(this.secretScope(entry));
    if (value.value === null && !Object.hasOwn(state.namespace.entries, id)) {
      const original = state.legacy.get(id);
      if (!original?.bundle)
        throw new ConnectorError(
          "unavailable",
          "Preserved connector configuration is unavailable.",
        );
      return { revision: state.revision, entry, bundle: original.bundle };
    }
    if (value.value === null)
      throw new ConnectorError(
        "unavailable",
        "This connector's secure configuration is unavailable. Reconfigure it on this host.",
      );
    return {
      revision: state.revision,
      entry,
      bundle: ConnectorBundleSchema.parse(JSON.parse(value.value)),
    };
  }
  private async publish(
    state: Awaited<ReturnType<ConnectorStore["load"]>>,
    id: string,
    entry: ConnectorEntry | null,
    admit?: () => boolean,
  ): Promise<IntegrationRegistrySnapshot> {
    if ((await this.load()).revision !== state.revision) throw conflict();
    if (admit && !admit()) throw conflict();
    try {
      return await this.ports.registry.update({
        expectedRevision: state.persisted.revision,
        integrationId: "connectors",
        value: { ...state.namespace, entries: { ...state.namespace.entries, [id]: entry } },
      });
    } catch (error) {
      if (error instanceof IntegrationRegistryConflictError) throw conflict();
      throw new ConnectorError(
        "uncertain",
        "The connector update outcome is unknown. Reload before further changes.",
      );
    }
  }
  save(input: {
    expectedRevision: string;
    id?: string;
    label: string;
    setup?: ConnectorSetupInput;
  }): Promise<string> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (state.revision !== input.expectedRevision) throw conflict();
      const id = input.id ?? randomUUID();
      const previous = state.entries.get(id);
      if (input.id && !previous)
        throw new ConnectorError("validation", "This connector is no longer installed.");
      if (!previous && state.entries.size >= 1000)
        throw new ConnectorError("validation", "Remove a connector before adding more than 1000.");
      if (!input.setup) {
        if (!previous) throw new ConnectorError("validation", "Choose a connector to add.");
        await this.publish(state, id, { ...previous, label: input.label });
        return id;
      }
      const prepared = connectorSetup(input.setup);
      const value = serializeConnectorBundle(prepared.bundle);
      const entry: ConnectorEntry = {
        id,
        label: input.label,
        catalogId: prepared.catalogId,
        generation: randomUUID(),
        fingerprint: hash(value),
        enabled: false,
        disabledTools: previous?.disabledTools ?? [],
        server: connectorServerSummary(prepared.bundle.server),
        authorization: {
          state: prepared.bundle.oauth ? "disconnected" : "not-required",
          account: null,
          scopes: [],
          message: null,
        },
        verification: {
          state: "unverified",
          checkedAt: null,
          fingerprint: null,
          message: null,
          tools: [],
        },
      };
      const scope = this.secretScope(entry);
      const secret = await this.ports.authorization.read(scope);
      await this.ports.authorization.replace({
        ...scope,
        expectedRevision: secret.revision,
        value,
      });
      try {
        await this.publish(state, id, entry);
      } catch (error) {
        // Only a proven metadata conflict permits retiring this unpublished generation.
        if (error instanceof ConnectorError && error.kind === "conflict") await this.retire(entry);
        throw error;
      }
      if (previous) await this.retire(previous);
      return id;
    });
  }
  async readBundleVersion(entry: ConnectorEntry) {
    return this.ports.authorization.read(this.secretScope(entry));
  }
  async writeBundle(
    entry: ConnectorEntry,
    expectedRevision: string,
    bundle: ConnectorBundle,
    admit?: () => boolean,
  ): Promise<string> {
    const current = await this.open(entry.id);
    if (current.entry.generation !== entry.generation) throw conflict();
    const accepted = await this.ports.authorization.replace({
      ...this.secretScope(entry),
      expectedRevision,
      value: serializeConnectorBundle(bundle),
      admit,
    });
    return accepted.revision;
  }
  update(input: {
    id: string;
    expectedRevision: string;
    patch: Partial<
      Pick<ConnectorEntry, "enabled" | "disabledTools" | "authorization" | "verification">
    >;
    admit?: () => boolean;
  }): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (state.revision !== input.expectedRevision) throw conflict();
      const entry = state.entries.get(input.id);
      if (!entry) throw new ConnectorError("validation", "This connector is no longer installed.");
      // A first explicit legacy edit materializes the exact original bundle in
      // the vault. Unknown legacy fields remain inside that daemon-only bundle.
      if (!Object.hasOwn(state.namespace.entries, input.id)) {
        const original = state.legacy.get(input.id)!;
        if (!original.bundle)
          throw new ConnectorError(
            "validation",
            "Reconfigure this preserved connector before enabling it.",
          );
        const scope = this.secretScope(entry);
        const secret = await this.ports.authorization.read(scope);
        if (secret.value === null)
          await this.ports.authorization.replace({
            ...scope,
            expectedRevision: secret.revision,
            value: serializeConnectorBundle(original.bundle),
          });
      }
      await this.publish(state, input.id, Entry.parse({ ...entry, ...input.patch }), input.admit);
    });
  }
  remove(id: string, expectedRevision: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (state.revision !== expectedRevision) throw conflict();
      const entry = state.entries.get(id);
      if (!entry) throw new ConnectorError("validation", "This connector is no longer installed.");
      await this.publish(state, id, null);
      await this.retire(entry);
    });
  }
  private async retire(entry: ConnectorEntry): Promise<void> {
    const scope = this.secretScope(entry);
    const current = await this.ports.authorization.read(scope);
    if (current.value !== null)
      await this.ports.authorization.replace({
        ...scope,
        expectedRevision: current.revision,
        value: null,
      });
  }
}
