import {
  authorizeConnector,
  readConnectors,
  writeConnectors,
  googleConnectorForConfig,
  type ConnectorAction,
  type ConnectorsSnapshot,
} from "@getpaseo/plugin/otto/connectors";
import type { PaseoToolDefinition } from "../../../server/agent/tools/types.js";
import { ConnectorError } from "./configuration.js";
import { ConnectorStore, type ConnectorStorePorts } from "./store.js";
import { ConnectorOAuthBroker } from "./oauth-broker.js";
import {
  GoogleOAuthSessions,
  loadGoogleOAuthRegistration,
  type GoogleOAuthRegistration,
} from "./google/oauth.js";
import { GoogleConnectorTools } from "./google/service.js";
import { HostedConnectorOAuth } from "./hosted-oauth.js";
import { hostedConnectorVendor } from "./hosted-protocol.js";
import {
  ConnectorRuntime,
  connectorToolFingerprint,
  type ConnectorRuntimePorts,
} from "./runtime.js";
import { connectorToolName } from "./tool-name.js";
import { connectorInputSchema } from "./input-schema.js";

interface ConnectorHostPorts extends ConnectorStorePorts {
  hostId: string;
  cwd: string;
  providers(): ConnectorsSnapshot["providers"];
  legacyCredential?(integrationId: string, connectionId: string): Promise<string | null>;
  legacyAccount?(integrationId: string, connectionId: string): Promise<string | null>;
  registration?(): Promise<GoogleOAuthRegistration | null>;
  fetcher?: typeof fetch;
  load?: ConnectorRuntimePorts["load"];
  warn?(message: string): void;
}
type Opened = Awaited<ReturnType<ConnectorStore["open"]>>;

/** One inert host boundary for Settings and every agent provider. OAuth authority
 * never leaves this service; reads return only safe configuration/tool summaries.
 */
export class ConnectorHost {
  readonly store: ConnectorStore;
  private readonly browser: ConnectorOAuthBroker;
  private readonly hosted: HostedConnectorOAuth;
  private readonly runtime: ConnectorRuntime;
  private readonly google: GoogleConnectorTools;
  private readonly shutdown = new AbortController();
  private readonly admissions = new Map<string, Promise<void>>();
  private readonly failedRefresh = new Map<string, number>();
  constructor(private readonly ports: ConnectorHostPorts) {
    this.store = new ConnectorStore(ports);
    const sessions = new GoogleOAuthSessions({
      registration: ports.registration ?? loadGoogleOAuthRegistration,
      legacyCredential: (id) =>
        ports.legacyCredential?.("google-connectors", id) ?? Promise.resolve(null),
      legacyAccount: (id) =>
        ports.legacyAccount?.("google-connectors", id) ?? Promise.resolve(null),
    });
    const settled = async (
      id: string,
      generation: string,
      outcome: { connected: true } | { connected: false; message: string },
      admit: () => boolean,
    ) => {
      const current = await this.store.open(id);
      if (current.entry.generation !== generation || !admit()) return;
      const status = outcome.connected ? await this.authorizationStatus(current) : null;
      await this.store.update({
        id,
        expectedRevision: current.revision,
        admit,
        patch: {
          authorization: {
            state: outcome.connected ? "connected" : "error",
            account: status?.account ?? null,
            scopes: status?.scopes ?? [],
            message: outcome.connected ? null : outcome.message,
          },
        },
      });
      if (outcome.connected && admit()) await this.verify(id, true, admit);
    };
    this.browser = new ConnectorOAuthBroker({
      store: this.store,
      settled,
      fetcher: ports.fetcher,
      session: (options) => sessions.open(options),
      callbackPortFor: (opened) => (googleConnectorForConfig(opened.bundle) ? 0 : undefined),
      callbackPathFor: (opened) =>
        googleConnectorForConfig(opened.bundle) ? "/integrations/google/callback" : undefined,
      warn: ports.warn,
    });
    this.hosted = new HostedConnectorOAuth({
      store: this.store,
      settled,
      fetcher: ports.fetcher,
      origin: process.env.OTTO_CONNECTOR_AUTH_URL,
      legacyCredential: (id) =>
        ports.legacyCredential?.("connector-hosted-oauth", id) ?? Promise.resolve(null),
      legacyAccount: (id) =>
        ports.legacyAccount?.("connector-hosted-oauth", id) ?? Promise.resolve(null),
      warn: ports.warn,
    });
    const authorization = {
      authorize: (opened: Opened, signal: AbortSignal) => this.authorize(opened, signal),
    };
    this.runtime = new ConnectorRuntime({
      store: this.store,
      authorize: authorization.authorize,
      load: ports.load,
      warn: ports.warn,
    });
    this.google = new GoogleConnectorTools({
      store: this.store,
      authorization,
      fetcher: ports.fetcher,
    });
  }
  private authorize(opened: Opened, signal: AbortSignal) {
    return hostedConnectorVendor(opened.bundle)
      ? this.hosted.authorize(opened, signal)
      : this.browser.authorize(opened, signal);
  }
  private authorizationStatus(opened: Opened) {
    return hostedConnectorVendor(opened.bundle)
      ? this.hosted.status(opened.entry.id)
      : this.browser.status(opened.entry.id);
  }
  private cancel(id: string) {
    this.browser.cancel(id);
    this.hosted.cancel(id);
  }
  async read(focusId?: string): Promise<ConnectorsSnapshot> {
    const saved = await this.store.read(focusId);
    const project = (row: ConnectorsSnapshot["connectors"][number]) => {
      if (
        row.authorization.state !== "pending" ||
        this.browser.isPending(row.id) ||
        this.hosted.isPending(row.id)
      )
        return row;
      return {
        ...row,
        authorization: {
          ...row.authorization,
          state: "error" as const,
          message: "Sign-in was interrupted. Connect again to start a fresh attempt.",
        },
      };
    };
    const detail = saved.detail ? project(saved.detail) : undefined;
    if (detail && saved.detail?.authorization.state !== "pending") {
      try {
        const opened = await this.store.open(detail.id);
        if (opened.bundle.oauth) {
          const status = await this.authorizationStatus(opened);
          let state: typeof detail.authorization.state = "disconnected";
          if (status.connected) state = "connected";
          else if (status.message) state = "error";
          detail.authorization = {
            state,
            account: status.account,
            scopes: status.scopes,
            message: status.message,
          };
        }
      } catch {
        detail.authorization = {
          ...detail.authorization,
          state: "error",
          message:
            "The host could not read this account's authorization. Its saved credentials were left unchanged.",
        };
      }
    }
    return {
      ...saved,
      connectors: saved.connectors.map(project),
      ...(detail ? { detail } : {}),
      providers: this.ports.providers(),
    };
  }
  private verify(id: string, enable: boolean, admit: () => boolean = () => true): Promise<void> {
    const existing = this.admissions.get(id);
    if (existing) return existing;
    const task = this.admit(id, enable, admit);
    this.admissions.set(id, task);
    void task
      .finally(() => {
        if (this.admissions.get(id) === task) this.admissions.delete(id);
      })
      .catch(() => undefined);
    return task;
  }
  private async admit(id: string, enable: boolean, admit: () => boolean): Promise<void> {
    const opened = await this.store.open(id);
    try {
      const signal = this.shutdown.signal;
      signal.throwIfAborted();
      const tools = googleConnectorForConfig(opened.bundle)
        ? await this.google.verify(id, signal)
        : await this.runtime.inspect(id, this.ports.cwd, signal, true);
      const current = await this.store.open(id);
      if (current.entry.generation !== opened.entry.generation || !admit()) return;
      this.failedRefresh.delete(id);
      await this.store.update({
        id,
        expectedRevision: current.revision,
        admit,
        patch: {
          enabled: enable || current.entry.enabled,
          verification: {
            state: "verified",
            checkedAt: new Date().toISOString(),
            fingerprint: current.entry.fingerprint,
            message: null,
            tools,
          },
        },
      });
    } catch (error) {
      if (this.shutdown.signal.aborted || !admit()) return;
      const current = await this.store.open(id);
      if (current.entry.generation !== opened.entry.generation) return;
      this.failedRefresh.set(id, Date.now());
      await this.store.update({
        id,
        expectedRevision: current.revision,
        admit,
        patch: {
          enabled: opened.entry.enabled && opened.entry.verification.state === "verified",
          verification: {
            ...current.entry.verification,
            state: opened.entry.verification.state === "verified" ? "verified" : "failed",
            checkedAt:
              opened.entry.verification.state === "verified"
                ? opened.entry.verification.checkedAt
                : new Date().toISOString(),
            message:
              error instanceof ConnectorError
                ? error.message
                : "The host could not verify this connector. Check its configuration and account access before trying again.",
          },
        },
      });
    }
  }
  async write(expectedRevision: string, action: ConnectorAction): Promise<ConnectorsSnapshot> {
    const snapshot = await this.store.read();
    if (snapshot.revision !== expectedRevision)
      throw new ConnectorError("conflict", "Connectors changed. Reload before saving.");
    if (action.kind === "add" || action.kind === "configure") {
      if (action.kind === "configure") this.cancel(action.id);
      const id = await this.store.save({
        expectedRevision,
        label: action.label,
        setup: action.setup,
        ...(action.kind === "configure" ? { id: action.id } : {}),
      });
      if (action.setup) await this.releaseClient(id);
      const opened = await this.store.open(id);
      if (action.setup && !opened.bundle.oauth) await this.verify(id, true);
      return this.read(id);
    }
    await this.apply(expectedRevision, action);
    if (
      action.kind === "remove" ||
      action.kind === "disconnect" ||
      (action.kind === "enable" && !action.enabled)
    )
      await this.releaseClient(action.id);
    if (action.kind === "remove") this.failedRefresh.delete(action.id);
    return this.read(action.kind === "remove" ? undefined : action.id);
  }
  private async releaseClient(id: string): Promise<void> {
    try {
      await this.runtime.invalidate(id);
    } catch {
      this.ports.warn?.("A retired connector client could not be closed.");
    }
  }
  private async apply(
    expectedRevision: string,
    action: Exclude<ConnectorAction, { kind: "add" | "configure" }>,
  ) {
    if (action.kind === "remove") {
      this.cancel(action.id);
      await this.store.remove(action.id, expectedRevision);
      return;
    }
    if (action.kind === "verify") {
      await this.verify(action.id, false);
      return;
    }
    if (action.kind === "disconnect") {
      const opened = await this.store.open(action.id);
      if (hostedConnectorVendor(opened.bundle)) await this.hosted.disconnect(action.id);
      else await this.browser.disconnect(action.id);
      const current = await this.store.open(action.id);
      await this.store.update({
        id: action.id,
        expectedRevision: current.revision,
        patch: {
          enabled: false,
          authorization: { state: "disconnected", account: null, scopes: [], message: null },
        },
      });
      return;
    }
    const opened = await this.store.open(action.id);
    if (action.kind === "enable") {
      if (
        action.enabled &&
        (opened.entry.verification.state !== "verified" ||
          opened.entry.verification.fingerprint !== opened.entry.fingerprint)
      )
        throw new ConnectorError("validation", "Verify this connector before enabling its tools.");
      await this.store.update({
        id: action.id,
        expectedRevision,
        patch: { enabled: action.enabled },
      });
      return;
    }
    const available = new Set(opened.entry.verification.tools.map((tool) => tool.name));
    if (
      action.disabledTools.some(
        (name) => !available.has(name) && !opened.entry.disabledTools.includes(name),
      )
    )
      throw new ConnectorError(
        "validation",
        "The tool catalog changed. Reload before editing tool access.",
      );
    await this.store.update({
      id: action.id,
      expectedRevision,
      patch: { disabledTools: [...new Set(action.disabledTools)] },
    });
  }
  async begin(expectedRevision: string, id: string) {
    const opened = await this.store.open(id);
    if (opened.revision !== expectedRevision)
      throw new ConnectorError("conflict", "Connectors changed. Reload before signing in.");
    this.cancel(id);
    const result = await (hostedConnectorVendor(opened.bundle)
      ? this.hosted.begin(opened)
      : this.browser.begin(opened));
    const current = await this.store.open(id);
    const pending = () => this.hosted.isPending(id) || this.browser.isPending(id);
    if (pending() && current.entry.generation === opened.entry.generation)
      await this.store.update({
        id,
        expectedRevision: current.revision,
        admit: pending,
        patch: {
          authorization: {
            ...current.entry.authorization,
            state: "pending",
            message: "Finish sign-in in your browser.",
          },
        },
      });
    return result;
  }
  async definitions(cwd: string): Promise<PaseoToolDefinition[]> {
    const snapshot = await this.store.read();
    const result: PaseoToolDefinition[] = [];
    for (const row of snapshot.connectors) {
      if (!row.enabled || row.server.type === "unavailable") continue;
      try {
        result.push(...(await this.connectorDefinitions(row.id, cwd)));
      } catch {
        this.ports.warn?.(
          "A connector is unavailable to this chat. Review it in host Settings > Connectors.",
        );
      }
    }
    return result;
  }
  private async connectorDefinitions(id: string, cwd: string): Promise<PaseoToolDefinition[]> {
    const opened = await this.store.open(id);
    const checked = Date.parse(opened.entry.verification.checkedAt ?? "");
    const retryAt = (this.failedRefresh.get(id) ?? 0) + 30000;
    if (
      Date.now() >= retryAt &&
      (opened.entry.verification.state !== "verified" ||
        !Number.isFinite(checked) ||
        Date.now() - checked > 300000)
    ) {
      await this.verify(id, false);
      const verified = await this.store.open(id);
      if (!verified.entry.enabled || verified.entry.verification.state !== "verified") return [];
    }
    const current = await this.store.open(id);
    if (googleConnectorForConfig(current.bundle))
      return (await this.google.definitions(id)).filter(
        (tool) => !current.entry.disabledTools.includes(tool.originalName),
      );
    return current.entry.verification.tools
      .filter((tool) => !current.entry.disabledTools.includes(tool.name))
      .map((tool) => ({
        name: connectorToolName(id, tool.name),
        title: `${current.entry.label}: ${tool.name}`,
        annotations: { readOnlyHint: tool.readOnly },
        description: `[${current.entry.label}] ${tool.description}`,
        inputSchema: connectorInputSchema(tool.inputSchema),
        handler: async (input, context) => {
          try {
            return await this.runtime.call({
              id,
              cwd,
              name: tool.name,
              schemaFingerprint: connectorToolFingerprint(tool),
              arguments: input,
              signal: context.signal,
            });
          } catch (error) {
            if (context.signal?.aborted) throw error;
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text:
                    error instanceof ConnectorError
                      ? error.message
                      : "This connector is unavailable. Review its host settings before repeating the operation.",
                },
              ],
            };
          }
        },
      }));
  }
  invoke(method: string, value: unknown): Promise<unknown> | undefined {
    if (method === readConnectors.name) {
      const input = readConnectors.input.parse(value);
      return this.safe(input.hostId, () => this.read(input.focusId));
    }
    if (method === writeConnectors.name) {
      const input = writeConnectors.input.parse(value);
      return this.safe(input.hostId, () => this.write(input.expectedRevision, input.action));
    }
    if (method === authorizeConnector.name) {
      const input = authorizeConnector.input.parse(value);
      return this.safe(input.hostId, () => this.begin(input.expectedRevision, input.id));
    }
    return undefined;
  }
  private async safe<T>(hostId: string, operation: () => Promise<T>) {
    try {
      if (hostId !== this.ports.hostId)
        throw new ConnectorError("validation", "Choose this connector's owning host.");
      return { ok: true, value: await operation() };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof ConnectorError
            ? { kind: error.kind, message: error.message }
            : {
                kind: "unavailable",
                message:
                  "The host could not access connector settings or secure credential storage. Reload before continuing.",
              },
      };
    }
  }
  async close(): Promise<void> {
    this.shutdown.abort();
    await Promise.allSettled([this.browser.close(), this.hosted.close(), this.runtime.close()]);
    await Promise.allSettled(this.admissions.values());
  }
}
