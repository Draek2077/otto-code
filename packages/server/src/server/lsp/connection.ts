import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { Logger } from "pino";
import {
  CancellationTokenSource,
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node.js";
import { z } from "zod";
import { toFileUri } from "./uri.js";

/**
 * One live language server: the spawned process, the JSON-RPC channel to it, and
 * the handshake. Owns nothing above itself — which server to run and when to run
 * it belong to the registry and the pool.
 *
 * Two rules from the charter's risk list are structural here, not policy above:
 * a server that misses its initialize deadline is killed and reported rather than
 * awaited, and every request carries a timeout. A hung language server must never
 * become a hung daemon.
 */

/**
 * Providers are declared rather than left to the loose index signature because the
 * fan-out filters on them: `oxlint` binds `.ts` alongside `typescript` but answers only
 * diagnostics, and asking it for a definition wastes a round-trip on a guaranteed miss.
 * A server's own `initialize` reply is the authority on what it can do — better than a
 * `provides:` column in the registry, which would be ours to keep accurate forever.
 */
const ProviderSchema = z.union([z.boolean(), z.looseObject({})]).optional();

const InitializeResultSchema = z.looseObject({
  capabilities: z.looseObject({
    definitionProvider: ProviderSchema,
    hoverProvider: ProviderSchema,
    referencesProvider: ProviderSchema,
    renameProvider: ProviderSchema,
    textDocumentSync: z.union([z.number(), z.looseObject({})]).optional(),
  }),
  serverInfo: z.looseObject({ name: z.string(), version: z.string().optional() }).optional(),
});

/** The position-based requests this subsystem makes, as capability names. */
export type LspFeature = "definition" | "hover" | "references" | "rename";

const CAPABILITY_BY_FEATURE: Readonly<Record<LspFeature, string>> = {
  definition: "definitionProvider",
  hover: "hoverProvider",
  references: "referencesProvider",
  rename: "renameProvider",
};

type InitializeResult = z.infer<typeof InitializeResultSchema>;

const ProgressNotificationSchema = z.looseObject({
  token: z.union([z.string(), z.number()]),
  value: z.looseObject({ kind: z.enum(["begin", "report", "end"]) }),
});

/**
 * `textDocument/publishDiagnostics`, parsed no further than the envelope. Positions stay
 * 0-based and severity stays numeric here — `service.ts` is the only place that converts
 * to Otto's wire shape, exactly as it is for request replies.
 *
 * `severity` is optional in LSP ("client decides"), and `code` may be a string or a
 * number. Both are normalized upstream rather than guessed at here.
 */
const PublishDiagnosticsSchema = z.object({
  uri: z.string(),
  version: z.number().optional(),
  diagnostics: z.array(
    z.object({
      range: z.object({
        start: z.object({ line: z.number(), character: z.number() }),
        end: z.object({ line: z.number(), character: z.number() }),
      }),
      severity: z.number().int().optional(),
      code: z.union([z.string(), z.number()]).optional(),
      /** Documentation for the rule. oxlint sends one per lint; tsserver sends none. */
      codeDescription: z.object({ href: z.string() }).optional(),
      source: z.string().optional(),
      message: z.string(),
    }),
  ),
});

export type LspPublishedDiagnostics = z.infer<typeof PublishDiagnosticsSchema>;

export type LspServerCapabilities = InitializeResult["capabilities"];
export type LspServerInfo = NonNullable<InitializeResult["serverInfo"]>;

export interface LspServerSpec {
  /** Registry row id, e.g. `typescript`. Identifies the server, not the process. */
  id: string;
  command: string;
  args: readonly string[];
  /** Workspace root the server is scoped to; becomes its `rootUri`. */
  rootPath: string;
  env?: Readonly<Record<string, string>>;
  initializationOptions?: unknown;
}

export interface LspExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface LspConnectionOptions {
  spec: LspServerSpec;
  logger: Logger;
  initializeTimeoutMs: number;
  requestTimeoutMs: number;
  onExit: (info: LspExitInfo) => void;
  /**
   * Fired whenever this server becomes busy or idle — spawn/handshake and each
   * work-done-progress window. The pool aggregates these into a per-workspace signal
   * so the UI can show that indexing is live rather than leaving the user guessing.
   */
  onActivityChange?: () => void;
  /**
   * Fired for every `textDocument/publishDiagnostics`. Unsolicited by nature — the
   * server decides when it has recomputed — which is why diagnostics are a push channel
   * rather than a request like everything else in this subsystem.
   */
  onDiagnostics?: (published: LspPublishedDiagnostics) => void;
}

export class LspInitializeTimeoutError extends Error {
  readonly serverId: string;
  readonly timeoutMs: number;

  constructor(serverId: string, timeoutMs: number) {
    super(`Language server ${serverId} did not answer initialize within ${timeoutMs}ms`);
    this.name = "LspInitializeTimeoutError";
    this.serverId = serverId;
    this.timeoutMs = timeoutMs;
  }
}

export class LspRequestTimeoutError extends Error {
  readonly serverId: string;
  readonly method: string;
  readonly timeoutMs: number;

  constructor(serverId: string, method: string, timeoutMs: number) {
    super(`Language server ${serverId} did not answer ${method} within ${timeoutMs}ms`);
    this.name = "LspRequestTimeoutError";
    this.serverId = serverId;
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class LspServerExitedError extends Error {
  readonly serverId: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(serverId: string, info: LspExitInfo) {
    super(`Language server ${serverId} exited (code ${info.code}, signal ${info.signal})`);
    this.name = "LspServerExitedError";
    this.serverId = serverId;
    this.code = info.code;
    this.signal = info.signal;
  }
}

export class LspSpawnError extends Error {
  readonly serverId: string;
  readonly command: string;

  constructor(serverId: string, command: string, cause: Error) {
    super(`Language server ${serverId} failed to spawn (${command}): ${cause.message}`);
    this.name = "LspSpawnError";
    this.serverId = serverId;
    this.command = command;
    this.cause = cause;
  }
}

export interface LanguageServerSpawnPlan {
  command: string;
  args: readonly string[];
  windowsVerbatimArguments: boolean;
}

function needsCmdShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

const SAFE_ARGUMENT = /^[A-Za-z0-9_\-=:.,\\/]+$/;

function quoteForCmd(value: string): string {
  return SAFE_ARGUMENT.test(value) ? value : `"${value}"`;
}

/**
 * Node refuses to spawn `.cmd`/`.bat` directly (CVE-2024-27980), and npm installs
 * its bins as `.cmd` shims on Windows — which is exactly how the workspace-first
 * ladder finds `typescript-language-server`.
 *
 * `shell: true` is the obvious workaround and the wrong one: it concatenates argv
 * without escaping, so the first workspace stored under `C:\My Projects\` splits
 * into garbage. Invoking ComSpec ourselves with `/s` and explicit quoting is what
 * Node does internally, minus the deprecation and minus the injection surface.
 */
export function planLanguageServerSpawn(
  command: string,
  args: readonly string[],
): LanguageServerSpawnPlan {
  if (!needsCmdShell(command)) {
    return { command, args, windowsVerbatimArguments: false };
  }

  const quoted = [quoteForCmd(command), ...args.map(quoteForCmd)].join(" ");
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${quoted}"`],
    windowsVerbatimArguments: true,
  };
}

const STOP_GRACE_MS = 2000;

export class LspConnection {
  private readonly spec: LspServerSpec;
  private readonly logger: Logger;
  private readonly requestTimeoutMs: number;
  private readonly proc: ChildProcess;
  private readonly connection: MessageConnection;
  private exitInfo: LspExitInfo | null = null;
  private initializeResult: InitializeResult | null = null;
  private readonly progressTokens = new Set<string>();
  private readonly reportActivity: () => void;
  private readonly reportDiagnostics: (published: LspPublishedDiagnostics) => void;

  readonly whenExited: Promise<LspExitInfo>;

  private constructor(options: LspConnectionOptions, proc: ChildProcess) {
    this.spec = options.spec;
    this.logger = options.logger.child({ lspServer: options.spec.id });
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.reportActivity = options.onActivityChange ?? (() => {});
    this.reportDiagnostics = options.onDiagnostics ?? (() => {});
    this.proc = proc;

    this.connection = createMessageConnection(
      new StreamMessageReader(proc.stdout!),
      new StreamMessageWriter(proc.stdin!),
    );

    this.whenExited = new Promise<LspExitInfo>((resolve) => {
      proc.once("exit", (code, signal) => {
        const info: LspExitInfo = { code, signal };
        this.exitInfo = info;
        this.logger.debug({ code, signal }, "language server exited");
        options.onExit(info);
        resolve(info);
      });
    });

    // Disposing rejects every in-flight request with vscode-jsonrpc's generic
    // "connection got disposed". Deferring past the microtask queue lets the
    // awaits on `whenExited` observe the exit first, so callers get an
    // LspServerExitedError that says which server died and how.
    void this.whenExited.then(() => setImmediate(() => this.connection.dispose()));

    this.registerHandlers();
    this.connection.listen();
  }

  static async start(options: LspConnectionOptions): Promise<LspConnection> {
    const { spec, logger } = options;
    const plan = planLanguageServerSpawn(spec.command, spec.args);
    const proc = spawn(plan.command, [...plan.args], {
      cwd: spec.rootPath,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    });

    const spawnFailure = new Promise<never>((_resolve, reject) => {
      proc.once("error", (error) => reject(new LspSpawnError(spec.id, spec.command, error)));
    });

    const connection = new LspConnection(options, proc);
    connection.pipeStderr();

    try {
      await Promise.race([connection.initialize(options.initializeTimeoutMs), spawnFailure]);
    } catch (error) {
      await connection.stop();
      throw error;
    }

    logger.debug(
      { lspServer: spec.id, serverInfo: connection.serverInfo },
      "language server initialized",
    );
    return connection;
  }

  get isRunning(): boolean {
    return this.exitInfo === null;
  }

  get capabilities(): LspServerCapabilities {
    if (this.initializeResult === null) {
      throw new Error(`Language server ${this.spec.id} has not completed initialize`);
    }
    return this.initializeResult.capabilities;
  }

  get serverInfo(): LspServerInfo | undefined {
    return this.initializeResult?.serverInfo;
  }

  /**
   * Whether the server advertised this request. Absent and explicit `false` are both no —
   * LSP allows either for "not supported".
   */
  supports(feature: LspFeature): boolean {
    const capabilities = this.initializeResult?.capabilities;
    if (capabilities === undefined) {
      return false;
    }
    const advertised = capabilities[CAPABILITY_BY_FEATURE[feature]];
    return advertised !== undefined && advertised !== false;
  }

  /**
   * Whether the server has work-done progress in flight — a real signal from the
   * server, not a guess from elapsed time. It is what lets an empty definition result
   * during a cold project load be reported as "indexing" rather than "not found".
   */
  get isIndexing(): boolean {
    return this.progressTokens.size > 0;
  }

  async request<R>(method: string, params: unknown, timeoutMs?: number): Promise<R> {
    if (this.exitInfo !== null) {
      throw new LspServerExitedError(this.spec.id, this.exitInfo);
    }

    const limitMs = timeoutMs ?? this.requestTimeoutMs;
    const source = new CancellationTokenSource();
    const pending = this.connection.sendRequest<R>(method, params, source.token);
    // The race below settles first on timeout; without this the abandoned
    // rejection surfaces as an unhandled promise rejection.
    pending.catch(() => {});

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        source.cancel();
        reject(new LspRequestTimeoutError(this.spec.id, method, limitMs));
      }, limitMs);
    });

    try {
      return await Promise.race([pending, timeout, this.exitedAsError<R>()]);
    } finally {
      clearTimeout(timer);
      source.dispose();
    }
  }

  notify(method: string, params: unknown): void {
    if (this.exitInfo !== null) {
      throw new LspServerExitedError(this.spec.id, this.exitInfo);
    }
    this.connection.sendNotification(method, params);
  }

  async stop(): Promise<void> {
    if (this.exitInfo !== null) {
      return;
    }

    try {
      await this.connection.sendRequest("shutdown", null, this.cancelAfter(STOP_GRACE_MS));
      this.connection.sendNotification("exit");
    } catch (error) {
      this.logger.debug({ err: error }, "language server shutdown handshake failed; killing");
    }

    const exited = await Promise.race([
      this.whenExited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_GRACE_MS)),
    ]);

    if (!exited) {
      this.proc.kill("SIGKILL");
      await this.whenExited;
    }
  }

  private async initialize(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new LspInitializeTimeoutError(this.spec.id, timeoutMs)),
        timeoutMs,
      );
    });

    try {
      const raw = await Promise.race([
        this.connection.sendRequest("initialize", this.initializeParams()),
        timeout,
        this.exitedAsError<unknown>(),
      ]);
      this.initializeResult = InitializeResultSchema.parse(raw);
      this.connection.sendNotification("initialized", {});
    } finally {
      clearTimeout(timer);
    }
  }

  private initializeParams(): unknown {
    const rootUri = toFileUri(this.spec.rootPath);
    return {
      processId: process.pid,
      clientInfo: { name: "Otto" },
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          definition: { linkSupport: true },
          // Declared even though most servers publish regardless: some gate on it,
          // and a server that thinks nobody is listening is entitled to stay quiet.
          // `relatedInformation` is off because nothing renders the secondary spans yet
          // — claiming support we ignore would only make payloads bigger.
          // `codeDescriptionSupport` is on: it is the rule's documentation URL, and a
          // lint warning that can link to what the rule is for is the difference between
          // an instruction and an explanation.
          publishDiagnostics: {
            relatedInformation: false,
            versionSupport: false,
            codeDescriptionSupport: true,
            dataSupport: false,
          },
        },
        workspace: { workspaceFolders: true, configuration: true },
      },
      initializationOptions: this.spec.initializationOptions,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.spec.rootPath) }],
    };
  }

  /**
   * Servers block on these until answered — pyright asks for configuration
   * before it will index, and several register capabilities during startup.
   * Phase 1 answers them minimally rather than negotiating.
   */
  private registerHandlers(): void {
    this.connection.onRequest("client/registerCapability", () => null);
    this.connection.onRequest("client/unregisterCapability", () => null);
    this.connection.onRequest("window/workDoneProgress/create", () => null);
    this.connection.onRequest("workspace/configuration", (params: unknown) => {
      const items = z.looseObject({ items: z.array(z.unknown()) }).safeParse(params);
      return items.success ? items.data.items.map(() => ({})) : [];
    });

    this.connection.onNotification("$/progress", (params: unknown) => {
      const parsed = ProgressNotificationSchema.safeParse(params);
      if (!parsed.success) {
        return;
      }
      const token = String(parsed.data.token);
      if (parsed.data.value.kind === "begin") {
        this.progressTokens.add(token);
        this.reportActivity();
      } else if (parsed.data.value.kind === "end") {
        this.progressTokens.delete(token);
        this.reportActivity();
      }
    });

    this.connection.onNotification("textDocument/publishDiagnostics", (params: unknown) => {
      const parsed = PublishDiagnosticsSchema.safeParse(params);
      if (!parsed.success) {
        this.logger.debug({ params }, "unparseable publishDiagnostics");
        return;
      }
      this.reportDiagnostics(parsed.data);
    });

    this.connection.onNotification("window/logMessage", (params: unknown) => {
      this.logger.debug({ params }, "language server log");
    });
    this.connection.onNotification("window/showMessage", (params: unknown) => {
      this.logger.info({ params }, "language server message");
    });

    this.connection.onError(([error, message]) => {
      this.logger.warn({ err: error, method: message?.jsonrpc }, "language server channel error");
    });
  }

  private pipeStderr(): void {
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      this.logger.debug({ stderr: chunk.toString().trimEnd() }, "language server stderr");
    });
  }

  private exitedAsError<R>(): Promise<R> {
    return this.whenExited.then((info) => {
      throw new LspServerExitedError(this.spec.id, info);
    });
  }

  private cancelAfter(ms: number) {
    const source = new CancellationTokenSource();
    setTimeout(() => source.cancel(), ms).unref();
    return source.token;
  }
}
