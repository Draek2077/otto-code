import { z } from "zod";
import { defineRpc } from "../rpc.js";

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

const Scope = z.object({ hostId: z.string().min(1), root: z.string().min(1).max(32768) });
export const listEditorSolutions = defineRpc({
  name: "editor.solution.list",
  input: Scope,
  output: z.object({ enabled: z.boolean(), solutions: z.array(SolutionRefSchema).max(1000) }),
});
export const readEditorSolution = defineRpc({
  name: "editor.solution.read",
  input: Scope.extend({ solutionPath: z.string().min(1).max(32768) }),
  output: z.object({
    solutionPath: z.string(),
    name: z.string(),
    format: SolutionFormatSchema,
    folders: z.array(SolutionTreeFolderSchema).max(10000),
    projects: z.array(SolutionTreeProjectSchema).max(10000),
    buildTypes: z.array(z.string()).max(100),
    platforms: z.array(z.string()).max(100),
  }),
});
export const readEditorSolutionProject = defineRpc({
  name: "editor.solution.project",
  input: Scope.extend({
    solutionPath: z.string().min(1).max(32768),
    projectPath: z.string().min(1).max(32768),
  }),
  output: z.object({
    projectPath: z.string(),
    status: SolutionProjectStatusSchema,
    nodes: z.array(SolutionProjectNodeSchema).max(100000),
    projectReferences: z.array(z.string()).max(10000),
    packageReferences: z.array(SolutionPackageReferenceSchema).max(10000),
    targetFrameworks: z.array(z.string()).max(100),
    outputType: z.string().nullable(),
    isSdkStyle: z.boolean(),
    error: z.string().nullable(),
  }),
});
export type SolutionTree = z.output<typeof readEditorSolution.output>;
export type SolutionProjectContents = z.output<typeof readEditorSolutionProject.output>;
export const refreshEditorSolution = defineRpc({
  name: "editor.solution.refresh",
  input: Scope,
  output: z.object({ refreshed: z.boolean() }),
});
