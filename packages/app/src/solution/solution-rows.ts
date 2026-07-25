import type {
  SolutionProjectContents,
  SolutionProjectStatus,
  SolutionTree,
} from "@otto-code/client/internal/daemon-client";
import { TREE_RAILS_ALL_CONTINUE, withTreeRail } from "@/components/tree-rail-mask";

/**
 * The Solution lens's single pure funnel from data + expanded ids to rows, mirroring
 * `resolveTreeRows` in the Files lens.
 *
 * Pure and exported on its own so the interesting behaviour — solution-folder nesting, a project
 * that failed to evaluate, `bin`/`obj` being absent because no evaluated item lives there — is
 * testable without mounting a tree.
 */

/**
 * Node types are the charter's discriminated union. `solutionProject` rather than a bare
 * `project`, because **Project is a taken Otto noun** (a grouping of workspaces sharing a git
 * remote) and both will be on screen at once. See docs/glossary.md.
 */
export type SolutionViewNode =
  | { kind: "folder"; id: string; name: string }
  | {
      kind: "solutionProject";
      id: string;
      name: string;
      /** Workspace-relative, or absolute when the solution names it outside the workspace. */
      path: string;
      outsideWorkspace: boolean;
      status: SolutionProjectStatus | "unloaded";
      /** MSBuild's own message when the status is `failed`. */
      error: string | null;
      targetFrameworks: readonly string[];
    }
  | { kind: "directory"; id: string; name: string; path: string; outsideWorkspace: boolean }
  | {
      kind: "file";
      id: string;
      name: string;
      path: string;
      outsideWorkspace: boolean;
      itemType: string;
      /**
       * The item came from the SDK's default globs rather than an explicit declaration in the
       * project file. Phase 2 turns on this distinction; Phase 1 only needs it to be carried.
       */
      isImplicit: boolean;
    };

export interface SolutionRow {
  node: SolutionViewNode;
  depth: number;
  /** Which indent rails keep running below this row — see tree-rail-mask.ts. */
  ancestorMask: number;
}

/** A project's loaded contents, keyed by the project path the tree reported. */
export type SolutionProjectMap = ReadonlyMap<string, SolutionProjectContents>;

export function buildSolutionRows(input: {
  tree: SolutionTree | null;
  projects: SolutionProjectMap;
  expandedIds: ReadonlySet<string>;
}): SolutionRow[] {
  const { tree } = input;
  if (tree === null) {
    return [];
  }

  const childFolders = new Map<string | null, SolutionTree["folders"]>();
  for (const folder of tree.folders) {
    const parent = folder.parentPath;
    childFolders.set(parent, [...(childFolders.get(parent) ?? []), folder]);
  }

  const childProjects = new Map<string | null, SolutionTree["projects"]>();
  for (const project of tree.projects) {
    const parent = project.folderPath;
    childProjects.set(parent, [...(childProjects.get(parent) ?? []), project]);
  }

  const rows: SolutionRow[] = [];
  appendFolderChildren({
    folderPath: null,
    depth: 0,
    parentMask: TREE_RAILS_ALL_CONTINUE,
    childFolders,
    childProjects,
    input,
    rows,
  });
  return rows;
}

function appendFolderChildren(context: {
  folderPath: string | null;
  depth: number;
  parentMask: number;
  childFolders: Map<string | null, SolutionTree["folders"]>;
  childProjects: Map<string | null, SolutionTree["projects"]>;
  input: { projects: SolutionProjectMap; expandedIds: ReadonlySet<string> };
  rows: SolutionRow[];
}): void {
  const folders = [...(context.childFolders.get(context.folderPath) ?? [])].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const projects = [...(context.childProjects.get(context.folderPath) ?? [])].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  // Solution folders before projects, each group alphabetical — the arrangement a .NET developer
  // sees in Visual Studio, and the reason this lens is worth having.
  const total = folders.length + projects.length;
  let index = 0;

  for (const folder of folders) {
    const mask = withTreeRail(context.parentMask, context.depth, index < total - 1);
    context.rows.push({
      node: { kind: "folder", id: folder.path, name: folder.name },
      depth: context.depth,
      ancestorMask: mask,
    });
    index += 1;
    if (!context.input.expandedIds.has(folder.path)) {
      continue;
    }
    appendFolderChildren({
      ...context,
      folderPath: folder.path,
      depth: context.depth + 1,
      parentMask: mask,
    });
  }

  for (const project of projects) {
    const mask = withTreeRail(context.parentMask, context.depth, index < total - 1);
    const loaded = context.input.projects.get(project.path) ?? null;
    context.rows.push({
      node: {
        kind: "solutionProject",
        id: project.path,
        name: project.name,
        path: project.path,
        outsideWorkspace: project.outsideWorkspace,
        // "Not asked yet" is a state of its own: a collapsed project has not been evaluated, and
        // rendering it as `ok` with no files would say the project is empty.
        status: loaded?.status ?? "unloaded",
        error: loaded?.error ?? null,
        targetFrameworks: loaded?.targetFrameworks ?? [],
      },
      depth: context.depth,
      ancestorMask: mask,
    });
    index += 1;
    if (!context.input.expandedIds.has(project.path) || loaded === null) {
      continue;
    }
    appendProjectContents({
      contents: loaded,
      depth: context.depth + 1,
      parentMask: mask,
      expandedIds: context.input.expandedIds,
      rows: context.rows,
    });
  }
}

/**
 * A project's evaluated membership. The daemon already grouped the files into directories and
 * sorted them, so this only has to walk the parent links and thread the rail mask.
 */
function appendProjectContents(context: {
  contents: SolutionProjectContents;
  depth: number;
  parentMask: number;
  expandedIds: ReadonlySet<string>;
  rows: SolutionRow[];
}): void {
  const byParent = new Map<string | null, SolutionProjectContents["nodes"]>();
  for (const node of context.contents.nodes) {
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  }

  const walk = (parentId: string | null, depth: number, parentMask: number): void => {
    const children = byParent.get(parentId) ?? [];
    children.forEach((node, index) => {
      const mask = withTreeRail(parentMask, depth, index < children.length - 1);
      if (node.kind === "directory") {
        context.rows.push({
          node: {
            kind: "directory",
            id: node.id,
            name: node.name,
            path: node.path,
            outsideWorkspace: node.outsideWorkspace,
          },
          depth,
          ancestorMask: mask,
        });
        // Directories under a project default to EXPANDED. Unlike the filesystem lens there is no
        // listing to fetch — the whole project arrived in one payload — so collapsing by default
        // would hide files for no saving at all.
        if (!context.expandedIds.has(collapsedKey(node.id))) {
          walk(node.id, depth + 1, mask);
        }
        return;
      }
      context.rows.push({
        node: {
          kind: "file",
          id: node.id,
          name: node.name,
          path: node.path,
          outsideWorkspace: node.outsideWorkspace,
          itemType: node.itemType,
          isImplicit: node.isImplicit,
        },
        depth,
        ancestorMask: mask,
      });
    });
  };

  walk(null, context.depth, context.parentMask);
}

/**
 * Directories inside a project store *collapsed* state, inverted from everything above them,
 * because their default is expanded. The prefix keeps the two senses from colliding in the one
 * expanded-id set the pane owns.
 */
export function collapsedKey(directoryId: string): string {
  return `collapsed:${directoryId}`;
}
