/** Daemon composition. All Brain network and local filesystem effects stay on this host. */
import path from "node:path";
import {
  createBrainController,
  BrainStartup,
  BrainConnectionError,
  BrainOwnerSettings,
  OwnerSettingsError,
  BrainHttpResponseError,
  type BrainController,
  readPidFile,
  isProcessAlive,
} from "@getpaseo/brain/host";
import { resolveBrainPaths, readBrainConfig } from "@getpaseo/brain/config";
import { listAllRuntimes, resolveRuntime } from "@getpaseo/brain/runtime";
import { scanModels } from "@getpaseo/brain/models";
import {
  BrainStatusSchema,
  BrainConnectionSaveSchema,
  BrainStatusWaitSchema,
  BrainStatusReleaseSchema,
  BrainLifecycleSchema,
  BrainQuerySchema,
  BrainActionSchema,
  BrainOwnerReadSchema,
  BrainNetworkDiscoverySchema,
  type BrainOwnerRead,
  type BrainStatus,
} from "@getpaseo/protocol/otto/brain";
import { z } from "zod";
import { brainActionRequest, brainQueryRequest } from "./routes.js";
import { BrainStatusLeases } from "./status-leases.js";
import { decodeBrainQuery, decodeBrainAction } from "./library-output.js";
import { BrainRequestLeases } from "./request-leases.js";
import { BrainDaemonTui } from "./tui.js";
import { BrainCommandRequestSchema, brainCommandHttpRequest } from "@getpaseo/brain/cli-target";

const OwnerRead = z.object({ ownerId: z.string().min(1).max(256) }).strict();
const CommandRequest = z
  .object({
    connectionRevision: z.string().min(1).max(1024),
    instanceId: z.string().min(1).max(1024),
    requestId: z.string().uuid(),
    request: z.unknown(),
  })
  .strict();
const SafeOwnerError = z
  .object({
    error: z
      .object({
        kind: z.enum(["validation", "conflict", "unavailable", "unknown"]),
        message: z.string().max(512),
      })
      .strict(),
  })
  .strict();
const METHODS = new Set([
  "brain.tui.start",
  "brain.tui.read",
  "brain.tui.action",
  "brain.cli.request",
  "brain.bootstrap",
  "brain.connection.read",
  "brain.connection.save",
  "brain.owner.read",
  "brain.owner.save",
  "brain.owner.generate_key",
  "brain.owner.discover_network",
  "brain.lifecycle",
  "brain.status.wait",
  "brain.status.release",
  "brain.query",
  "brain.resources.release",
  "brain.action",
]);

export class BrainDaemonService {
  readonly controller: BrainController<BrainStatus>;
  private readonly leases: BrainStatusLeases<BrainStatus>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly reads = new BrainRequestLeases();
  private readonly startup: BrainStartup;
  private readonly tui: BrainDaemonTui;
  constructor(home: string, env: NodeJS.ProcessEnv = process.env) {
    this.env = { ...env, OTTO_HOME: home, PASEO_HOME: home };
    this.controller = createBrainController({
      connectionFile: path.join(home, "otto-config.json"),
      env: this.env,
      decodeStatus: (value) => BrainStatusSchema.parse(value),
    });
    this.leases = new BrainStatusLeases(this.controller.status);
    this.tui = new BrainDaemonTui(this.controller, this.reads, () => this.localRunning());
    this.startup = new BrainStartup({
      connection: () => this.controller.readConnection().config,
      isRunning: () => this.localRunning(),
      start: (signal) => this.controller.performLocalAction("start", null, signal),
    });
  }
  applyStartupIntent() {
    return this.startup.apply();
  }
  invoke(method: string, input: unknown, clientId: string): Promise<unknown> | undefined {
    if (!METHODS.has(method)) return undefined;
    return this.dispatch(method, input, clientId).then(
      (value) => ({ ok: true, value }),
      (error) => this.failure(error),
    );
  }
  private failure(error: unknown) {
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: { kind: "validation", message: "Check the Brain request fields" },
      };
    if (error instanceof BrainConnectionError || error instanceof OwnerSettingsError)
      return { ok: false, error: { kind: error.kind, message: error.message } };
    if (error instanceof BrainHttpResponseError) {
      const classified = SafeOwnerError.safeParse(error.response);
      if (classified.success)
        return {
          ok: false,
          error: {
            kind: classified.data.error.kind,
            message:
              classified.data.error.kind === "validation"
                ? "The Brain owner rejected these settings. Correct the fields before saving again."
                : "The Brain owner could not confirm this write. Reload before saving again.",
          },
        };
    }
    return {
      ok: false,
      error: {
        kind: "unknown",
        message: "The Brain host request could not complete. Reload to check its current state.",
      },
    };
  }
  private async dispatch(method: string, input: unknown, clientId: string): Promise<unknown> {
    switch (method) {
      case "brain.cli.request":
        return this.commandRequest(input, clientId);
      case "brain.tui.start":
      case "brain.tui.read":
      case "brain.tui.action":
        return this.tui.invoke(method, input, clientId);
      case "brain.bootstrap":
        return this.bootstrap();
      case "brain.connection.read":
        return this.controller.readConnection();
      case "brain.connection.save":
        return this.controller.saveConnection(BrainConnectionSaveSchema.parse(input));
      case "brain.status.wait": {
        const request = BrainStatusWaitSchema.parse(input);
        return {
          ...(await this.leases.wait(clientId, request.leaseId, request.cursor, request)),
          controlRevision: this.controller.peekConnection().revision,
        };
      }
      case "brain.status.release": {
        this.leases.release(clientId, BrainStatusReleaseSchema.parse(input).leaseId);
        return { released: true };
      }
      case "brain.lifecycle": {
        const request = BrainLifecycleSchema.parse(input);
        await this.controller.performLifecycleAction(request.action, request.modelId);
        return { accepted: true };
      }
      case "brain.query":
        return this.readQuery(input, clientId);
      case "brain.resources.release": {
        const request = z.object({ requestId: z.string().uuid() }).strict().parse(input);
        this.reads.release(clientId, request.requestId);
        return { released: true };
      }
      case "brain.action":
        return this.performAction(input);
      default:
        return this.ownerOperation(method, input);
    }
  }
  private async commandRequest(input: unknown, clientId: string): Promise<unknown> {
    const origin = CommandRequest.parse(input);
    const call = BrainCommandRequestSchema.safeParse(origin.request);
    if (!call.success)
      throw new BrainConnectionError("validation", "Check the Brain command fields.");
    const operation = brainCommandHttpRequest(call.data);
    return this.reads.run(clientId, origin.requestId, (signal) =>
      this.controller.withOwner(
        origin,
        (request) => request(operation.route, operation.body),
        signal,
      ),
    );
  }
  private async readQuery(input: unknown, clientId: string) {
    const query = BrainQuerySchema.parse(input);
    const request = brainQueryRequest(query);
    const read = (signal?: AbortSignal) =>
      this.controller.request(request.route, request.body, signal);
    const result =
      query.resource === "resources"
        ? await this.reads.run(clientId, query.requestId, read)
        : await read();
    return decodeBrainQuery(query, result);
  }
  private async performAction(input: unknown) {
    const action = BrainActionSchema.parse(input);
    const request = brainActionRequest(action);
    return decodeBrainAction(action, await this.controller.request(request.route, request.body));
  }
  private localOwner() {
    const config = readBrainConfig(this.env);
    return new BrainOwnerSettings(
      { config, paths: resolveBrainPaths(this.env), env: this.env, instanceId: "offline-metadata" },
      {
        runtimes: () => listAllRuntimes(this.env),
        resolve: (current) => resolveRuntime(current, this.env),
        changed: () => this.controller.status.invalidate(),
        models: () =>
          scanModels(config, this.env).map((model) => ({ id: model.id, label: model.displayName })),
      },
    );
  }
  private localRunning(): boolean {
    const record = readPidFile(this.env);
    return Boolean(record && isProcessAlive(record.pid));
  }
  private async bootstrap() {
    const connection = this.controller.readConnection();
    let owner: unknown = null;
    let ownerError: string | null = null;
    try {
      const raw =
        connection.config.mode === "local" && !this.localRunning()
          ? this.localOwner().read()
          : await this.controller.request("/__host/settings");
      owner = this.decodeOwner(raw);
    } catch {
      ownerError =
        "The Brain owner's settings could not be read. Check its connection and access key.";
    }
    return {
      connection,
      owner,
      ownerError,
      localRunning: connection.config.mode === "local" && this.localRunning(),
      endpoint: this.endpoint(),
    };
  }
  private endpoint(): string | null {
    const connection = this.controller.peekConnection().config;
    if (connection.mode === "local" && !this.localRunning()) return null;
    const record = connection.mode === "local" ? readPidFile(this.env) : connection.remote;
    if (!record) return null;
    const host = "displayHost" in record && record.displayHost ? record.displayHost : record.host;
    const address = host.includes(":") ? `[${host}]` : host;
    return `${record.secure ? "https" : "http"}://${address}:${record.port}`;
  }
  private decodeOwner(raw: unknown): BrainOwnerRead {
    const parsed = BrainOwnerReadSchema.safeParse(raw);
    if (!parsed.success)
      throw new BrainConnectionError(
        "unknown",
        "The Brain owner returned unsupported settings. Update the Brain host and reload before saving.",
      );
    return parsed.data;
  }
  private decodeOwnerWrite(method: string, raw: unknown) {
    if (method !== "brain.owner.generate_key") return this.decodeOwner(raw);
    const generated = z
      .object({ owner: z.unknown(), secret: z.string().min(1).max(16384) })
      .safeParse(raw);
    if (!generated.success)
      throw new BrainConnectionError(
        "unknown",
        "Reload the Brain owner's settings to check whether key generation completed.",
      );
    return { owner: this.decodeOwner(generated.data.owner), secret: generated.data.secret };
  }
  private async ownerOperation(method: string, input: unknown) {
    if (method === "brain.owner.discover_network") return this.discoverNetwork(input);
    if (this.controller.connection.resolve().mode === "remote" || this.localRunning()) {
      const route =
        method === "brain.owner.generate_key" ? "/__host/settings/access-key" : "/__host/settings";
      if (method === "brain.owner.read") {
        const ownerId = OwnerRead.parse(input).ownerId;
        const result = await this.controller.request(route);
        const identity = this.decodeOwner(result);
        if (identity.ownerId !== ownerId)
          throw new BrainConnectionError(
            "conflict",
            "The Brain owner changed; reload its settings",
          );
        return identity;
      }
      return this.decodeOwnerWrite(method, await this.controller.request(route, input));
    }
    const owner = this.localOwner();
    if (method === "brain.owner.read") {
      if (OwnerRead.parse(input).ownerId !== owner.ownerId)
        throw new BrainConnectionError("conflict", "The Brain owner changed; reload its settings");
      return this.decodeOwner(owner.read());
    }
    const result =
      method === "brain.owner.generate_key" ? owner.generateAccessKey(input) : owner.save(input);
    return this.decodeOwnerWrite(method, result);
  }
  private async discoverNetwork(input: unknown) {
    const request = OwnerRead.parse(input);
    const raw =
      this.controller.connection.resolve().mode === "remote" || this.localRunning()
        ? await this.controller.request("/__host/settings/discover-network", request)
        : await this.localOwner().discoverNetwork(request, AbortSignal.timeout(5000));
    const parsed = BrainNetworkDiscoverySchema.safeParse(raw);
    if (!parsed.success || parsed.data.ownerId !== request.ownerId)
      throw new BrainConnectionError(
        "unknown",
        "The network discovery response did not match the selected Brain owner",
      );
    return parsed.data;
  }
  releaseClient(clientId: string): void {
    this.leases.releaseClient(clientId);
    this.reads.releaseClient(clientId);
  }
  async close(): Promise<void> {
    this.leases.close();
    this.reads.close();
    await this.controller.close();
  }
}
