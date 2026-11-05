import { z } from "zod";
import { defineRpc } from "../rpc.js";

const id = z.string().min(1).max(512);
const filePath = z.string().min(1).max(32768);
const Host = z.object({ hostId: id });
export const EditorScope = Host.extend({ root: filePath });
export const EditorDocument = EditorScope.extend({
  documentId: id,
  file: filePath,
  text: z.string().max(4 * 1024 * 1024),
  draftVersion: z.number().int().nonnegative(),
  modified: z.boolean(),
});
export type EditorDocument = z.infer<typeof EditorDocument>;
// All source positions in this presentation contract are zero-based UTF-16.
export const EditorPosition = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});
export const EditorRange = z.object({ start: EditorPosition, end: EditorPosition });
export const EditorDiagnostic = z.object({
  range: EditorRange,
  severity: z.number().int().min(1).max(4),
  message: z.string(),
  source: z.string(),
  code: z.string().nullable(),
});
export type EditorDiagnostic = z.infer<typeof EditorDiagnostic>;
export const EditorLocation = z.object({ file: filePath, range: EditorRange });
export const EditorSymbol = z.object({
  name: z.string(),
  detail: z.string(),
  kind: z.number(),
  range: EditorRange,
  depth: z.number().int().nonnegative(),
});
export const EditorCompletion = z.object({
  label: z.string(),
  detail: z.string(),
  documentation: z.string(),
  insertText: z.string(),
  kind: z.number().nullable(),
  sortText: z.string(),
  filterText: z.string(),
  edit: z.object({ range: EditorRange, text: z.string() }).nullable(),
  additionalEdits: z.array(z.object({ range: EditorRange, text: z.string() })),
});
export const EditorQueryAction = z.enum([
  "definition",
  "hover",
  "references",
  "completion",
  "symbols",
  "diagnostics",
  "workspaceSymbols",
]);
export const EditorQueryResult = z.object({
  action: EditorQueryAction,
  state: z.enum(["ready", "unavailable", "failed"]),
  message: z.string().nullable(),
  locations: z.array(EditorLocation).max(10000),
  hover: z.string().nullable(),
  completions: z.array(EditorCompletion).max(10000),
  symbols: z.array(EditorSymbol).max(10000),
  source: z.enum(["language-server", "name-index"]).optional(),
  truncated: z.boolean().optional(),
});
export type EditorQueryResult = z.infer<typeof EditorQueryResult>;
export const EditorObservation = z.object({
  cursor: z.string(),
  draftVersion: z.number().int().nonnegative(),
  diagnostics: z.array(EditorDiagnostic).max(10000),
  servers: z.array(z.object({ id: z.string(), indexing: z.array(z.string()) })),
});
export type EditorObservation = z.infer<typeof EditorObservation>;
export const EditorPreferences = z.object({
  enabled: z.boolean(),
  languages: z.record(z.string(), z.boolean()),
  csharpProjectScope: z.enum(["solution", "allProjects"]),
  maxRunningServers: z.number().int().min(1).max(16),
  idleMinutes: z.number().int().min(1).max(120),
  backgroundIdleMinutes: z.number().int().min(1).max(120),
  solutionEnabled: z.boolean().default(false),
  solutionMaxProbes: z.number().int().min(1).max(8).default(2),
  solutionIdleMinutes: z.number().int().min(1).max(120).default(10),
  dotnetMaxProcesses: z.number().int().min(1).max(16).default(4),
});
export type EditorPreferences = z.infer<typeof EditorPreferences>;
export const EditorPreferencesPatch = EditorPreferences.partial().strict();
export const EditorSettings = z.object({ revision: z.string(), preferences: EditorPreferences });
export type EditorSettings = z.infer<typeof EditorSettings>;
export const EditorInstallCommand = z.object({
  command: z.string(),
  args: z.array(z.string()),
  display: z.string(),
});
export const EditorServers = z.object({
  available: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      enabled: z.boolean(),
      command: z.string().nullable(),
      source: z.enum(["project", "bundled", "path"]).nullable(),
      workspaceOnly: z.boolean(),
      cost: z.string(),
      install: EditorInstallCommand.nullable(),
      prerequisite: z
        .object({
          label: z.string(),
          documentation: z.string(),
          install: EditorInstallCommand.nullable(),
        })
        .optional(),
    }),
  ),
  running: z.array(
    z.object({
      root: z.string(),
      serverId: z.string(),
      startedAt: z.number(),
      lastUsedAt: z.number(),
      indexing: z.array(z.string()),
    }),
  ),
});
export const readEditorSettings = defineRpc({
  name: "editor.settings.read",
  input: Host,
  output: EditorSettings,
});
export const saveEditorSettings = defineRpc({
  name: "editor.settings.save",
  input: Host.extend({ expectedRevision: z.string(), patch: EditorPreferencesPatch }),
  output: EditorSettings,
});
export const listEditorServers = defineRpc({
  name: "editor.servers.list",
  input: Host.extend({ root: filePath.nullable() }),
  output: EditorServers,
});
export const stopEditorServer = defineRpc({
  name: "editor.servers.stop",
  input: EditorScope.extend({ serverId: id }),
  output: z.object({ stopped: z.boolean() }),
});
export const listEditorFiles = defineRpc({
  name: "editor.files.list",
  input: EditorScope,
  output: z.object({ files: z.array(filePath).max(5000), truncated: z.boolean() }),
});
export const EditorImage = z.object({
  name: z.string().max(1024),
  mimeType: z.string().max(100),
  dataBase64: z.string().max(3 * 1024 * 1024),
});
export type EditorImage = z.infer<typeof EditorImage>;
export const writeEditorImage = defineRpc({
  name: "editor.markdown.image.write",
  input: EditorScope.extend({ file: filePath, operationId: z.string().uuid(), image: EditorImage }),
  output: z.object({ path: filePath, insert: z.string() }),
});
export const queryEditor = defineRpc({
  name: "editor.code.query",
  input: EditorDocument.extend({
    action: EditorQueryAction,
    position: EditorPosition,
    query: z.string().max(512).optional(),
  }),
  output: EditorQueryResult,
});
/** Queries use the authenticated document lease after its content is mirrored.
 * A lost/expired lease asks for one current snapshot, never legacy RPC fan-out. */
export const queryBoundEditor = defineRpc({
  name: "editor.code.query-bound",
  input: Host.extend({
    documentId: id,
    draftVersion: z.number().int().nonnegative(),
    modified: z.boolean(),
    action: EditorQueryAction,
    position: EditorPosition,
    query: z.string().max(512).optional(),
  }),
  output: z.discriminatedUnion("state", [
    z.object({ state: z.literal("ready"), result: EditorQueryResult }),
    z.object({ state: z.literal("needsSync") }),
  ]),
});
export const observeEditor = defineRpc({
  name: "editor.document.observe",
  input: Host.extend({ documentId: id, cursor: z.string().nullable() }),
  output: EditorObservation,
});
export const releaseEditor = defineRpc({
  name: "editor.document.release",
  input: Host.extend({ documentId: id }),
  output: z.object({ released: z.boolean() }),
});
/** Dirty protection outlives foreground language-server demand. No draft text
 * or polling is needed to protect an inactive tab from a workspace edit. */
export const guardEditorDraft = defineRpc({
  name: "editor.document.guard",
  input: Host.extend({
    documentId: id,
    root: filePath,
    file: filePath,
    modified: z.boolean(),
    revision: z.number().int().nonnegative(),
  }),
  output: z.object({ guarded: z.boolean() }),
});
export const exportEditorDocument = defineRpc({
  name: "editor.document.export",
  input: Host.extend({
    root: filePath,
    file: filePath,
    operationId: z.uuid(),
    extension: z.enum(["html", "pdf"]),
    base64: z.string().max(12 * 1024 * 1024),
  }),
  output: z.object({ file: filePath }),
});

export const EditorPlannedFile = z.object({
  file: filePath,
  before: z.string(),
  after: z.string(),
  editCount: z.number().int().nonnegative(),
});
export const EditorPlan = z.object({
  planId: id,
  root: filePath,
  files: z.array(EditorPlannedFile).max(1000),
});
export type EditorPlan = z.infer<typeof EditorPlan>;
export const EditorSearchOptions = z.object({
  query: z.string().min(1).max(512),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
  regexp: z.boolean(),
  include: z.string().max(512),
  exclude: z.string().max(512),
});
export type EditorSearchOptions = z.infer<typeof EditorSearchOptions>;
export const EditorSearchResult = z.object({
  searchId: id,
  truncated: z.boolean(),
  scannedFiles: z.number().int().nonnegative(),
  matches: z
    .array(
      z.object({
        file: filePath,
        line: z.number().int().positive(),
        column: z.number().int().positive(),
        length: z.number().int().nonnegative(),
        preview: z.string().max(240),
      }),
    )
    .max(2000),
});
export type EditorSearchResult = z.infer<typeof EditorSearchResult>;
export const searchEditorFiles = defineRpc({
  name: "editor.files.search",
  input: Host.extend({ root: filePath, options: EditorSearchOptions }),
  output: EditorSearchResult,
});
export const planEditorReplace = defineRpc({
  name: "editor.files.replace-plan",
  input: Host.extend({
    searchId: id,
    replacement: z.string().max(10000),
    files: z.array(filePath).min(1).max(1000),
  }),
  output: EditorPlan,
});
export const EditorEditOutcome = z.object({
  runId: id,
  files: z.array(
    z.object({
      file: filePath,
      state: z.enum(["applied", "restored", "conflict", "failed"]),
      message: z.string().nullable(),
    }),
  ),
});
export type EditorEditOutcome = z.infer<typeof EditorEditOutcome>;
export const planEditorRename = defineRpc({
  name: "editor.rename.plan",
  input: EditorDocument.extend({
    position: EditorPosition,
    newName: z.string().trim().min(1).max(512),
  }),
  output: EditorPlan,
});
export const applyEditorRename = defineRpc({
  name: "editor.rename.apply",
  input: Host.extend({ planId: id }),
  output: EditorEditOutcome,
});
export const undoEditorRename = defineRpc({
  name: "editor.rename.undo",
  input: Host.extend({ runId: id }),
  output: EditorEditOutcome,
});

/** PTYs with this identity are presented by a file tab, never auto-opened as
 * standalone Terminal tabs. The owning daemon assigns the identity. */
export const EDITOR_TERMINAL_PREFIX = "otto-editor:";
export function isEditorTerminal(terminalId: string) {
  return terminalId.startsWith(EDITOR_TERMINAL_PREFIX);
}
export const TerminalEditorSession = z.object({
  terminalId: id,
  workspaceId: id,
  cwd: filePath,
  file: filePath,
  mode: z.enum(["vim", "neovim", "custom"]),
});
export type TerminalEditorSession = z.infer<typeof TerminalEditorSession>;
const TerminalEditorScope = Host.extend({ workspaceId: id, file: filePath });
export const openTerminalEditor = defineRpc({
  name: "editor.terminal.open",
  input: TerminalEditorScope.extend({
    mode: z.enum(["vim", "neovim", "custom"]),
    customCommand: z.string().max(8192),
    line: z.number().int().positive().max(10000000).nullable(),
  }),
  output: TerminalEditorSession,
});
export const findTerminalEditor = defineRpc({
  name: "editor.terminal.find",
  input: TerminalEditorScope,
  output: TerminalEditorSession.nullable(),
});
export const closeTerminalEditor = defineRpc({
  name: "editor.terminal.close",
  input: TerminalEditorScope.extend({ terminalId: id }),
  output: z.object({ closed: z.boolean() }),
});
