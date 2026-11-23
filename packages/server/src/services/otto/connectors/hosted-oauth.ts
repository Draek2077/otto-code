import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { ConnectorTransport } from "@getpaseo/plugin/otto/connectors";
import {
  ConnectorBundleSchema,
  ConnectorError,
  disconnectedConnectorBundle,
} from "./configuration.js";
import { ConnectorStore } from "./store.js";
import {
  HostedAuthorizationProtocol,
  HostedCredential,
  HostedPending,
  HostedState,
  HostedTokens,
  hostedConnectorVendor,
} from "./hosted-protocol.js";
import { connectorAuthorizationFetch } from "./oauth-session.js";

type Opened = Awaited<ReturnType<ConnectorStore["open"]>>;
interface HostedPorts {
  store: Pick<ConnectorStore, "open" | "readBundleVersion" | "writeBundle">;
  settled(
    id: string,
    generation: string,
    outcome: { connected: true } | { connected: false; message: string },
    admit: () => boolean,
  ): Promise<void>;
  origin?: string;
  fetcher?: typeof fetch;
  legacyCredential?(id: string): Promise<string | null>;
  legacyAccount?(id: string): Promise<string | null>;
  pollMs?: number;
  now?: () => number;
  warn?(message: string): void;
}

/** Hosted Box/HubSpot consent works across devices. No browser callback code or
 * grant is forwarded through Otto WebSocket; collection is daemon-to-service HTTPS.
 */
export class HostedConnectorOAuth {
  private readonly protocol: HostedAuthorizationProtocol;
  private readonly generations = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly attempts = new Map<string, AbortController>();
  private readonly completions = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private readonly now: () => number;
  private closed = false;
  constructor(private readonly ports: HostedPorts) {
    this.protocol = new HostedAuthorizationProtocol(ports.origin, ports.fetcher);
    this.now = ports.now ?? Date.now;
  }
  private serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.queues.set(id, result);
    void result
      .finally(() => {
        if (this.queues.get(id) === result) this.queues.delete(id);
      })
      .catch(() => undefined);
    return result;
  }
  private async read(id: string) {
    const opened = await this.ports.store.open(id);
    const version = await this.ports.store.readBundleVersion(opened.entry);
    const bundle =
      version.value === null
        ? opened.bundle
        : ConnectorBundleSchema.parse(JSON.parse(version.value));
    let state: HostedState | null = null;
    if (
      bundle.authorization?.kind === "hosted-oauth-v1" ||
      bundle.authorization?.kind === "hosted-pending-v1"
    )
      state = HostedState.parse(bundle.authorization);
    else if (
      bundle.authorization?.kind !== "disconnected" &&
      bundle.legacy &&
      hostedConnectorVendor(bundle)
    ) {
      // COMPAT(hosted09Grant): v0.10.0, remove after 2027-04-30. The owning host
      // may read only this preserved connection's connector-hosted-oauth tuple.
      const original = await this.ports.legacyCredential?.(id);
      if (original) {
        const old = z
          .object({
            version: z.literal(1),
            origin: z.string(),
            vendorId: z.enum(["box", "hubspot"]),
            resourceUrl: z.string(),
            grantId: z.string(),
            proof: z.string(),
            tokens: HostedTokens,
          })
          .parse(JSON.parse(original));
        state = HostedCredential.parse({
          ...old,
          kind: "hosted-oauth-v1",
          account: (await this.ports.legacyAccount?.(id)) ?? null,
        });
      }
    }
    if (
      state &&
      (bundle.server.type !== "http" ||
        state.vendorId !== hostedConnectorVendor(bundle) ||
        state.resourceUrl !== bundle.server.url ||
        state.origin !== this.protocol.origin)
    )
      throw new ConnectorError(
        "authorization",
        "The saved sign-in belongs to a different endpoint or authentication service. Restore its original host configuration before disconnecting.",
      );
    return { opened, bundle, revision: version.revision, state };
  }
  private admitted(id: string, attempt: string): boolean {
    return !this.closed && this.generations.get(id) === attempt;
  }
  private async save(
    current: Awaited<ReturnType<HostedConnectorOAuth["read"]>>,
    state: HostedState | null,
    attempt: string,
  ) {
    if (!this.admitted(current.opened.entry.id, attempt))
      throw new ConnectorError("conflict", "This hosted sign-in was superseded.");
    const bundle = state
      ? { ...current.bundle, authorization: state }
      : disconnectedConnectorBundle(current.bundle);
    const revision = await this.ports.store.writeBundle(
      current.opened.entry,
      current.revision,
      bundle,
      () => this.admitted(current.opened.entry.id, attempt),
    );
    return { ...current, bundle, revision, state };
  }
  begin(opened: Opened): Promise<{ authorizationUrl: string; callback: "hosted" }> {
    this.cancel(opened.entry.id);
    const attempt = randomUUID();
    this.generations.set(opened.entry.id, attempt);
    return this.serial(opened.entry.id, async () => {
      if (!this.admitted(opened.entry.id, attempt))
        throw new ConnectorError("conflict", "This hosted sign-in is no longer active.");
      let current = await this.read(opened.entry.id);
      if (current.opened.entry.generation !== opened.entry.generation)
        throw new ConnectorError("conflict", "The connector changed before sign-in.");
      const vendorId = hostedConnectorVendor(current.bundle);
      if (!vendorId || current.bundle.server.type !== "http")
        throw new ConnectorError("validation", "Choose a supported hosted connector.");
      const resourceUrl = current.bundle.server.url;
      if (current.state) {
        await this.revoke(current.state);
        current = await this.save(current, null, attempt);
      }
      const proof = randomBytes(32).toString("base64url");
      const start = z
        .object({ grantId: z.string().regex(/^[a-f0-9]{64}$/), authorizationUrl: z.string().url() })
        .parse(
          await this.protocol.post(
            "/v1/grants",
            { vendorId, proofHash: createHash("sha256").update(proof).digest("base64url") },
            undefined,
            this.shutdown.signal,
          ),
        );
      if (start.authorizationUrl !== `${this.protocol.origin}/v1/grants/${start.grantId}/authorize`)
        throw new ConnectorError(
          "vendor",
          "The authentication service returned an unexpected sign-in address.",
        );
      const pending = HostedPending.parse({
        kind: "hosted-pending-v1",
        origin: this.protocol.origin,
        vendorId,
        resourceUrl,
        grantId: start.grantId,
        proof,
        expiresAt: this.now() + 300000,
      });
      try {
        current = await this.save(current, pending, attempt);
      } catch (error) {
        try {
          await this.revoke(pending);
        } catch {
          this.ports.warn?.("An unadmitted hosted sign-in grant could not be retired.");
        }
        throw error;
      }
      if (!this.admitted(opened.entry.id, attempt))
        throw new ConnectorError(
          "conflict",
          "This hosted sign-in was replaced before consent started.",
        );
      const controller = new AbortController();
      this.attempts.set(opened.entry.id, controller);
      const completion = this.poll(current, pending, attempt, controller);
      this.completions.add(completion);
      void completion
        .finally(() => {
          this.completions.delete(completion);
        })
        .catch(() =>
          this.ports.warn?.("Hosted connector sign-in completion could not be recorded."),
        );
      return { authorizationUrl: start.authorizationUrl, callback: "hosted" as const };
    });
  }
  private async poll(
    current: Awaited<ReturnType<HostedConnectorOAuth["read"]>>,
    pending: z.infer<typeof HostedPending>,
    attempt: string,
    controller: AbortController,
  ): Promise<void> {
    const id = current.opened.entry.id;
    try {
      while (this.now() < pending.expiresAt) {
        await delay(this.ports.pollMs ?? 2500, undefined, { signal: controller.signal });
        if (!this.admitted(id, attempt)) return;
        const response = await this.protocol.post(
          `/v1/grants/${pending.grantId}/collect`,
          {},
          pending.proof,
          controller.signal,
        );
        if (response.status === "pending") continue;
        const tokens = HostedTokens.parse(response.tokens);
        const account = await this.account(pending.vendorId, tokens.accessToken, controller.signal);
        await this.serial(id, async () => {
          const accepted = HostedCredential.parse({
            ...pending,
            kind: "hosted-oauth-v1",
            tokens,
            account,
          });
          await this.save(current, accepted, attempt);
          return undefined;
        });
        // Publication callbacks may initialize the MCP client, which needs this
        // same per-connection authorization lane. Release it before admission.
        await this.ports.settled(id, current.opened.entry.generation, { connected: true }, () =>
          this.admitted(id, attempt),
        );
        return;
      }
      throw new ConnectorError("authorization", "Hosted sign-in timed out.");
    } catch {
      if (this.admitted(id, attempt)) {
        try {
          await this.ports.settled(
            id,
            current.opened.entry.generation,
            {
              connected: false,
              message:
                "Sign-in did not finish. Reload before reconnecting; review vendor account access if consent was approved.",
            },
            () => this.admitted(id, attempt),
          );
        } catch {
          this.ports.warn?.("Hosted sign-in failure could not be recorded.");
        }
      }
    } finally {
      if (this.attempts.get(id) === controller) this.attempts.delete(id);
    }
  }
  authorize(
    opened: Opened,
    signal: AbortSignal,
  ): Promise<{ server: ConnectorTransport; revision: string }> {
    return this.serial(opened.entry.id, async () => {
      signal.throwIfAborted();
      const attempt = this.generations.get(opened.entry.id) ?? randomUUID();
      this.generations.set(opened.entry.id, attempt);
      let current = await this.read(opened.entry.id);
      if (
        current.opened.entry.generation !== opened.entry.generation ||
        !current.state ||
        current.state.kind !== "hosted-oauth-v1" ||
        current.bundle.server.type !== "http"
      )
        throw new ConnectorError(
          "authorization",
          "Finish signing in to this connector before using its tools.",
        );
      let credential = current.state;
      if (credential.refreshBlocked)
        throw new ConnectorError(
          "authorization",
          "Hosted authorization renewal did not finish. Review account access before reconnecting.",
        );
      if (credential.tokens.expiresAt <= this.now() + 60000) {
        current = await this.save(current, { ...credential, refreshBlocked: true }, attempt);
        const response = await this.protocol.post(
          `/v1/grants/${credential.grantId}/refresh`,
          { refreshToken: credential.tokens.refreshToken },
          credential.proof,
          AbortSignal.any([signal, this.shutdown.signal]),
        );
        credential = {
          ...credential,
          tokens: HostedTokens.parse(response.tokens),
          refreshBlocked: false,
        };
        current = await this.save(current, credential, attempt);
      }
      const server = current.bundle.server;
      if (server.type !== "http" || !this.admitted(opened.entry.id, attempt))
        throw new ConnectorError("conflict", "This hosted connection changed before execution.");
      return {
        server: {
          ...server,
          headers: { ...server.headers, Authorization: `Bearer ${credential.tokens.accessToken}` },
        },
        revision: current.revision,
      };
    });
  }
  disconnect(id: string): Promise<void> {
    this.cancel(id);
    const attempt = this.generations.get(id)!;
    return this.serial(id, async () => {
      const current = await this.read(id);
      if (current.state) await this.revoke(current.state);
      await this.save(current, null, attempt);
    });
  }
  private revoke(state: HostedState): Promise<Record<string, unknown>> {
    return this.protocol.post(
      `/v1/grants/${state.grantId}/revoke`,
      state.kind === "hosted-oauth-v1" ? { refreshToken: state.tokens.refreshToken } : {},
      state.proof,
      this.shutdown.signal,
    );
  }
  private async account(
    vendor: string,
    token: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    if (vendor !== "box") return null;
    try {
      const response = await connectorAuthorizationFetch(this.ports.fetcher, signal)(
        "https://api.box.com/2.0/users/me?fields=id,login,name",
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > 16384) return null;
      return z.object({ login: z.string().max(320) }).parse(JSON.parse(text)).login;
    } catch {
      return null;
    }
  }
  async status(id: string) {
    const current = await this.read(id);
    const state = current.state;
    if (!state) return { connected: false, account: null, scopes: [], message: null };
    if (state.kind === "hosted-pending-v1")
      return {
        connected: false,
        account: null,
        scopes: [],
        message: this.attempts.has(id)
          ? "Finish sign-in in your browser."
          : "Sign-in was interrupted. Reconnect to start a fresh attempt.",
      };
    return {
      connected: !state.refreshBlocked,
      account: state.account,
      scopes: state.tokens.scopes,
      message: state.refreshBlocked
        ? "Authorization renewal did not finish. Review account access before reconnecting."
        : null,
    };
  }
  isPending(id: string): boolean {
    return this.attempts.has(id);
  }
  cancel(id: string): void {
    this.generations.set(id, randomUUID());
    this.attempts.get(id)?.abort();
    this.attempts.delete(id);
  }
  async close(): Promise<void> {
    this.closed = true;
    this.shutdown.abort();
    for (const id of this.attempts.keys()) this.cancel(id);
    await Promise.allSettled(this.completions);
    await Promise.allSettled(this.queues.values());
  }
}
