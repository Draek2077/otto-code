import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
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
import {
  sharedDotnetProcessRegistry,
  type TrackedDotnetProcess,
} from "../dotnet-process-registry.js";
import { killProcessTree, MSBUILD_ENV } from "../process-tree.js";
import { toFileUri } from "./uri.js";

/**
 * One live language server: the spawned process, the JSON-RPC channel to it, and
 * the handshake. Owns nothing above itself - which server to run and when to run
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
 * A server's own `initialize` reply is the authority on what it can do - better than a
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
 * 0-based and severity stays numeric here - `service.ts` is the only place that converts
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
  /** Mirrors the registry row; `"dotnet"` routes the spawn through the .NET process cap. */
  runtime?: "dotnet";
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
   * Fired whenever this server becomes busy or idle - spawn/handshake and each
   * work-done-progress window. The pool aggregates these into a per-workspace signal
   * so the UI can show that indexing is live rather than leaving the user guessing.
   */
  onActivityChange?: () => void;
  /**
   * Fired for every `textDocument/publishDiagnostics`. Unsolicited by nature - the
   * server decides when it has recomputed - which is why diagnostics are a push channel
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
 * its bins as `.cmd` shims on Windows - which is exactly how the workspace-first
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

/**
 * Whether a reply counts as the server proving it can answer. An empty array and a null are what
 * a still-warming server returns, so neither may latch `hasAnswered` - that is the whole point.
 */
function isRealAnswer(result: unknown): boolean {
  if (result === null || result === undefined) {
    return false;
  }
  return !Array.isArray(result) || result.length > 0;
}

export class LspConnection {
  private readonly spec: LspServerSpec;
  private readonly logger: Logger;
  private readonly requestTimeoutMs: number;
  /** See `hasAnswered`. Latches on the first real reply and never clears for this process. */
  private answered = false;
  /** See `hasIndexed`. Latches on the first progress token and never clears for this process. */
  private indexed = false;
  private readonly proc: ChildProcess;
  private readonly connection: MessageConnection;
  private exitInfo: LspExitInfo | null = null;
  private initializeResult: InitializeResult | null = null;
  private readonly progressTokens = new Set<string>();
  /** Non-null for `runtime: "dotnet"` rows; owns the registry slot and the tree kill. */
  private tracked: TrackedDotnetProcess | null = null;
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
    const spawnOptions: SpawnOptions = {
      cwd: spec.rootPath,
      // MSBUILD_ENV applies to every server, not just the .NET ones: a server that has
      // never heard of MSBuild ignores the variables, and gating on the registry id
      // would mean remembering to add each future MSBuild-backed row to a list. See
      // process-tree.ts for why node reuse is the thing being switched off.
      env: { ...process.env, ...MSBUILD_ENV, ...spec.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    };

    // A .NET server counts against the machine-wide .NET cap alongside the solution
    // sidecar, because they load the same MSBuild machinery on the same machine and a
    // per-subsystem cap can only bound its own half of the total.
    let tracked: TrackedDotnetProcess | null = null;
    let proc: ChildProcess;
    if (spec.runtime === "dotnet") {
      tracked = sharedDotnetProcessRegistry(logger).spawnTracked({
        command: plan.command,
        args: plan.args,
        options: spawnOptions,
        kind: "language-server",
        label: `${spec.id} @ ${spec.rootPath}`,
      });
      proc = tracked.child;
    } else {
      proc = spawn(plan.command, [...plan.args], spawnOptions);
    }

    const spawnFailure = new Promise<never>((_resolve, reject) => {
      proc.once("error", (error) => reject(new LspSpawnError(spec.id, spec.command, error)));
    });

    // A language server is allowed to die at any moment, and when it does, every pipe to it
    // starts erroring. Node turns an 'error' event with no listener into an uncaught exception,
    // so these listeners are what stop a crashing server from taking the daemon with it. The
    // per-write guards in `notify`/`cancelQuietly` cover the promise-rejection half of the same
    // hazard; this covers the event half.
    for (const stream of [proc.stdin, proc.stdout, proc.stderr]) {
      stream?.on("error", (error: unknown) => {
        logger.debug({ err: error, lspServer: spec.id }, "language server pipe error");
      });
    }

    const connection = new LspConnection(options, proc);
    connection.tracked = tracked;
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
   * Whether the server advertised this request. Absent and explicit `false` are both no -
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
   * Whether the server has work-done progress in flight - a real signal from the
   * server, not a guess from elapsed time. It is what lets an empty definition result
   * during a cold project load be reported as "indexing" rather than "not found".
   */
  get isIndexing(): boolean {
    return this.progressTokens.size > 0;
  }

  /**
   * Whether this server has ever produced a real answer.
   *
   * `isIndexing` alone is not a readiness signal, because it is only true *while* the server is
   * reporting work-done progress. csharp-ls loading a large solution reports nothing for its first
   * moments and then, once "Finished loading" clears the last progress token, keeps returning null
   * for several more seconds while it builds semantic models. In both of those windows a null
   * hover was reported as a confident "nothing to say", which retracts the tooltip and stops the
   * client re-asking - so a cold server's answer never arrived no matter how long the user waited.
   *
   * A server that has answered once is warm, and its nulls can be believed from then on.
   */
  get hasAnswered(): boolean {
    return this.answered;
  }

  /**
   * Whether this server has ever reported work-done progress, which is what marks it as the kind
   * that builds a project model before it can answer. Servers that never index (the TypeScript
   * server answers from the first request) are never treated as warming on this account, so their
   * "nothing to say" stays exactly that.
   */
  get hasIndexed(): boolean {
    return this.indexed;
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
        this.cancelQuietly(source);
        reject(new LspRequestTimeoutError(this.spec.id, method, limitMs));
      }, limitMs);
    });

    try {
      const result = await Promise.race([pending, timeout, this.exitedAsError<R>()]);
      if (isRealAnswer(result)) {
        this.answered = true;
      }
      return result;
    } finally {
      clearTimeout(timer);
      source.dispose();
    }
  }

  /**
   * Cancelling tells the server to stop work, but it is itself a WRITE - `$/cancelRequest` - so
   * on a server that has already died it rejects with EPIPE from inside vscode-jsonrpc, where
   * there is no promise for us to await. Skipping it once the process is gone is what keeps a
   * routine timeout against a dead server from crashing the daemon.
   */
  private cancelQuietly(source: CancellationTokenSource): void {
    if (this.exitInfo !== null) {
      return;
    }
    try {
      source.cancel();
    } catch (error) {
      this.logger.debug({ err: error, lspServer: this.spec.id }, "cancel failed");
    }
  }

  notify(method: string, params: unknown): void {
    if (this.exitInfo !== null) {
      throw new LspServerExitedError(this.spec.id, this.exitInfo);
    }
    // The promise is deliberately caught, not discarded. A language server that just died
    // leaves its stdin destroyed, so this write rejects with EPIPE - and an unhandled rejection
    // takes the WHOLE DAEMON down, killing every agent, over a child process that was expected
    // to be able to crash. `exitInfo` above is not enough: the process can die between that
    // check and this write.
    void this.connection.sendNotification(method, params).catch((error: unknown) => {
      this.logger.debug({ err: error, lspServer: this.spec.id, method }, "notify failed");
    });
  }

  async stop(): Promise<void> {
    if (this.exitInfo !== null) {
      return;
    }

    try {
      const shutdown = this.connection.sendRequest(
        "shutdown",
        null,
        this.cancelAfter(STOP_GRACE_MS),
      );
      // Cancellation in LSP is COOPERATIVE: cancelling asks the server to give up, and a server
      // that never answers never settles this promise. The token alone therefore cannot bound
      // the wait, and `start` calls `stop` when a handshake fails - so without this race, a
      // process that accepts a connection and then says nothing (a wrapper script, the wrong
      // binary on PATH, a server wedged on a bad workspace) hangs the spawn path forever.
      shutdown.catch(() => {
        // Raced below; a late rejection must not escape as an unhandled rejection.
      });
      await Promise.race([
        shutdown,
        new Promise<void>((resolve) => setTimeout(resolve, STOP_GRACE_MS)),
      ]);
      void this.connection.sendNotification("exit").catch(() => {
        // Stopping a server that already exited is the normal case, not a failure.
      });
    } catch (error) {
      this.logger.debug({ err: error }, "language server shutdown handshake failed; killing");
    }

    const exited = await Promise.race([
      this.whenExited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_GRACE_MS)),
    ]);

    if (!exited) {
      // The tree, not the process: a `.cmd` shim makes `this.proc` the shell rather
      // than the server, and an MSBuild-backed server can have workers of its own. A
      // tracked (.NET) server goes back through the registry so its slot is freed too.
      if (this.tracked) {
        this.tracked.release();
      } else {
        killProcessTree(this.proc);
      }
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
      void this.connection.sendNotification("initialized", {}).catch((error: unknown) => {
        this.logger.debug({ err: error, lspServer: this.spec.id }, "initialized notify failed");
      });
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
          // - claiming support we ignore would only make payloads bigger.
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
        // Without this a server MUST NOT start server-initiated progress (LSP spec), so
        // it never tells us it is loading a project - which is exactly why TypeScript
        // looked like it indexed instantly and then quietly under-reported references for
        // the next several seconds. Answering `window/workDoneProgress/create` is not
        // enough; the capability has to be advertised for the server to ask at all.
        window: { workDoneProgress: true },
      },
      initializationOptions: this.spec.initializationOptions,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.spec.rootPath) }],
    };
  }

  /**
   * Servers block on these until answered - pyright asks for configuration
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
        this.indexed = true;
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
      // Deliberately NOT treated as proof the server is warm: a server can publish diagnostics
      // for the file you just opened while the rest of the project is still loading, and trusting
      // that would put `hasAnswered` back to latching before the server can actually answer.
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
    // Same hazard as the request timeout: this fires while a server is shutting down, which is
    // exactly when its stdin is likeliest to be gone. See `cancelQuietly`.
    setTimeout(() => this.cancelQuietly(source), ms).unref();
    return source.token;
  }
}
