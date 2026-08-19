import { z } from "zod";

/**
 * Otto code-intelligence wire schemas: the code.* symbol, definition, hover,
 * references, rename and solution RPCs, plus the lsp.* server-state RPCs and
 * pushes (see docs/code-intelligence.md).
 *
 * Declaration order matters here: the Solution schemas first because the Code
 * responses embed them, then Code, then Lsp, which embeds CodeDiagnosticSchema. These are top-level consts, so a
 * schema referenced before its declaration is a ReferenceError at module
 * evaluation (and in the zod-aot build), not a type error.
 *
 * Code intelligence is a fork-only capability, so its schemas live in their own
 * protocol module rather than inside messages.ts. messages.ts re-exports them.
 */

/**
 * Solution view responses (projects/solution-view).
 *
 * COMPAT(solutionView): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
 */
export const SolutionFormatSchema = z.enum(["sln", "slnx"]);

/** One solution a workspace contains. Enough to populate the switcher's picker, nothing more. */
export const SolutionRefSchema = z.object({
  /** Workspace-relative, forward slashes - the identity used by every later request. */
  path: z.string(),
  /** File name without the extension, which is what a .NET developer calls the solution. */
  name: z.string(),
  format: SolutionFormatSchema,
});

/**
 * Solution structure is flat on the wire with parent links, not nested.
 *
 * A recursive payload would have to be walked to be used, and every consumer would write that
 * walk again; the file explorer already turns a flat listing plus an expanded-path set into rows,
 * so this hands it the same shape it already consumes.
 */
export const SolutionTreeFolderSchema = z.object({
  /** Solution-internal, e.g. `/Src/`. Folders are virtual: they have no filesystem location. */
  path: z.string(),
  name: z.string(),
  parentPath: z.string().nullable(),
});

export const SolutionTreeProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * Workspace-relative when the project sits inside the workspace, absolute (forward-slashed)
   * when it does not. `outsideWorkspace` says which, so nothing has to guess by inspecting the
   * string.
   */
  path: z.string(),
  /**
   * A project the solution names outside the workspace root. Shown and opened like any other -
   * the solution file is the authority naming it, so this is not free browsing - but editing one
   * warns, and it is absent from every git surface. See docs/solution-view.md.
   */
  outsideWorkspace: z.boolean(),
  /** The solution folder containing it, or null for a project at the solution root. */
  folderPath: z.string().nullable(),
  /** Project type GUID, lowercased. Absent on old daemons. */
  typeId: z.string().optional(),
});

/**
 * Three-valued for the same reason the code-intelligence family is: "the host cannot supply
 * this", "MSBuild refused this project", and "here are its files" are different things to tell a
 * user, and reporting the first two as an empty file list is how a working feature reads as
 * broken. One project that fails must not blank the tree, so this status is per project.
 */
export const SolutionProjectStatusSchema = z.enum(["ok", "failed", "unavailable"]);

/**
 * One entry in a project's evaluated membership, flat with parent links like the folders above.
 *
 * `isImplicit` is what a filesystem tree structurally cannot show and what Phase 2 turns on: an
 * item contributed by the SDK's default globs is one that creating the file already adds, while
 * an item the project file itself declares needs a real `.csproj` edit.
 */
export const SolutionProjectNodeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("directory"),
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    path: z.string(),
    outsideWorkspace: z.boolean(),
  }),
  z.object({
    kind: z.literal("file"),
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    path: z.string(),
    outsideWorkspace: z.boolean(),
    /** `Compile`, `Content`, `EmbeddedResource`, … - MSBuild's own item type. */
    itemType: z.string(),
    isImplicit: z.boolean(),
  }),
]);

export const SolutionPackageReferenceSchema = z.object({
  name: z.string(),
  version: z.string().nullable(),
});

export type SolutionFormat = z.infer<typeof SolutionFormatSchema>;

export type SolutionRef = z.infer<typeof SolutionRefSchema>;

export type SolutionTreeFolder = z.infer<typeof SolutionTreeFolderSchema>;

export type SolutionTreeProject = z.infer<typeof SolutionTreeProjectSchema>;

export type SolutionProjectStatus = z.infer<typeof SolutionProjectStatusSchema>;

export type SolutionProjectNode = z.infer<typeof SolutionProjectNodeSchema>;

export type SolutionPackageReference = z.infer<typeof SolutionPackageReferenceSchema>;

// ctags-style navigation (no LSP). All three are daemon RPCs so the client
// never touches the filesystem; the symbol index is name-based and honest.
export const CodeListFilesRequestSchema = z.object({
  type: z.literal("code.list_files.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CodeSymbolsRequestSchema = z.object({
  type: z.literal("code.symbols.request"),
  cwd: z.string(),
  name: z.string(),
  requestId: z.string(),
});

export const CodeOutlineRequestSchema = z.object({
  type: z.literal("code.outline.request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

/**
 * LSP-backed code intelligence (projects/lsp-code-intelligence). Distinct from the
 * ctags `code.symbols` RPC above in the only way that matters: it carries a
 * **position**, so the daemon can resolve the reference under the cursor instead of
 * matching a name.
 *
 * Line and column are **1-based** here, matching `CodeSymbolLocation` and the rest of
 * Otto. LSP itself is 0-based; that conversion is the daemon's business and does not
 * reach the wire.
 */
export const CodeDefinitionRequestSchema = z.object({
  type: z.literal("code.definition.request"),
  cwd: z.string(),
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  requestId: z.string(),
});

/**
 * The editor's current buffer text, so definitions resolve against unsaved edits
 * rather than stale disk content. Sent debounced, not per keystroke.
 */
export const CodeDocumentSyncRequestSchema = z.object({
  type: z.literal("code.document.sync.request"),
  cwd: z.string(),
  path: z.string(),
  text: z.string(),
  requestId: z.string(),
});

export const CodeDocumentCloseRequestSchema = z.object({
  type: z.literal("code.document.close.request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

/**
 * The rest of the position-based code-intelligence family. All three carry a 1-based
 * position like `code.definition`, and all three are answered against the mirrored
 * buffer rather than the file on disk.
 */
export const CodeHoverRequestSchema = z.object({
  type: z.literal("code.hover.request"),
  cwd: z.string(),
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  requestId: z.string(),
});

export const CodeReferencesRequestSchema = z.object({
  type: z.literal("code.references.request"),
  cwd: z.string(),
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  requestId: z.string(),
});

/**
 * A rename **dry run**. Deliberately not "do the rename": the daemon computes every edit
 * and returns them for the user to audit, because a rename's blast radius is the whole
 * project. Nothing is written by this request.
 */
export const CodeRenamePreviewRequestSchema = z.object({
  type: z.literal("code.rename.preview.request"),
  cwd: z.string(),
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  newName: z.string().min(1),
  requestId: z.string(),
});

/**
 * Execute a rename the user has audited. **The edits are deliberately NOT on this request.**
 *
 * The client sends back only the `planId` it was shown; the daemon recomputes the plan and
 * refuses unless the identity matches. A request that carried its own edit list would be a
 * remote arbitrary-write primitive wearing a rename's name - any client could post any text
 * at any path. This shape makes the daemon's own language server the sole author of what
 * gets written, and the plan id the proof that the user saw it.
 */
export const CodeRenameApplyRequestSchema = z.object({
  type: z.literal("code.rename.apply.request"),
  cwd: z.string(),
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  newName: z.string().min(1),
  /** From the preview response. Identity of the exact plan the user approved. */
  planId: z.string().min(1),
  requestId: z.string(),
});

/**
 * Undo a run. Carries only the run's id - the daemon holds the before-images.
 *
 * Declared here, with the other inbound rename schemas, rather than beside its response
 * further down: `SessionInboundMessageSchema` is a top-level const, so a schema it names
 * must already be initialized when that line runs. Below the union it is a
 * ReferenceError at import time, not a type error.
 */
export const CodeRenameUndoRequestSchema = z.object({
  type: z.literal("code.rename.undo.request"),
  cwd: z.string(),
  runId: z.string().min(1),
  requestId: z.string(),
});

/**
 * The Solution view (projects/solution-view). A second lens on the Files module showing the tree
 * as the build system sees it rather than as the filesystem lays it out.
 *
 * **Independent of the LSP family above, despite sharing the `code.` domain.** There is no
 * project-structure request in the Language Server Protocol - not one Otto has yet to wire, one
 * that does not exist - so this subsystem builds its own model through Microsoft's solution
 * libraries. Turning C# code intelligence off does not turn this off, and vice versa.
 *
 * Discovery is separate from loading on purpose: `list` decides whether the switcher appears at
 * all, so it runs for every workspace and must stay cheap (a directory walk, no process). Only
 * `get_tree` reaches the .NET sidecar.
 *
 * COMPAT(solutionView): added in v0.6.8; gate lives in features.solutionView.
 */
export const CodeSolutionListRequestSchema = z.object({
  type: z.literal("code.solution.list.request"),
  cwd: z.string(),
  requestId: z.string(),
});

/**
 * One solution's organisation: folders, the projects inside them, and the configurations. No file
 * membership - that is `load_project`, paid per project on expand, because evaluating fifty
 * projects to render a collapsed tree is the cost this design exists to avoid.
 */
export const CodeSolutionGetTreeRequestSchema = z.object({
  type: z.literal("code.solution.get_tree.request"),
  cwd: z.string(),
  /** Workspace-relative, as reported by `list`. */
  solutionPath: z.string(),
  requestId: z.string(),
});

/**
 * One project's evaluated file membership. `solutionPath` scopes the sidecar instance so two
 * solutions in one repo never share a warm `ProjectCollection` - and so Phase 4 has the selection
 * it needs for `--solution`.
 */
export const CodeSolutionLoadProjectRequestSchema = z.object({
  type: z.literal("code.solution.load_project.request"),
  cwd: z.string(),
  solutionPath: z.string(),
  /** Workspace-relative, or absolute when the solution names a project outside the workspace. */
  projectPath: z.string(),
  requestId: z.string(),
});

/**
 * Compiler severity, named rather than numbered. LSP uses 1–4; a magic number on the
 * wire would have every consumer re-deriving which one is a warning.
 */
export const CodeDiagnosticSeveritySchema = z.enum(["error", "warning", "info", "hint"]);

/** One problem the language server reported, 1-based like every other position. */
export const CodeDiagnosticSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive(),
  severity: CodeDiagnosticSeveritySchema,
  message: z.string(),
  /** Who says so - `ts`, `pyright`, a linter behind the server. */
  source: z.string().optional(),
  /** The server's own code for the rule or error, e.g. TypeScript's `2345`. */
  code: z.string().optional(),
  /** Documentation for that rule, when the server offers one - oxlint does. */
  codeHref: z.string().optional(),
  /** Which registry row published it, so two servers on one file stay attributable. */
  serverId: z.string().optional(),
});

export const CodeListFilesResponseSchema = z.object({
  type: z.literal("code.list_files.response"),
  payload: z.object({
    cwd: z.string(),
    files: z.array(z.string()),
    truncated: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeSymbolKindSchema = z.enum(["function", "class", "type", "variable", "property"]);

export const CodeSymbolLocationSchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: CodeSymbolKindSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const CodeSymbolsResponseSchema = z.object({
  type: z.literal("code.symbols.response"),
  payload: z.object({
    cwd: z.string(),
    name: z.string(),
    locations: z.array(CodeSymbolLocationSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

/** 1-based, like `CodeSymbolLocation`. The end pair is present when the server gave a range. */
export const CodeDefinitionLocationSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
  /**
   * Which registry row answered (`typescript`, `csharp`, …). The multi-hit picker
   * shows it, so a user looking at two candidates can tell whether a language server
   * resolved them or the name index guessed - which changes how much to trust the
   * list. Absent from old daemons.
   */
  serverId: z.string().optional(),
});

/**
 * Three-valued on purpose. `unavailable` (no server for this language on the host) and
 * `indexing` (the server is up but still building its project model) are different
 * answers to the user, and neither is "not found" - reporting either as an empty
 * result is how a working feature reads as broken.
 */
export const CodeDefinitionStatusSchema = z.enum(["ok", "indexing", "unavailable"]);

export const CodeDefinitionResponseSchema = z.object({
  type: z.literal("code.definition.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    status: CodeDefinitionStatusSchema,
    locations: z.array(CodeDefinitionLocationSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeDocumentSyncResponseSchema = z.object({
  type: z.literal("code.document.sync.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeDocumentCloseResponseSchema = z.object({
  type: z.literal("code.document.close.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

/** 1-based, like every other position on the wire. */
export const CodeHoverRangeSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive(),
});

export const CodeHoverResponseSchema = z.object({
  type: z.literal("code.hover.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    status: CodeDefinitionStatusSchema,
    /** Markdown, or null when the server had nothing to say about this position. */
    markdown: z.string().nullable(),
    range: CodeHoverRangeSchema.nullable(),
    serverId: z.string().nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeReferencesResponseSchema = z.object({
  type: z.literal("code.references.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    status: CodeDefinitionStatusSchema,
    locations: z.array(CodeDefinitionLocationSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeRenameEditSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive(),
  newText: z.string(),
  /**
   * The text this edit expects to replace. Carried so the dry run can show what is being
   * changed rather than only what it becomes - and, on the daemon side, so the run can tell
   * that a file moved under the plan. For a rename this is always one identifier.
   */
  oldText: z.string().default(""),
});

export const CodeRenameFilePlanSchema = z.object({
  path: z.string(),
  edits: z.array(CodeRenameEditSchema),
});

export const CodeRenamePreviewResponseSchema = z.object({
  type: z.literal("code.rename.preview.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    newName: z.string(),
    status: CodeDefinitionStatusSchema,
    /** Sorted by path, and by position within each file, so an audit reads in order. */
    files: z.array(CodeRenameFilePlanSchema),
    /** Blast radius, so the dry-run tab can lead with it. */
    fileCount: z.number().int().nonnegative(),
    editCount: z.number().int().nonnegative(),
    /**
     * Identity of this exact plan, echoed back on apply. Computed by the daemon so there is
     * one definition of "the same plan" rather than two that can drift apart.
     */
    planId: z.string().default(""),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

/**
 * Five-valued, because the ways a rename can fail to happen are things a user needs told
 * apart: still loading, no server, the plan moved, or the server pointed outside the
 * workspace. Collapsing them into one failure is how "nothing happened" becomes unexplainable.
 */
/**
 * Whether the run HAPPENED - deliberately not whether everything applied.
 *
 * A run where two of fourteen edits no longer fit is still a run that took place, and the
 * twelve that landed are real. Collapsing that into a failure would hide them, and hiding a
 * write is the one thing an auditable edit surface must never do. Per-edit fate lives in the
 * file outcomes; `complete` is the single-glance answer.
 */
export const CodeRenameApplyStatusSchema = z.enum(["ok", "expired", "escaped"]);

export const CodeRenameFileOutcomeKindSchema = z.enum(["applied", "partial", "failed"]);

/** What happened to one file in a run. */
export const CodeRenameFileOutcomeSchema = z.object({
  path: z.string(),
  kind: CodeRenameFileOutcomeKindSchema,
  appliedEdits: z.number().int().nonnegative(),
  skippedEdits: z.number().int().nonnegative(),
  /** Why, whenever anything was skipped or the file failed outright. */
  reason: z.string().nullable(),
});

export const CodeRenameUndoStatusSchema = z.enum(["ok", "expired"]);

export const CodeRenameUndoFileKindSchema = z.enum(["restored", "changedSince", "failed"]);

/**
 * What happened to one file during an undo. `changedSince` is the important one: the file was
 * edited after the run, so restoring would have destroyed that work and it was left alone.
 */
export const CodeRenameUndoFileSchema = z.object({
  path: z.string(),
  kind: CodeRenameUndoFileKindSchema,
  reason: z.string().nullable(),
});

export const CodeRenameUndoResponseSchema = z.object({
  type: z.literal("code.rename.undo.response"),
  payload: z.object({
    cwd: z.string(),
    runId: z.string(),
    status: CodeRenameUndoStatusSchema,
    files: z.array(CodeRenameUndoFileSchema),
    restoredFiles: z.number().int().nonnegative(),
    /** True only when every file the run wrote was put back. */
    complete: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeRenameApplyResponseSchema = z.object({
  type: z.literal("code.rename.apply.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    newName: z.string(),
    status: CodeRenameApplyStatusSchema,
    /** Identity of this run, for undo. Null when nothing ran. */
    runId: z.string().nullable(),
    files: z.array(CodeRenameFileOutcomeSchema),
    appliedFiles: z.number().int().nonnegative(),
    appliedEdits: z.number().int().nonnegative(),
    skippedEdits: z.number().int().nonnegative(),
    /** True only when every planned edit landed. */
    complete: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeSolutionListResponseSchema = z.object({
  type: z.literal("code.solution.list.response"),
  payload: z.object({
    cwd: z.string(),
    /**
     * Empty means the switcher never appears and the Files tab behaves exactly as it does today.
     * That is also what a disabled feature, a host with no .NET SDK, and a workspace with no
     * solution all return - the client has one silent case to handle, not four.
     */
    solutions: z.array(SolutionRefSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeSolutionGetTreeResponseSchema = z.object({
  type: z.literal("code.solution.get_tree.response"),
  payload: z.object({
    cwd: z.string(),
    solutionPath: z.string(),
    name: z.string().default(""),
    format: SolutionFormatSchema.default("sln"),
    folders: z.array(SolutionTreeFolderSchema),
    projects: z.array(SolutionTreeProjectSchema),
    /** Solution configurations and platforms - first-class .NET concepts no CLI surfaces. */
    buildTypes: z.array(z.string()),
    platforms: z.array(z.string()),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeSolutionLoadProjectResponseSchema = z.object({
  type: z.literal("code.solution.load_project.response"),
  payload: z.object({
    cwd: z.string(),
    solutionPath: z.string(),
    projectPath: z.string(),
    status: SolutionProjectStatusSchema,
    nodes: z.array(SolutionProjectNodeSchema),
    projectReferences: z.array(z.string()),
    packageReferences: z.array(SolutionPackageReferenceSchema),
    targetFrameworks: z.array(z.string()),
    outputType: z.string().nullable(),
    isSdkStyle: z.boolean(),
    /** MSBuild's own message when `status` is `failed`, verbatim. */
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeOutlineResponseSchema = z.object({
  type: z.literal("code.outline.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    symbols: z.array(CodeSymbolLocationSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export type CodeListFilesRequest = z.infer<typeof CodeListFilesRequestSchema>;

export type CodeListFilesResponse = z.infer<typeof CodeListFilesResponseSchema>;

export type CodeSymbolsRequest = z.infer<typeof CodeSymbolsRequestSchema>;

export type CodeSymbolsResponse = z.infer<typeof CodeSymbolsResponseSchema>;

export type CodeOutlineRequest = z.infer<typeof CodeOutlineRequestSchema>;

export type CodeOutlineResponse = z.infer<typeof CodeOutlineResponseSchema>;

export type CodeSymbolLocation = z.infer<typeof CodeSymbolLocationSchema>;

export type CodeSymbolKind = z.infer<typeof CodeSymbolKindSchema>;

export type CodeDefinitionRequest = z.infer<typeof CodeDefinitionRequestSchema>;

export type CodeDefinitionResponse = z.infer<typeof CodeDefinitionResponseSchema>;

export type CodeDefinitionLocation = z.infer<typeof CodeDefinitionLocationSchema>;

export type CodeDefinitionStatus = z.infer<typeof CodeDefinitionStatusSchema>;

export type CodeDocumentSyncRequest = z.infer<typeof CodeDocumentSyncRequestSchema>;

export type CodeDocumentSyncResponse = z.infer<typeof CodeDocumentSyncResponseSchema>;

export type CodeDocumentCloseRequest = z.infer<typeof CodeDocumentCloseRequestSchema>;

export type CodeDocumentCloseResponse = z.infer<typeof CodeDocumentCloseResponseSchema>;

export type CodeHoverRequest = z.infer<typeof CodeHoverRequestSchema>;

export type CodeHoverResponse = z.infer<typeof CodeHoverResponseSchema>;

export type CodeHoverRange = z.infer<typeof CodeHoverRangeSchema>;

export type CodeReferencesRequest = z.infer<typeof CodeReferencesRequestSchema>;

export type CodeReferencesResponse = z.infer<typeof CodeReferencesResponseSchema>;

export type CodeRenamePreviewRequest = z.infer<typeof CodeRenamePreviewRequestSchema>;

export type CodeRenamePreviewResponse = z.infer<typeof CodeRenamePreviewResponseSchema>;

export type CodeRenameApplyRequest = z.infer<typeof CodeRenameApplyRequestSchema>;

export type CodeRenameApplyResponse = z.infer<typeof CodeRenameApplyResponseSchema>;

export type CodeRenameApplyStatus = z.infer<typeof CodeRenameApplyStatusSchema>;

export type CodeRenameFileOutcome = z.infer<typeof CodeRenameFileOutcomeSchema>;

export type CodeRenameUndoRequest = z.infer<typeof CodeRenameUndoRequestSchema>;

export type CodeRenameUndoResponse = z.infer<typeof CodeRenameUndoResponseSchema>;

export type CodeRenameUndoStatus = z.infer<typeof CodeRenameUndoStatusSchema>;

export type CodeRenameUndoFile = z.infer<typeof CodeRenameUndoFileSchema>;

export type CodeRenameEdit = z.infer<typeof CodeRenameEditSchema>;

export type CodeRenameFilePlan = z.infer<typeof CodeRenameFilePlanSchema>;

export type CodeSolutionListRequest = z.infer<typeof CodeSolutionListRequestSchema>;

export type CodeSolutionListResponse = z.infer<typeof CodeSolutionListResponseSchema>;

export type CodeSolutionGetTreeRequest = z.infer<typeof CodeSolutionGetTreeRequestSchema>;

export type CodeSolutionGetTreeResponse = z.infer<typeof CodeSolutionGetTreeResponseSchema>;

export type CodeSolutionLoadProjectRequest = z.infer<typeof CodeSolutionLoadProjectRequestSchema>;

export type CodeSolutionLoadProjectResponse = z.infer<typeof CodeSolutionLoadProjectResponseSchema>;

export type CodeDiagnosticSeverity = z.infer<typeof CodeDiagnosticSeveritySchema>;

export type CodeDiagnostic = z.infer<typeof CodeDiagnosticSchema>;

/**
 * Live language-server state for the Daemon → Code screen. Separate from the daemon
 * config RPCs because none of it is configuration: which servers this machine can
 * actually supply, and which are running right now.
 *
 * Omit `cwd` for the host-wide answer, which is what the settings screen asks for: every
 * row this daemon knows, resolved against the rungs a host has (bundled, PATH). Passing a
 * `cwd` additionally probes that workspace's `node_modules/.bin`, since a server can be
 * present in one project and absent from another. Optional rather than removed because
 * older clients still send it.
 *
 * COMPAT(lspHostServers): `cwd` became optional in v0.7.3; gate lives in
 * features.lspHostServers.
 */
export const LspServersListRequestSchema = z.object({
  type: z.literal("lsp.servers.list.request"),
  cwd: z.string().optional(),
  requestId: z.string(),
});

/** Stop one running server, so a user who suspects it of hogging memory can kill it. */
export const LspServerStopRequestSchema = z.object({
  type: z.literal("lsp.server.stop.request"),
  rootPath: z.string(),
  serverId: z.string(),
  requestId: z.string(),
});

/**
 * Which workspaces currently have a language server starting up or indexing. Sent as
 * the whole busy set rather than per-workspace transitions: the only consumer is a
 * spinner, so an idempotent snapshot cannot drift out of sync the way a missed
 * transition would.
 *
 * Separate from the workspace status bucket on purpose - indexing is not the workspace
 * "working", and folding it in would mislabel a quiet workspace as busy with agent work.
 */
export const LspActivityChangedStatusPayloadSchema = z
  .object({
    status: z.literal("lsp_activity_changed"),
    /** Absolute workspace roots with language-server work in flight. */
    busyRoots: z.array(z.string()),
  })
  .passthrough();

/**
 * Diagnostics for one open document, pushed unsolicited.
 *
 * This is the one part of code intelligence that is not request/response:
 * `textDocument/publishDiagnostics` arrives whenever the server has recomputed, which is
 * whenever it feels like it. So it is a status broadcast, and the payload is the document's
 * **whole** current set - never a delta. A missed delta would leave a stale squiggle on a
 * line the user already fixed, and an idempotent snapshot cannot drift.
 *
 * Only documents a client has synced produce these. A server may know about every file in
 * the project; pushing all of it would be unbounded, and nothing can render a marker in a
 * file that is not open.
 */
export const LspDiagnosticsChangedStatusPayloadSchema = z
  .object({
    status: z.literal("lsp_diagnostics_changed"),
    /** Workspace root the document belongs to. */
    cwd: z.string(),
    /** Absolute path of the document these describe. */
    path: z.string(),
    diagnostics: z.array(CodeDiagnosticSchema),
  })
  .passthrough();

export const LspLanguageStateSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  /** Whether the host can actually supply this server right now. */
  installed: z.boolean(),
  running: z.boolean(),
  /** Which discovery rung supplied it (`workspaceBin` / `bundled` / `path`), or null. */
  rung: z.string().nullable(),
  bin: z.string(),
  /**
   * Every rung this row can ever be supplied from, in resolution order. A row whose only
   * rung is `workspaceBin` is supplied by the project it runs in and by nothing else, so
   * `installed: false` from a host-wide check means "the project brings it", not "missing".
   */
  discovery: z.array(z.string()).optional(),
  /** Absolute path to the resolved executable, so the toolchain behind a row is nameable. */
  path: z.string().nullable().optional(),
  extensions: z.array(z.string()),
  /** Plain-words index cost, so the toggle states its own price. */
  indexCost: z.string(),
  /**
   * How to install a missing server on the host, resolved by the daemon. Optional: an older
   * daemon sends nothing, and the client renders nothing extra when it is absent. A row with
   * no install route (project-supplied) is `null`, not an empty object.
   */
  install: z
    .object({
      /** Ordered argv steps; each `display` is the exact text the user reads and confirms. */
      steps: z.array(
        z.object({
          command: z.string(),
          args: z.array(z.string()),
          display: z.string(),
          note: z.string().nullable(),
        }),
      ),
      /** Manual route: an official installer link instead of a command. */
      url: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

export const LspRunningServerSchema = z.object({
  rootPath: z.string(),
  serverId: z.string(),
  uptimeMs: z.number(),
  lastUsedAt: z.number(),
});

export const LspServersListResponseSchema = z.object({
  type: z.literal("lsp.servers.list.response"),
  payload: z.object({
    cwd: z.string(),
    languages: z.array(LspLanguageStateSchema),
    running: z.array(LspRunningServerSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const LspServerStopResponseSchema = z.object({
  type: z.literal("lsp.server.stop.response"),
  payload: z.object({
    rootPath: z.string(),
    serverId: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export type LspServersListRequest = z.infer<typeof LspServersListRequestSchema>;

export type LspServersListResponse = z.infer<typeof LspServersListResponseSchema>;

export type LspServerStopRequest = z.infer<typeof LspServerStopRequestSchema>;

export type LspServerStopResponse = z.infer<typeof LspServerStopResponseSchema>;

export type LspLanguageState = z.infer<typeof LspLanguageStateSchema>;

export type LspRunningServer = z.infer<typeof LspRunningServerSchema>;

export type LspActivityChangedStatusPayload = z.infer<typeof LspActivityChangedStatusPayloadSchema>;

export type LspDiagnosticsChangedStatusPayload = z.infer<
  typeof LspDiagnosticsChangedStatusPayloadSchema
>;
