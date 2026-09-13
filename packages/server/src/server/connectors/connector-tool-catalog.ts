import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { googleConnectorForUrl, type ConnectorConfig } from "@otto-code/protocol/provider-config";
import {
  OpenAICompatMcpManager,
  resolveEnabledConnectors,
} from "../agent/providers/openai-compat-mcp.js";
import type { OttoToolDefinition } from "../agent/tools/types.js";
import type { ManagedProcessRegistry } from "../managed-processes/managed-processes.js";
import type { ConnectorAuthStore } from "./connector-oauth.js";
import { connectorToolName } from "./connector-tool-name.js";
import type { GoogleConnectorService } from "./google-connector-service.js";
import { connectorInputSchema } from "./connector-input-schema.js";
import { hostedConnectorVendor } from "@otto-code/protocol/connector-hosted-auth";
import { getHostedConnectorAuthorization } from "./hosted-connector-authorization.js";

interface CachedConnector {
  fingerprint: string;
  manager: OpenAICompatMcpManager;
  createdAt: number;
  lastUsedAt: number;
  inFlight: number;
}

function connectionFingerprint(connector: ConnectorConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        connector.server,
        connector.auth?.client,
        !!connector.auth?.tokens,
        connector.auth?.resourceUrl,
        connector.auth?.hosted,
        connector.auth?.authorizedAt,
      ]),
    )
    .digest("hex");
}

/** Daemon-owned MCP clients, reused across agent providers. No vendor credential
 * is serialized into a provider's launch config. Live grants are checked again
 * on every invocation, including calls from an already-advertised catalog.
 */
export class ConnectorToolCatalogService {
  private readonly cache = new Map<string, CachedConnector>();
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly idleTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly deps: {
      readConnectors(): readonly ConnectorConfig[];
      authStore: ConnectorAuthStore;
      logger: Logger;
      managedProcesses?: ManagedProcessRegistry;
      googleConnectors?: GoogleConnectorService;
    },
  ) {
    this.idleTimer = setInterval(() => {
      for (const [key, cached] of this.cache) {
        if (cached.inFlight === 0 && Date.now() - cached.lastUsedAt > 300_000) {
          this.cache.delete(key);
          void cached.manager
            .close()
            .catch(() => this.deps.logger.warn("Could not close an idle connector client"));
        }
      }
    }, 60_000);
    this.idleTimer.unref();
  }

  getTools(cwd: string): Promise<OttoToolDefinition[]> {
    const result = this.pending.then(() => this.buildTools(cwd));
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async buildTools(cwd: string): Promise<OttoToolDefinition[]> {
    if (this.closed) return [];
    const connectors = this.deps.readConnectors();
    const enabled = connectors.filter(
      (connector) =>
        connector.enabled !== false &&
        (!hostedConnectorVendor(connector) || connector.auth?.hosted?.connected === true) &&
        (connector.builtin ||
          connector.server.type === "stdio" ||
          !googleConnectorForUrl(connector.server.url) ||
          !!connector.auth?.tokens),
    );
    for (const [key, cached] of this.cache) {
      if (
        !enabled.some(
          (connector) =>
            key === this.key(connector, cwd) &&
            cached.fingerprint === connectionFingerprint(connector),
        )
      ) {
        // Other workspaces may still own a stdio entry; only prune entries for
        // this workspace or a connector removed/disabled on the host.
        if (
          key.includes("\0") &&
          !key.endsWith(`\0${cwd}`) &&
          enabled.some((connector) => key.startsWith(`${connector.id}\0`))
        )
          continue;
        this.cache.delete(key);
        await cached.manager.close();
      }
    }
    return (
      await Promise.all(
        enabled.map(async (connector): Promise<OttoToolDefinition[]> => {
          if (connector.builtin) {
            if (!this.deps.googleConnectors) return [];
            try {
              const tools = await this.deps.googleConnectors.getTools(connector);
              return tools.filter(
                (tool) =>
                  !connector.disabledTools?.some(
                    (name) => connectorToolName(connector.id, name) === tool.name,
                  ),
              );
            } catch {
              return [];
            }
          }
          const key = this.key(connector, cwd);
          let cached = this.cache.get(key);
          const maxAge = cached?.manager.failures.length ? 30_000 : 300_000;
          if (cached && cached.inFlight === 0 && Date.now() - cached.createdAt > maxAge) {
            this.cache.delete(key);
            await cached.manager.close();
            cached = undefined;
          }
          if (!cached) {
            // Do not filter individual tools in the transport snapshot. Their live
            // switches are applied below and at invocation, without reconnecting.
            const resolved = resolveEnabledConnectors(
              [{ ...connector, disabledTools: [] }],
              this.deps.authStore,
            );
            cached = {
              fingerprint: connectionFingerprint(connector),
              createdAt: Date.now(),
              lastUsedAt: Date.now(),
              inFlight: 0,
              manager: new OpenAICompatMcpManager({
                ...resolved,
                providerId: "connectors",
                cwd,
                logger: this.deps.logger,
                managedProcesses: this.deps.managedProcesses,
                additionalSecrets: () => {
                  const auth = this.deps.authStore.read(connector.id);
                  return [
                    ...(getHostedConnectorAuthorization()?.additionalSecrets(connector.id) ?? []),
                    auth?.tokens?.accessToken,
                    auth?.tokens?.refreshToken,
                    auth?.client?.clientSecret,
                  ].filter((value): value is string => !!value);
                },
              }),
            };
            this.cache.set(key, cached);
          }
          const current = cached;
          current.lastUsedAt = Date.now();
          await current.manager.ensureConnected();
          const definitions: OttoToolDefinition[] = [];
          for (const binding of current.manager.getToolBindings()) {
            if (connector.disabledTools?.includes(binding.toolName)) continue;
            try {
              const inputSchema = connectorInputSchema(binding.parameters);
              definitions.push({
                name: connectorToolName(connector.id, binding.toolName),
                title: `${connector.label}: ${binding.toolName}`,
                description: `[${connector.label}] ${binding.description}`,
                inputSchema,
                handler: async (input, context) => {
                  const isAllowed = () => {
                    const live = this.deps
                      .readConnectors()
                      .find((entry) => entry.id === connector.id);
                    return (
                      !this.closed &&
                      live &&
                      live.enabled !== false &&
                      !live.disabledTools?.includes(binding.toolName) &&
                      connectionFingerprint(live) === current.fingerprint
                    );
                  };
                  if (!isAllowed()) {
                    return {
                      isError: true,
                      content: [
                        {
                          type: "text",
                          text: "This connector or tool is no longer enabled. Refresh the tool catalog.",
                        },
                      ],
                    };
                  }
                  if (!this.cache.has(key)) await this.getTools(cwd);
                  const active = this.cache.get(key);
                  const activeBinding = active?.manager
                    .getToolBindings()
                    .find((tool) => tool.toolName === binding.toolName);
                  if (
                    !isAllowed() ||
                    !active ||
                    !activeBinding ||
                    active.fingerprint !== current.fingerprint
                  ) {
                    return {
                      isError: true,
                      content: [
                        {
                          type: "text",
                          text: "This connector's tools changed. Reload the chat to refresh its tool catalog.",
                        },
                      ],
                    };
                  }
                  active.lastUsedAt = Date.now();
                  active.inFlight += 1;
                  try {
                    const result = await active.manager.callTool(
                      activeBinding,
                      input as Record<string, unknown>,
                      { signal: context.signal },
                    );
                    return {
                      isError: result.isError,
                      content: [{ type: "text", text: result.output }],
                    };
                  } finally {
                    active.inFlight -= 1;
                    active.lastUsedAt = Date.now();
                  }
                },
              });
            } catch {
              this.deps.logger.warn(
                { connectorId: connector.id, toolName: binding.toolName },
                "Connector tool has an unsupported input schema",
              );
              return [];
            }
          }
          return definitions;
        }),
      )
    ).flat();
  }

  private key(connector: ConnectorConfig, cwd: string): string {
    return connector.server.type === "stdio" ? `${connector.id}\0${cwd}` : connector.id;
  }

  async reconcile(): Promise<void> {
    const live = this.deps.readConnectors();
    const closing: Promise<void>[] = [];
    for (const [key, cached] of this.cache) {
      const connector = live.find((entry) => entry.id === key.split("\0")[0]);
      if (
        !connector ||
        connector.enabled === false ||
        connectionFingerprint(connector) !== cached.fingerprint
      ) {
        this.cache.delete(key);
        closing.push(cached.manager.close());
      }
    }
    await Promise.all(closing);
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.idleTimer);
    const cached = [...this.cache.values()];
    this.cache.clear();
    await Promise.all(cached.map((entry) => entry.manager.close()));
  }
}
