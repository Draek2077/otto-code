import type { ChildProcess } from "node:child_process";
import type { Logger } from "pino";
import { z } from "zod";
import {
  CancellationTokenSource,
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node.js";
import { spawnProcess } from "../../../../utils/spawn.js";
import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";
import { EditorError } from "../errors.js";
import { buildSelfNodeCommand } from "../../../paseo-env.js";
import { fileUri, pathKey, uriPath } from "./uri.js";
import { PublishedDiagnostics } from "./schema.js";
import type { ResolvedServer, ServerRow } from "./registry.js";
import {
  sharedDotnetProcessRegistry,
  type TrackedDotnetProcess,
} from "../dotnet-process-registry.js";

const Provider = z.union([z.boolean(), z.object({}).passthrough()]).optional();
const Initialize = z.object({
  capabilities: z
    .object({
      positionEncoding: z.string().optional(),
      definitionProvider: Provider,
      hoverProvider: Provider,
      referencesProvider: Provider,
      renameProvider: Provider,
      completionProvider: Provider,
      documentSymbolProvider: Provider,
    })
    .passthrough(),
  serverInfo: z.object({ name: z.string(), version: z.string().optional() }).optional(),
});
const Progress = z.object({
  token: z.union([z.string(), z.number()]),
  value: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("begin"),
      title: z.string(),
      message: z.string().optional(),
      percentage: z.number().optional(),
    }),
    z.object({
      kind: z.literal("report"),
      message: z.string().optional(),
      percentage: z.number().optional(),
    }),
    z.object({ kind: z.literal("end"), message: z.string().optional() }),
  ]),
});
export type LspFeature =
  | "definition"
  | "hover"
  | "references"
  | "rename"
  | "completion"
  | "documentSymbol";
export interface ConnectionOptions {
  row: ServerRow;
  launch: ResolvedServer;
  root: string;
  logger: Logger;
  initializeMs?: number;
  requestMs?: number;
  onDiagnostics(value: PublishedDiagnostics, text: string): void;
  onExit(): void;
}
interface MirroredDocument {
  version: number;
  text: string;
}

/** A process, its RPC stream and its versioned documents have the same lifetime. */
export class LanguageConnection {
  private child: ChildProcess | null = null;
  private rpc: MessageConnection | null = null;
  private trackedDotnet: TrackedDotnetProcess | null = null;
  private capabilities: z.infer<typeof Initialize>["capabilities"] | null = null;
  private closed = false;
  private closing: Promise<void> | null = null;
  private readonly documents = new Map<string, MirroredDocument>();
  private readonly progress = new Map<string | number, string>();
  readonly startedAt = Date.now();
  lastUsedAt = Date.now();

  constructor(private readonly options: ConnectionOptions) {}

  async start(): Promise<void> {
    const { row, root, launch } = this.options;
    if (this.closed) throw new EditorError("closed", "Language server was stopped.");
    // Reuse Paseo's own Node/Electron runtime. Packaged desktop users do not
    // need a global Node install, and npm .cmd shims never parse source paths.
    const self = launch.selfNode ? buildSelfNodeCommand(launch.args) : null;
    const environment = self ? { env: self.env, envMode: "internal" as const } : {};
    const spawnOptions = {
      ...environment,
      shell: false,
      cwd: root,
      stdio: "pipe" as const,
      windowsHide: true,
      envOverlay: { MSBUILDDISABLENODEREUSE: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1" },
    };
    if (row.id === "csharp")
      this.trackedDotnet = sharedDotnetProcessRegistry(this.options.logger).spawnTracked({
        command: launch.command,
        args: launch.args,
        options: spawnOptions,
        kind: "language-server",
        label: root,
      });
    const child =
      this.trackedDotnet?.child ??
      spawnProcess(self?.command ?? launch.command, self?.args ?? launch.args, spawnOptions);
    this.child = child;
    if (!child.stdin || !child.stdout || !child.stderr) {
      await this.close();
      throw new EditorError(
        "unavailable",
        "Language server did not open its communication streams.",
      );
    }
    const rpc = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    this.rpc = rpc;
    child.stderr.on("data", (data: Buffer) =>
      this.options.logger.debug(
        { serverId: row.id, output: data.toString().slice(0, 4096) },
        "Language server stderr",
      ),
    );
    child.once("error", (error) => {
      this.options.logger.warn({ err: error, serverId: row.id }, "Language server process failed");
      this.exited();
    });
    child.once("exit", () => this.exited());
    rpc.onClose(() => this.exited());
    rpc.onError((error) =>
      this.options.logger.warn({ error, serverId: row.id }, "Language server transport failed"),
    );
    rpc.onNotification("textDocument/publishDiagnostics", (input: unknown) => {
      const result = PublishedDiagnostics.safeParse(input);
      if (!result.success || this.closed) return;
      try {
        const mirrored = this.documents.get(pathKey(uriPath(result.data.uri)));
        // URI spelling is not document identity (notably drive-letter case).
        if (
          !mirrored ||
          (result.data.version !== undefined && result.data.version !== mirrored.version)
        )
          return;
        this.options.onDiagnostics(result.data, mirrored.text);
      } catch (error) {
        this.options.logger.warn(
          { err: error, serverId: row.id },
          "Language server sent an invalid diagnostic location",
        );
      }
    });
    rpc.onNotification("$/progress", (input: unknown) => this.receiveProgress(input));
    rpc.onRequest("window/workDoneProgress/create", () => null);
    rpc.onRequest("workspace/configuration", (input: unknown) => {
      const request = z.object({ items: z.array(z.unknown()) }).parse(input);
      return request.items.map(() => null);
    });
    rpc.onRequest("workspace/workspaceFolders", () => [{ uri: fileUri(root), name: root }]);
    // Servers may request edits; only an explicit user-reviewed rename plan may
    // mutate files. Do not turn unsolicited server messages into writes.
    rpc.onRequest("workspace/applyEdit", () => ({
      applied: false,
      failureReason: "Review the edit in Otto first.",
    }));
    rpc.onNotification("window/logMessage", () => undefined);
    rpc.listen();
    try {
      const result = Initialize.parse(
        await this.request(
          "initialize",
          {
            processId: process.pid,
            rootUri: fileUri(root),
            clientInfo: { name: "Otto", version: "0.10.0" },
            workspaceFolders: [{ uri: fileUri(root), name: root }],
            // Reading a project must not trigger npm installs in a global ATA
            // cache. Existing project declarations remain fully available.
            initializationOptions:
              row.id === "typescript" ? { disableAutomaticTypingAcquisition: true } : undefined,
            capabilities: {
              general: { positionEncodings: ["utf-16"] },
              workspace: { workspaceFolders: true, configuration: true, applyEdit: false },
              window: { workDoneProgress: true },
              textDocument: {
                synchronization: { dynamicRegistration: false, didSave: true },
                completion: { completionItem: { snippetSupport: false } },
                hover: { contentFormat: ["markdown", "plaintext"] },
                publishDiagnostics: { versionSupport: true },
                documentSymbol: { hierarchicalDocumentSymbolSupport: true },
              },
            },
          },
          this.options.initializeMs ?? 60000,
        ),
      );
      if (result.capabilities.positionEncoding && result.capabilities.positionEncoding !== "utf-16")
        throw new EditorError(
          "unavailable",
          "Language server selected an unsupported position encoding.",
        );
      this.capabilities = result.capabilities;
      await this.notify("initialized", {});
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  supports(feature: LspFeature): boolean {
    const capability = this.capabilities?.[`${feature}Provider`];
    return capability !== undefined && capability !== false;
  }
  get indexing(): readonly string[] {
    return [...this.progress.values()];
  }
  get alive(): boolean {
    return !this.closed;
  }

  async sync(file: string, text: string, languageId: string): Promise<number> {
    const uri = fileUri(file);
    const key = pathKey(file);
    const previous = this.documents.get(key);
    if (previous?.text === text) return previous.version;
    const version = (previous?.version ?? 0) + 1;
    this.documents.set(key, { text, version });
    if (!previous)
      await this.notify("textDocument/didOpen", {
        textDocument: { uri, text, languageId, version },
      });
    else
      await this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    return version;
  }
  async closeDocument(file: string): Promise<void> {
    const uri = fileUri(file);
    if (!this.documents.delete(pathKey(file)) || this.closed) return;
    await this.notify("textDocument/didClose", { textDocument: { uri } });
  }
  async request(
    method: string,
    params: unknown,
    timeout = this.options.requestMs ?? 20000,
  ): Promise<unknown> {
    const rpc = this.rpc;
    if (!rpc || this.closed)
      throw new EditorError("closed", "Language server is no longer connected.");
    this.lastUsedAt = Date.now();
    const cancellation = new CancellationTokenSource();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        cancellation.cancel();
        reject(new EditorError("timeout", "Language server did not answer in time."));
      }, timeout);
      timer.unref();
    });
    try {
      return await Promise.race([
        rpc.sendRequest<unknown>(method, params, cancellation.token),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
      cancellation.dispose();
    }
  }
  private async notify(method: string, params: unknown) {
    if (!this.rpc || this.closed)
      throw new EditorError("closed", "Language server is no longer connected.");
    await this.rpc.sendNotification(method, params);
  }
  private receiveProgress(input: unknown) {
    const result = Progress.safeParse(input);
    if (!result.success) return;
    const { token, value } = result.data;
    if (value.kind === "end") this.progress.delete(token);
    else if (value.kind === "begin") this.progress.set(token, value.title);
    // Report percentages are telemetry, never an invented indexing countdown.
  }
  private exited() {
    if (this.closed) return;
    this.closed = true;
    this.documents.clear();
    this.progress.clear();
    this.rpc?.dispose();
    this.options.onExit();
  }
  close(): Promise<void> {
    this.closing ??= this.stop();
    return this.closing;
  }
  private async stop() {
    const rpc = this.rpc;
    if (rpc && !this.closed) {
      try {
        await this.request("shutdown", null, 1500);
        await rpc.sendNotification("exit");
      } catch (error) {
        this.options.logger.debug({ err: error }, "Language server shutdown handshake ended");
      }
    }
    this.exited();
    if (this.child)
      await terminateWithTreeKill(this.child, { gracefulTimeoutMs: 1500, forceTimeoutMs: 1500 });
    this.trackedDotnet?.release();
  }
}
