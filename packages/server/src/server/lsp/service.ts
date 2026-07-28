import type {
  CodeDefinitionLocation,
  CodeDefinitionStatus,
  CodeDiagnostic,
} from "@otto-code/protocol/messages";
import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import { z } from "zod";
import type { LspFeature } from "./connection.js";
import { LspDiagnosticsStore, toCodeDiagnostics } from "./diagnostics.js";
import {
  EditJobStore,
  isInsideWorkspace,
  type FileOutcome,
  type PlannedEdit,
  type PlannedFile,
  type UndoFileOutcome,
} from "./edit-job.js";
import { LspDocuments } from "./documents.js";
import {
  LspServerPool,
  type BoundServer,
  type LspDiagnosticsEvent,
  type LspPoolLimits,
  type RunningServer,
} from "./pool.js";
import { resolveServerCommand, type LspServerRow } from "./registry.js";
import { documentKey, fromFileUri } from "./uri.js";

/**
 * The daemon's code-intelligence surface: what the `code.definition` and
 * `code.document.*` RPCs call. Everything below it (pool, documents, connections) is
 * an implementation detail of this object.
 *
 * The three-valued answer is the point. "No server for this language on this host",
 * "the server is up but still building its project model", and "the server looked and
 * there is nothing there" are different things to tell a user, and collapsing the
 * first two into an empty result is how a working feature reads as broken.
 */

const DEFAULT_LIMITS: LspPoolLimits = {
  maxRunningServers: 6,
  idleMs: 10 * 60_000,
  backgroundIdleMs: 2 * 60_000,
  crashBackoffMs: 2000,
  maxCrashBackoffMs: 60_000,
  initializeTimeoutMs: 60_000,
  requestTimeoutMs: 20_000,
};

export interface LspServiceOptions {
  logger: Logger;
  rows?: readonly LspServerRow[];
  limits?: Partial<LspPoolLimits>;
  now?: () => number;
}

/**
 * The host's policy, mirroring `MutableDaemonConfig.lsp`. `languages` is sparse: an
 * absent key means "use the row's own default", so a newly added row ships with its
 * intended default rather than reading as disabled.
 */
export interface LspSettings {
  enabled: boolean;
  languages: Readonly<Record<string, boolean>>;
  maxRunningServers: number;
  idleMinutes: number;
  backgroundIdleMinutes: number;
}

const DEFAULT_SETTINGS: LspSettings = {
  enabled: true,
  languages: {},
  maxRunningServers: 6,
  idleMinutes: 10,
  backgroundIdleMinutes: 2,
};

/** One language row's state, for the settings screen. */
export interface LspLanguageState {
  id: string;
  enabled: boolean;
  /** Whether this machine can actually supply the server. */
  installed: boolean;
  running: boolean;
  /** Which discovery rung supplied it, or null when nothing did. */
  rung: string | null;
  /**
   * Every rung this row can ever be supplied from. A row whose only rung is `workspaceBin`
   * comes from the project it runs in, so `installed: false` from a host-wide check means
   * the project brings it, not that anything is missing.
   */
  discovery: string[];
  /** Absolute path to the resolved executable, or null when nothing resolved. */
  path: string | null;
  bin: string;
  extensions: string[];
  indexCost: string;
}

export interface SyncDocumentInput {
  rootPath: string;
  filePath: string;
  text: string;
}

export interface CloseDocumentInput {
  rootPath: string;
  filePath: string;
}

/** 1-based, as it arrives on the wire. */
export interface DefinitionQuery {
  rootPath: string;
  filePath: string;
  line: number;
  column: number;
}

export interface DefinitionResult {
  status: CodeDefinitionStatus;
  locations: CodeDefinitionLocation[];
  error: string | null;
}

export interface HoverRange {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface HoverResult {
  status: CodeDefinitionStatus;
  /** Markdown, or null when the server had nothing to say about this position. */
  markdown: string | null;
  range: HoverRange | null;
  serverId: string | null;
  error: string | null;
}

export interface ReferencesResult {
  status: CodeDefinitionStatus;
  locations: CodeDefinitionLocation[];
  error: string | null;
}

/**
 * One edit a rename would make, 1-based.
 *
 * `oldText` is what makes the job reversible and verifiable rather than merely described: it
 * is the text the edit expects to replace, and the only way to tell at run time that a file
 * moved under the plan.
 */
export type RenameEdit = PlannedEdit;

export type RenameFilePlan = PlannedFile;

/**
 * What the language server said, before the plan is grounded against the files. Distinct
 * from `RenameFilePlan` on purpose: only one of these two has been checked against reality,
 * and letting them share a type is how an ungrounded plan reaches the run.
 */
interface RenameFileRanges {
  path: string;
  edits: Omit<PlannedEdit, "oldText">[];
}

/**
 * What a rename *would* do. Nothing is written by producing this — the whole point is
 * that a project-wide edit is auditable before it happens.
 */
export interface RenamePlan {
  status: CodeDefinitionStatus;
  files: RenameFilePlan[];
  fileCount: number;
  editCount: number;
  /**
   * Identity of this exact set of edits. Echoed back on apply so the daemon can prove the
   * plan being applied is the plan that was audited — computed here rather than by the
   * client so there is only one definition of "the same plan" in the system.
   */
  planId: string;
  error: string | null;
}

export interface RenameQuery extends DefinitionQuery {
  newName: string;
}

export interface RenameApplyQuery extends RenameQuery {
  /** The `planId` of the plan the user actually audited. */
  planId: string;
}

export type RenameApplyStatus =
  /**
   * The run happened. NOT the same as "everything applied" — read `complete` and the
   * per-file outcomes for that. A run where two of fourteen edits no longer fit is still a
   * run that took place, and reporting it as a failure would hide the twelve that landed.
   */
  | "ok"
  /** The host no longer holds this plan, so there is nothing to run. */
  | "expired"
  /** The plan names a file outside the workspace. Nothing written, deliberately. */
  | "escaped";

export interface RenameApplyResult {
  status: RenameApplyStatus;
  /** Identity of this run, for undo. Null when nothing ran. */
  runId: string | null;
  files: FileOutcome[];
  appliedFiles: number;
  appliedEdits: number;
  skippedEdits: number;
  /** True only when every planned edit landed. */
  complete: boolean;
  error: string | null;
}

export type RenameUndoStatus = "ok" | "expired";

export interface RenameUndoResult {
  status: RenameUndoStatus;
  files: UndoFileOutcome[];
  restoredFiles: number;
  /** True only when every file the run wrote was put back. */
  complete: boolean;
  error: string | null;
}

/** One document's whole current problem set, ready to broadcast. */
export interface DiagnosticsSnapshot {
  rootPath: string;
  filePath: string;
  diagnostics: CodeDiagnostic[];
}

// `z.object` rather than `looseObject`: these are read, not forwarded, and a loose
// object's index signature collapses the narrowed union members below to `unknown`.
// Unknown keys are stripped, which is what we want from a foreign process's payload.
const PositionSchema = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});

const RangeSchema = z.object({ start: PositionSchema, end: PositionSchema });

const LocationSchema = z.object({ uri: z.string(), range: RangeSchema });

/**
 * `LocationLink` prefers `targetSelectionRange` — the identifier itself — over
 * `targetRange`, which spans the whole declaration and would land the caret on the
 * line above the name for anything with a doc comment.
 */
const LocationLinkSchema = z.object({
  targetUri: z.string(),
  targetRange: RangeSchema,
  targetSelectionRange: RangeSchema.optional(),
});

const DefinitionReplySchema = z.union([
  z.null(),
  LocationSchema,
  LocationLinkSchema,
  z.array(z.union([LocationSchema, LocationLinkSchema])),
]);

/**
 * `Hover.contents` has three legal shapes across LSP versions — a marked string, an
 * array of them, or a `MarkupContent`. Servers in the wild still send all three.
 */
const MarkedStringSchema = z.union([
  z.string(),
  z.object({ language: z.string(), value: z.string() }),
]);

const HoverContentsSchema = z.union([
  z.object({ kind: z.enum(["plaintext", "markdown"]), value: z.string() }),
  MarkedStringSchema,
  z.array(MarkedStringSchema),
]);

const HoverReplySchema = z.union([
  z.null(),
  z.object({ contents: HoverContentsSchema, range: RangeSchema.optional() }),
]);

const TextEditSchema = z.object({ range: RangeSchema, newText: z.string() });

/**
 * Only the `changes` map is read. `documentChanges` additionally carries file
 * creates/renames/deletes, which a symbol rename does not produce — and applying an
 * unreviewed file operation is exactly what the dry-run tab exists to prevent. A server
 * that answers only in `documentChanges` reads as "nothing to rename" rather than
 * silently doing something unaudited.
 */
const WorkspaceEditSchema = z.union([
  z.null(),
  z.object({ changes: z.record(z.string(), z.array(TextEditSchema)).optional() }),
]);

export class LspService {
  private readonly pool: LspServerPool;
  private readonly documents: LspDocuments;
  private readonly logger: Logger;

  private readonly diagnostics = new LspDiagnosticsStore();
  /** Plans and their runs, so a job can be executed as audited and taken back afterwards. */
  private readonly jobs = new EditJobStore();

  private settings: LspSettings = DEFAULT_SETTINGS;
  /** Last workspace handed to the pool, so an unchanged one never re-enters it. */
  private activeWorkspaceKey: string | null = null;
  private activityListener: ((busyRoots: string[]) => void) | null = null;
  private diagnosticsListener: ((snapshot: DiagnosticsSnapshot) => void) | null = null;
  /** Last snapshot sent, so an unchanged set never becomes a broadcast. */
  private lastBusyKey = "";

  private constructor(pool: LspServerPool, documents: LspDocuments, logger: Logger) {
    this.pool = pool;
    this.documents = documents;
    this.logger = logger;
    this.pool.setRowFilter((row) => this.isRowEnabled(row));
  }

  static create(options: LspServiceOptions): LspService {
    let service: LspService | null = null;
    const pool = new LspServerPool({
      logger: options.logger,
      rows: options.rows,
      limits: { ...DEFAULT_LIMITS, ...options.limits },
      now: options.now,
      onActivityChange: () => service?.publishActivity(),
      onDiagnostics: (event) => service?.ingestDiagnostics(event),
      onServerGone: (event) => service?.retractDiagnostics(event),
    });
    const documents = new LspDocuments({ pool, logger: options.logger });
    service = new LspService(pool, documents, options.logger.child({ subsystem: "lsp-service" }));
    return service;
  }

  /**
   * Subscribe to the set of workspaces with language-server work in flight. The daemon
   * broadcasts it so a workspace row can show that a cold start is live — which is the
   * whole point on a large project, where the first lookup is the slow one.
   */
  onActivityChange(listener: (busyRoots: string[]) => void): void {
    this.activityListener = listener;
  }

  busyRoots(): string[] {
    return this.pool.busyRoots();
  }

  /**
   * Subscribe to per-document problem sets. Unlike everything else here this is a push:
   * `textDocument/publishDiagnostics` is unsolicited, so there is no request to hang the
   * answer off. The daemon broadcasts each snapshot to connected clients.
   */
  onDiagnosticsChange(listener: (snapshot: DiagnosticsSnapshot) => void): void {
    this.diagnosticsListener = listener;
  }

  /** The current problem set for one document — what a freshly opened tab needs. */
  diagnosticsFor(filePath: string): CodeDiagnostic[] {
    return this.diagnostics.merged(documentKey(filePath));
  }

  /**
   * A server published for a document. Dropped unless that document is open here: a server
   * may hold opinions about every file in the project, nothing can render a marker in a file
   * with no tab, and an unbounded push is how a status channel becomes a bandwidth problem.
   */
  private ingestDiagnostics(event: LspDiagnosticsEvent): void {
    let filePath: string;
    try {
      filePath = fromFileUri(event.published.uri);
    } catch {
      // Servers publish against non-file URIs for synthetic sources (decompiled C#,
      // in-memory scratch buffers). No tab can exist for one.
      return;
    }

    const key = documentKey(filePath);
    const open = this.documents.find(key);
    if (open === null) {
      return;
    }

    const changed = this.diagnostics.set({
      documentKey: key,
      serverKey: diagnosticsServerKey(event.rootPath, event.serverId),
      diagnostics: toCodeDiagnostics(event.published, event.serverId),
    });
    if (!changed) {
      return;
    }

    // `open.filePath` deliberately, not the path derived from the server's URI — the
    // client matches this against the path it opened.
    this.emitDiagnostics(key, open);
  }

  /** Retract everything a now-dead server claimed, document by document. */
  private retractDiagnostics(event: { rootPath: string; serverId: string }): void {
    const affected = this.diagnostics.clearServer(
      diagnosticsServerKey(event.rootPath, event.serverId),
    );

    for (const key of affected) {
      const open = this.documents.find(key);
      if (open !== null) {
        this.emitDiagnostics(key, open);
      }
    }
  }

  private emitDiagnostics(key: string, open: { rootPath: string; filePath: string }): void {
    this.diagnosticsListener?.({
      rootPath: open.rootPath,
      filePath: open.filePath,
      diagnostics: this.diagnostics.merged(key),
    });
  }

  private publishActivity(): void {
    const busyRoots = this.pool.busyRoots();
    const key = [...busyRoots].sort().join(" ");
    if (key === this.lastBusyKey) {
      return;
    }
    this.lastBusyKey = key;
    this.activityListener?.(busyRoots);
  }

  /** Record the host's policy without touching anything already running. */
  setSettings(patch: Partial<LspSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.pool.setLimits({
      maxRunningServers: this.settings.maxRunningServers,
      idleMs: this.settings.idleMinutes * 60_000,
      backgroundIdleMs: this.settings.backgroundIdleMinutes * 60_000,
    });
  }

  /**
   * Apply the host's policy and make the world match it: anything the new settings
   * forbid is stopped now rather than left running until it happens to idle out. Off
   * has to mean off immediately, or the switch is decoration.
   */
  async applySettings(patch: Partial<LspSettings>): Promise<void> {
    this.setSettings(patch);

    if (!this.settings.enabled) {
      await this.pool.stopAll();
      return;
    }

    const forbidden = new Set(
      this.pool
        .rows()
        .filter((row) => !this.isRowEnabled(row))
        .map((row) => row.id),
    );

    for (const entry of this.running()) {
      if (forbidden.has(entry.serverId)) {
        await this.pool.stopServer(entry.rootPath, entry.serverId);
      }
    }
  }

  /**
   * Per-language state for the settings screen.
   *
   * `rootPath` null is the host-wide answer the screen actually wants: every row this
   * daemon knows, resolved against the rungs a host has. Settings is a host screen, so it
   * must be able to state the machine's capabilities without a workspace open. Passing a
   * root additionally probes that project's `node_modules/.bin`, the one rung that is
   * genuinely per-project, and narrows "running" to servers rooted there.
   */
  async languageStates(rootPath: string | null): Promise<LspLanguageState[]> {
    return Promise.all(
      this.pool.rows().map(async (row): Promise<LspLanguageState> => {
        const resolved = await resolveServerCommand(row, rootPath);
        return {
          id: row.id,
          enabled: this.isRowEnabled(row),
          installed: resolved !== null,
          running:
            rootPath === null
              ? this.pool.running().some((entry) => entry.serverId === row.id)
              : this.pool.peek(rootPath, row.id) !== null,
          rung: resolved?.rung ?? null,
          discovery: [...row.discovery],
          path: resolved?.command ?? null,
          bin: row.bin,
          extensions: [...row.extensions],
          indexCost: row.indexCost,
        };
      }),
    );
  }

  private isRowEnabled(row: LspServerRow): boolean {
    if (!this.settings.enabled) {
      return false;
    }
    return this.settings.languages[row.id] ?? row.defaultEnabled;
  }

  /**
   * Record the buffer, then bind it to the servers for its language — spawning them if
   * this is the first document of that language in the workspace.
   *
   * The binding is what makes diagnostics work at all, and it is a deliberate revision of
   * the original lazy-spawn rule ("no server starts until a code-intelligence action needs
   * it"). Opening a file *is* that action now: diagnostics are the one code-intelligence
   * feature the user never asks for by gesture, so waiting for a hover or a definition
   * lookup would mean a broken file looks clean until you happen to point at it.
   *
   * The cost controls are unchanged and are what make this affordable: the master switch,
   * the per-language toggles, the LRU cap, and idle reap. What is gone is only the case of
   * "a file of an enabled language is open and its server is not running" — which was never
   * a state worth preserving.
   */
  async syncDocument(input: SyncDocumentInput): Promise<void> {
    this.setActiveWorkspace(input.rootPath);
    await this.documents.sync(input);
    await this.documents.serversFor(input.rootPath, input.filePath);
  }

  async closeDocument(input: CloseDocumentInput): Promise<void> {
    await this.documents.close(input);
    // No broadcast: the tab that would have rendered these is gone. Keeping them would
    // also make the store grow for the lifetime of the daemon.
    this.diagnostics.clearDocument(documentKey(input.filePath));
  }

  /**
   * Servers bound to this document that can actually answer this request.
   *
   * Not every server on a file does everything: `oxlint` binds `.ts` beside the
   * TypeScript server and publishes diagnostics only. Filtering on the advertised
   * capability keeps a diagnostics-only server from turning every definition lookup into
   * a wasted round-trip — and, worse, from making the "every server failed" branch fire
   * when the one server that could answer succeeded.
   */
  private async capableServersFor(
    query: DefinitionQuery,
    feature: LspFeature,
  ): Promise<BoundServer[]> {
    this.setActiveWorkspace(query.rootPath);
    const bound = await this.documents.serversFor(query.rootPath, query.filePath);
    return bound.filter((entry) => entry.connection.supports(feature));
  }

  async definition(query: DefinitionQuery): Promise<DefinitionResult> {
    const bound = await this.capableServersFor(query, "definition");
    if (bound.length === 0) {
      return {
        status: "unavailable",
        locations: [],
        error: "No language server is available for this file on the host",
      };
    }

    const params = {
      textDocument: { uri: this.documents.uriFor(query.filePath) },
      // LSP is 0-based; the wire is 1-based. This is the only place that converts.
      position: { line: query.line - 1, character: query.column - 1 },
    };

    const answers = await Promise.all(
      bound.map(async (entry) => {
        try {
          const reply = await entry.connection.request<unknown>("textDocument/definition", params);
          return { ok: true as const, locations: normalizeDefinitionReply(reply, entry.serverId) };
        } catch (error) {
          this.logger.debug(
            { err: error, lspServer: entry.serverId },
            "definition request failed on one server",
          );
          return { ok: false as const, locations: [] as CodeDefinitionLocation[] };
        }
      }),
    );

    if (answers.every((answer) => !answer.ok)) {
      return {
        status: "unavailable",
        locations: [],
        error: "Every language server bound to this file failed to answer",
      };
    }

    const locations = dedupeLocations(answers.flatMap((answer) => answer.locations));
    if (locations.length === 0 && bound.some((entry) => entry.connection.isIndexing)) {
      return { status: "indexing", locations: [], error: null };
    }

    return { status: "ok", locations, error: null };
  }

  /**
   * The server's own explanation of the symbol under the caret. First server with
   * something to say wins — merging two servers' prose would read as gibberish, unlike
   * merging two sets of locations.
   */
  async hover(query: DefinitionQuery): Promise<HoverResult> {
    const bound = await this.capableServersFor(query, "hover");
    if (bound.length === 0) {
      return {
        status: "unavailable",
        markdown: null,
        range: null,
        serverId: null,
        error: "No language server is available for this file on the host",
      };
    }

    for (const entry of bound) {
      const reply = await this.ask(entry, "textDocument/hover", query);
      if (reply === undefined) {
        continue;
      }
      const parsed = HoverReplySchema.safeParse(reply);
      if (!parsed.success || parsed.data === null) {
        continue;
      }
      const markdown = hoverMarkdown(parsed.data.contents);
      if (markdown === null) {
        continue;
      }
      return {
        status: "ok",
        markdown,
        range: parsed.data.range === undefined ? null : toHoverRange(parsed.data.range),
        serverId: entry.serverId,
        error: null,
      };
    }

    // "Nothing to say" and "not warmed up yet" are the same empty reply on the wire,
    // and the client has to tell them apart: one retracts the tooltip, the other keeps
    // it open and asks again. Same rule as definition/references above.
    if (bound.some((entry) => entry.connection.isIndexing)) {
      return { status: "indexing", markdown: null, range: null, serverId: null, error: null };
    }

    return { status: "ok", markdown: null, range: null, serverId: null, error: null };
  }

  /** Every reference to the symbol under the caret, merged across bound servers. */
  async references(query: DefinitionQuery): Promise<ReferencesResult> {
    const bound = await this.capableServersFor(query, "references");
    if (bound.length === 0) {
      return {
        status: "unavailable",
        locations: [],
        error: "No language server is available for this file on the host",
      };
    }

    const answers = await Promise.all(
      bound.map(async (entry) => {
        const reply = await this.ask(entry, "textDocument/references", query, {
          context: { includeDeclaration: true },
        });
        return reply === undefined ? null : normalizeDefinitionReply(reply, entry.serverId);
      }),
    );

    if (answers.every((answer) => answer === null)) {
      return {
        status: "unavailable",
        locations: [],
        error: "Every language server bound to this file failed to answer",
      };
    }

    const locations = dedupeLocations(answers.flatMap((answer) => answer ?? []));

    // A NON-EMPTY answer from a still-loading server is the dangerous case, and the one
    // this used to report as `ok`. Measured on this repo: for 7 seconds after spawn,
    // `fromFileUri` returned 2 hits in 1 file when the truth is 14 in 4 — a complete-looking
    // answer that was 7x short. So indexing outranks having results: the caller is told the
    // list is provisional and gets the partial set to show meanwhile.
    if (bound.some((entry) => entry.connection.isIndexing)) {
      return { status: "indexing", locations, error: null };
    }
    return { status: "ok", locations, error: null };
  }

  /**
   * What a rename would do, and nothing else — no file is written here. The client puts
   * this in front of the user as a job to audit before applying, because a rename's blast
   * radius is the whole project and an inline rename box hides it behind one keystroke.
   */
  async renamePreview(query: RenameQuery): Promise<RenamePlan> {
    const bound = await this.capableServersFor(query, "rename");
    if (bound.length === 0) {
      return {
        status: "unavailable",
        files: [],
        fileCount: 0,
        editCount: 0,
        planId: "",
        error: "No language server is available for this file on the host",
      };
    }

    // Refused outright while any bound server is still building its project model. A
    // rename's whole purpose here is an auditable blast radius, and a plan produced against
    // a half-loaded program under-reports it — "1 file, 2 edits" for something that touches
    // 4 files and 14 sites. Every other request degrades to a bad answer; this one degrades
    // to a destructive edit, so it does not get to guess.
    if (bound.some((entry) => entry.connection.isIndexing)) {
      return {
        status: "indexing",
        files: [],
        fileCount: 0,
        editCount: 0,
        planId: "",
        error: null,
      };
    }

    for (const entry of bound) {
      const reply = await this.ask(entry, "textDocument/rename", query, {
        newName: query.newName,
      });
      if (reply === undefined) {
        continue;
      }
      const parsed = WorkspaceEditSchema.safeParse(reply);
      if (!parsed.success || parsed.data === null) {
        continue;
      }
      const ranges = toRenameFilePlans(parsed.data);
      if (ranges.length === 0) {
        continue;
      }

      // Every file the server named must be inside the workspace, checked HERE rather than
      // at apply: a plan that could never legally run should not be shown as if it could.
      const escaped = ranges.find((file) => !isInsideWorkspace(query.rootPath, file.path));
      if (escaped !== undefined) {
        this.logger.warn(
          { rootPath: query.rootPath, escapedPath: escaped.path },
          "refusing rename plan: language server named a file outside the workspace",
        );
        return {
          status: "unavailable",
          files: [],
          fileCount: 0,
          editCount: 0,
          planId: "",
          error: `The language server named a file outside this workspace (${escaped.path})`,
        };
      }

      // Reading the files here is what makes the job reversible and verifiable: each edit
      // records the text it expects to replace, which is the entire basis for detecting at
      // run time that something moved under us.
      const files = await capturePlannedFiles(ranges);
      const plan = this.jobs.putPlan(files, `rename:${query.newName}`);
      return {
        status: "ok",
        files: plan.files,
        fileCount: plan.fileCount,
        editCount: plan.editCount,
        planId: plan.planId,
        error: null,
      };
    }

    return { status: "ok", files: [], fileCount: 0, editCount: 0, planId: "", error: null };
  }

  /**
   * One position-based request to one server. Returns `undefined` when that server
   * failed, which callers treat as "this one had nothing" rather than as an error — one
   * server answering is success.
   */
  private async ask(
    entry: BoundServer,
    method: string,
    query: DefinitionQuery,
    extra?: Record<string, unknown>,
  ): Promise<unknown | undefined> {
    try {
      return await entry.connection.request<unknown>(method, {
        textDocument: { uri: this.documents.uriFor(query.filePath) },
        // LSP is 0-based; the wire is 1-based.
        position: { line: query.line - 1, character: query.column - 1 },
        ...extra,
      });
    } catch (error) {
      this.logger.debug(
        { err: error, lspServer: entry.serverId, method },
        "language server request failed",
      );
      return undefined;
    }
  }

  /**
   * Run a rename the user audited.
   *
   * **The stored plan is executed — not one re-derived now.** A deliberate reversal of the
   * first design, which recomputed the plan and refused on any difference. The property that
   * design was really protecting was never *recomputation*; it was *the client is not the
   * author of the edits* — and keeping the plan daemon-side preserves that exactly while
   * giving the user what a dry run actually promises: the edits you approved are the edits
   * that run. Recomputing also refused the whole job whenever anything moved, and in a
   * product whose agents write files continuously that is the common case, not the rare one.
   *
   * Safety moved from all-or-nothing to per-edit: each edit carries the text it expects to
   * replace, so a file that changed underneath loses only the edits whose ground truth moved,
   * and those are named rather than silently dropped. Every write is journalled, so
   * `renameUndo` can take the whole run back.
   */
  async renameApply(query: RenameApplyQuery): Promise<RenameApplyResult> {
    const plan = this.jobs.getPlan(query.planId);
    if (plan === null) {
      return {
        status: "expired",
        runId: null,
        files: [],
        appliedFiles: 0,
        appliedEdits: 0,
        skippedEdits: 0,
        complete: false,
        error:
          "The host no longer holds this plan. Plan the rename again to see its current impact.",
      };
    }

    // Re-checked at run time, not merely when the plan was made: a plan can sit on screen
    // while a workspace is reconfigured, and a path that has since escaped must not be written.
    const escaped = plan.files.find((file) => !isInsideWorkspace(query.rootPath, file.path));
    if (escaped !== undefined) {
      this.logger.warn(
        { rootPath: query.rootPath, escapedPath: escaped.path },
        "refusing rename: plan names a file outside the workspace",
      );
      return {
        status: "escaped",
        runId: null,
        files: [],
        appliedFiles: 0,
        appliedEdits: 0,
        skippedEdits: 0,
        complete: false,
        error: `The plan names a file outside this workspace (${escaped.path})`,
      };
    }

    const outcome = await this.jobs.run(plan);
    return {
      status: "ok",
      runId: outcome.runId,
      files: outcome.files,
      appliedFiles: outcome.appliedFiles,
      appliedEdits: outcome.appliedEdits,
      skippedEdits: outcome.skippedEdits,
      complete: outcome.complete,
      error: null,
    };
  }

  /**
   * Put a run back.
   *
   * Only files still holding exactly what the run wrote are restored. Anything edited since
   * is reported and left alone — a blind restore would destroy that work, which is a worse
   * outcome than not undoing.
   */
  async renameUndo(runId: string): Promise<RenameUndoResult> {
    const outcome = await this.jobs.undo(runId);
    if (outcome === null) {
      return {
        status: "expired",
        files: [],
        restoredFiles: 0,
        complete: false,
        error: "The host no longer holds this run, so it cannot be undone from here.",
      };
    }
    return {
      status: "ok",
      files: outcome.files,
      restoredFiles: outcome.restoredFiles,
      complete: outcome.complete,
      error: null,
    };
  }

  /**
   * Escape hatch for tests that need to drive a specific server directly. Not part of
   * the RPC surface.
   */
  requestOnServer<R>(rootPath: string, serverId: string, method: string): Promise<R> {
    const connection = this.pool.peek(rootPath, serverId);
    if (connection === null) {
      throw new Error(`No running ${serverId} server for ${rootPath}`);
    }
    return connection.request<R>(method, null);
  }

  running(): RunningServer[] {
    return this.pool.running();
  }

  openDocumentCount(): number {
    return this.documents.openCount();
  }

  /**
   * Which workspace the user is looking at, which is what separates the idle allowance
   * from the much shorter background one.
   *
   * Called from this service's own request path rather than pushed by the client: there is
   * no focus signal on the wire, and every code-intelligence request already *is* one —
   * a hover, a definition lookup or a buffer sync only happens for the file in front of
   * someone. Inventing a second signal would give the idle policy two sources of truth,
   * and the one that goes stale is the one that leaves servers running.
   */
  setActiveWorkspace(rootPath: string | null): void {
    const key = rootPath === null ? null : documentKey(rootPath);
    if (key === this.activeWorkspaceKey) {
      return;
    }
    this.activeWorkspaceKey = key;
    this.pool.setActiveWorkspace(rootPath);
  }

  async reapIdle(): Promise<void> {
    await this.pool.reapIdle();
  }

  async stopServer(rootPath: string, serverId: string): Promise<void> {
    await this.pool.stopServer(rootPath, serverId);
  }

  async stopWorkspace(rootPath: string): Promise<void> {
    await this.documents.closeWorkspace(rootPath);
    await this.pool.stopWorkspace(rootPath);
  }

  async stopAll(): Promise<void> {
    await this.pool.stopAll();
  }
}

/**
 * One server's identity as a diagnostics publisher. Must include the workspace: the same
 * registry row runs once per workspace, and two of them publishing about the same absolute
 * path is possible whenever a file is reachable from two roots.
 */
function diagnosticsServerKey(rootPath: string, serverId: string): string {
  return `${documentKey(rootPath)} ${serverId}`;
}

/**
 * Read each planned file once and record, for every edit, the text it would replace.
 *
 * This is the step that turns a description of a change into a job that can be verified and
 * reversed. One read per file, and only at plan time — the run itself re-reads to check that
 * nothing moved since.
 *
 * A file that cannot be read keeps its edits with an empty `oldText`, which the run will
 * refuse to match. Dropping it here instead would quietly shrink the blast radius the user is
 * being shown, and under-reporting impact is the one thing this whole surface exists to
 * prevent.
 */
async function capturePlannedFiles(ranges: readonly RenameFileRanges[]): Promise<PlannedFile[]> {
  const captured: PlannedFile[] = [];

  for (const file of ranges) {
    let text: string;
    try {
      text = await readFile(file.path, "utf8");
    } catch {
      captured.push({ path: file.path, edits: file.edits.map(withoutGroundTruth) });
      continue;
    }
    const lineStarts = buildLineStarts(text);
    captured.push({
      path: file.path,
      edits: file.edits.map((edit) =>
        groundEdit(
          edit,
          text.slice(
            offsetOf(lineStarts, text.length, edit.line, edit.column),
            offsetOf(lineStarts, text.length, edit.endLine, edit.endColumn),
          ),
        ),
      ),
    });
  }

  return captured;
}

/** An edit paired with the text it expects to replace. */
function groundEdit(edit: Omit<PlannedEdit, "oldText">, oldText: string): PlannedEdit {
  return {
    line: edit.line,
    column: edit.column,
    endLine: edit.endLine,
    endColumn: edit.endColumn,
    newText: edit.newText,
    oldText,
  };
}

/**
 * An edit with no ground truth, for a file that could not be read. The run will refuse to
 * match it — which is the point: an unreadable file must not quietly shrink the blast radius
 * the user is shown.
 */
function withoutGroundTruth(edit: Omit<PlannedEdit, "oldText">): PlannedEdit {
  return groundEdit(edit, "");
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

/** 1-based line/column to an offset, clamped to the document. */
function offsetOf(
  lineStarts: readonly number[],
  length: number,
  line: number,
  column: number,
): number {
  const start = lineStarts[Math.min(Math.max(line, 1), lineStarts.length) - 1];
  return Math.min(start + Math.max(0, column - 1), length);
}

function normalizeDefinitionReply(reply: unknown, serverId: string): CodeDefinitionLocation[] {
  const parsed = DefinitionReplySchema.safeParse(reply);
  if (!parsed.success || parsed.data === null) {
    return [];
  }

  const entries = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const locations: CodeDefinitionLocation[] = [];

  for (const entry of entries) {
    const location = toDefinitionLocation(entry, serverId);
    if (location !== null) {
      locations.push(location);
    }
  }
  return locations;
}

type DefinitionEntry = z.infer<typeof LocationSchema> | z.infer<typeof LocationLinkSchema>;

function toDefinitionLocation(
  entry: DefinitionEntry,
  serverId: string,
): CodeDefinitionLocation | null {
  const isLink = "targetUri" in entry;
  const uri = isLink ? entry.targetUri : entry.uri;
  const range = isLink ? (entry.targetSelectionRange ?? entry.targetRange) : entry.range;

  let filePath: string;
  try {
    filePath = fromFileUri(uri);
  } catch {
    // A server may answer with a non-file URI for a decompiled or in-memory source;
    // there is nothing for the editor to open, so drop it.
    return null;
  }

  return {
    path: filePath,
    line: range.start.line + 1,
    column: range.start.character + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.character + 1,
    serverId,
  };
}

function dedupeLocations(locations: readonly CodeDefinitionLocation[]): CodeDefinitionLocation[] {
  const seen = new Set<string>();
  const unique: CodeDefinitionLocation[] = [];

  for (const location of locations) {
    const key = `${location.path}:${location.line}:${location.column}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(location);
  }
  return unique;
}

function hoverMarkdown(contents: z.infer<typeof HoverContentsSchema>): string | null {
  const parts = (Array.isArray(contents) ? contents : [contents]).map((part) => {
    if (typeof part === "string") {
      return part;
    }
    if ("kind" in part) {
      return part.value;
    }
    // A language-tagged marked string is a code block once rendered.
    return `\`\`\`${part.language}\n${part.value}\n\`\`\``;
  });

  const markdown = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
  return markdown.length === 0 ? null : markdown;
}

function toHoverRange(range: z.infer<typeof RangeSchema>): HoverRange {
  return {
    line: range.start.line + 1,
    column: range.start.character + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

/**
 * A `WorkspaceEdit` into per-file plans, sorted so a preview reads top to bottom: files
 * by path, edits by position. Servers make no ordering promise, and an out-of-order
 * audit list is unreadable.
 */
function toRenameFilePlans(
  edit: Exclude<z.infer<typeof WorkspaceEditSchema>, null>,
): RenameFileRanges[] {
  const plans: RenameFileRanges[] = [];

  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    let filePath: string;
    try {
      filePath = fromFileUri(uri);
    } catch {
      continue;
    }
    if (edits.length === 0) {
      continue;
    }
    plans.push({
      path: filePath,
      edits: edits
        .map((entry) => ({
          line: entry.range.start.line + 1,
          column: entry.range.start.character + 1,
          endLine: entry.range.end.line + 1,
          endColumn: entry.range.end.character + 1,
          newText: entry.newText,
        }))
        .sort((a, b) => a.line - b.line || a.column - b.column),
    });
  }

  return plans.sort((a, b) => a.path.localeCompare(b.path));
}
