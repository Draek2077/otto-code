import { basename, dirname, extname } from "node:path";
import type { Logger } from "pino";
import type {
  SolutionPackageReference,
  SolutionProjectNode,
  SolutionProjectStatus,
  SolutionRef,
  SolutionTreeFolder,
  SolutionTreeProject,
} from "@otto-code/protocol/messages";
import { documentKey } from "../lsp/uri.js";
import { freshnessStamp, SolutionModelCache } from "./cache.js";
import { DotnetSolutionProvider } from "./dotnet/provider.js";
import { isInsideWorkspace, toPosix, toPosixAbsolute, toWirePath, fromWirePath } from "./paths.js";
import type { SolutionProvider, SolutionRefAbsolute } from "./provider.js";

/**
 * The daemon's Solution-view surface: what the three `code.solution.*` RPCs call.
 *
 * **The switch is checked here, before anything is scheduled.** "Disabled is genuinely off" is a
 * property of this one method boundary: with the feature off, `listSolutions` returns an empty
 * array without a directory walk, and `getTree`/`loadProject` refuse without touching the pool.
 * No discovery, no `.sln` read, no `.csproj` parse, no process, no cache entry, no watcher
 * subscription — one boolean, and then nothing. Anything that moved that check downstream would
 * make the guarantee a matter of every caller's discipline rather than of the design.
 *
 * Everything below this line speaks absolute paths; everything above it speaks the wire form.
 * That translation happening in exactly one place is what lets the provider seam stay ignorant of
 * workspaces and the client stay ignorant of the filesystem.
 */

export interface SolutionSettings {
  enabled: boolean;
  maxRunningProbes: number;
  idleMinutes: number;
}

const DEFAULT_SETTINGS: SolutionSettings = {
  // Off, matching the daemon config's own default. An omitted section must never read as on for
  // a feature that spawns a process.
  enabled: false,
  maxRunningProbes: 2,
  idleMinutes: 10,
};

/** Files whose change invalidates an evaluation. `.cs` is deliberately absent — see `cache.ts`. */
const EVALUATION_INPUT_EXTENSIONS = new Set([
  ".csproj",
  ".fsproj",
  ".vbproj",
  ".props",
  ".targets",
]);
const EVALUATION_INPUT_NAMES = new Set(["global.json", "directory.packages.props"]);
const SOLUTION_EXTENSIONS = new Set([".sln", ".slnx"]);

export interface SolutionServiceOptions {
  logger: Logger;
  /** Test hook: substitute the .NET provider. Nothing in production passes this. */
  provider?: SolutionProvider;
}

export interface SolutionTreeResult {
  solutionPath: string;
  name: string;
  format: "sln" | "slnx";
  folders: SolutionTreeFolder[];
  projects: SolutionTreeProject[];
  buildTypes: string[];
  platforms: string[];
}

export interface SolutionProjectResult {
  projectPath: string;
  status: SolutionProjectStatus;
  nodes: SolutionProjectNode[];
  projectReferences: string[];
  packageReferences: SolutionPackageReference[];
  targetFrameworks: string[];
  outputType: string | null;
  isSdkStyle: boolean;
  error: string | null;
}

export class SolutionService {
  private readonly logger: Logger;
  private readonly provider: SolutionProvider;
  private readonly cache = new SolutionModelCache();
  private settings: SolutionSettings = DEFAULT_SETTINGS;

  constructor(options: SolutionServiceOptions) {
    this.logger = options.logger.child({ subsystem: "solution-model" });
    this.provider = options.provider ?? new DotnetSolutionProvider({ logger: options.logger });
  }

  get isEnabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Apply the host's policy and make the world match it. Turning the switch off stops whatever is
   * running and drops the cache now, rather than leaving a process resident until it happens to
   * idle out — off has to mean off immediately, or the switch is decoration.
   */
  async applySettings(patch: Partial<SolutionSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    if (this.provider instanceof DotnetSolutionProvider) {
      this.provider.setLimits({
        maxRunningProbes: this.settings.maxRunningProbes,
        idleMs: this.settings.idleMinutes * 60_000,
      });
    }
    if (!this.settings.enabled) {
      this.cache.clear();
      await this.provider.stopAll();
    }
  }

  /**
   * Solutions in a workspace. Drives whether the view switcher exists at all, so the disabled
   * path returns before the walk and the error path returns empty rather than throwing: a
   * workspace with no solutions, a host with no .NET SDK, and a disabled feature are one silent
   * case for the client, not four states to render.
   */
  async listSolutions(root: string): Promise<SolutionRef[]> {
    if (!this.settings.enabled) {
      return [];
    }
    try {
      const found = await this.provider.detect(toPosixAbsolute(root));
      return found.map((ref) => ({
        path: toWirePath(root, ref.path).path,
        name: ref.name,
        format: ref.format,
      }));
    } catch (error) {
      this.logger.warn({ err: error, root }, "solution discovery failed");
      return [];
    }
  }

  async getTree(input: { root: string; solutionPath: string }): Promise<SolutionTreeResult> {
    this.assertEnabled();
    const absolute = fromWirePath(input.root, input.solutionPath);
    // One `stat` before an answer that would otherwise cost a process round-trip. See `cache.ts`
    // for why this beats a watcher subscription here.
    const stamp = await freshnessStamp(absolute);
    const cached = this.cache.getStructure(absolute, stamp);
    const structure =
      cached ?? (await this.provider.loadTree({ root: input.root, ref: this.refFor(absolute) }));
    if (cached === null) {
      this.cache.setStructure(structure, stamp);
    }

    return {
      solutionPath: toWirePath(input.root, structure.solutionPath).path,
      name: structure.name,
      format: structure.format,
      folders: structure.folders,
      projects: structure.projects.map((project) => {
        const wire = toWirePath(input.root, project.path);
        return {
          id: project.id,
          name: project.name,
          path: wire.path,
          outsideWorkspace: wire.outsideWorkspace,
          folderPath: project.folderPath,
          ...(project.typeId === undefined ? {} : { typeId: project.typeId }),
        };
      }),
      buildTypes: structure.buildTypes,
      platforms: structure.platforms,
    };
  }

  async loadProject(input: {
    root: string;
    solutionPath: string;
    projectPath: string;
  }): Promise<SolutionProjectResult> {
    this.assertEnabled();
    const solutionPath = fromWirePath(input.root, input.solutionPath);
    const projectPath = fromWirePath(input.root, input.projectPath);

    const stamp = await freshnessStamp(projectPath);
    const cached = this.cache.getProject(solutionPath, projectPath, stamp);
    const contents =
      cached ?? (await this.provider.loadProject({ root: input.root, solutionPath, projectPath }));
    if (cached === null) {
      this.cache.setProject(solutionPath, contents, stamp);
    }

    return {
      projectPath: toWirePath(input.root, contents.projectPath).path,
      status: contents.status,
      nodes: buildProjectNodes({
        root: input.root,
        projectPath: contents.projectPath,
        files: contents.files,
      }),
      projectReferences: contents.projectReferences.map(
        (reference) => toWirePath(input.root, reference).path,
      ),
      packageReferences: contents.packageReferences,
      targetFrameworks: contents.targetFrameworks,
      outputType: contents.outputType,
      isSdkStyle: contents.isSdkStyle,
      error: contents.error,
    };
  }

  /**
   * A file changed on disk, pushed by whoever noticed.
   *
   * The read-side freshness stamp already keeps a stale `.csproj` from being served, so this is
   * not the correctness mechanism — it is the one case the stamp cannot cover. A
   * `Directory.Build.props`, a `.targets` or a `global.json` is an **input** to projects whose own
   * files did not change, so their stamps still match and they would keep serving an evaluation
   * made under the old configuration. Dropping everything beneath the changed file is the honest
   * answer: working out exactly which projects import it would mean re-deriving MSBuild's import
   * graph, which is precisely the domain knowledge we deliberately do not own.
   *
   * Cheap and synchronous for everything else — a `.cs` edit returns immediately, because
   * membership is by glob and editing a file cannot change which files are in the project.
   *
   * Returns the solutions whose cached model was dropped.
   */
  invalidatePath(changedPath: string): string[] {
    if (!this.settings.enabled) {
      return [];
    }
    const absolute = toPosixAbsolute(changedPath);
    const extension = extname(absolute).toLowerCase();
    const name = basename(absolute).toLowerCase();

    if (SOLUTION_EXTENSIONS.has(extension)) {
      this.cache.invalidateSolution(absolute);
      this.invalidateInProvider({ solutionPath: absolute });
      return [absolute];
    }

    const isSharedInput =
      extension === ".props" || extension === ".targets" || EVALUATION_INPUT_NAMES.has(name);
    if (isSharedInput) {
      const affected = this.cache
        .solutionPaths()
        .filter((solutionPath) => isInsideWorkspace(dirname(absolute), solutionPath));
      for (const solutionPath of affected) {
        this.cache.invalidateSolution(solutionPath);
        this.invalidateInProvider({ solutionPath });
      }
      return affected;
    }

    if (!EVALUATION_INPUT_EXTENSIONS.has(extension)) {
      return [];
    }

    const owners = this.cache.solutionsContaining(absolute);
    this.cache.invalidateProject(absolute);
    for (const solutionPath of owners) {
      this.invalidateInProvider({ solutionPath, projectPath: absolute });
    }
    return owners;
  }

  /**
   * Tell the sidecar to forget an evaluation. Fire-and-forget on purpose: the cache is already
   * correct, this only stops the warm `ProjectCollection` from answering from memory, and a
   * caller that awaited it would be paying process latency on a filesystem event.
   */
  private invalidateInProvider(input: { solutionPath: string; projectPath?: string }): void {
    void this.provider
      .invalidate({ root: dirname(input.solutionPath), ...input })
      .catch((error: unknown) => {
        this.logger.debug({ err: error, ...input }, "solution sidecar invalidation failed");
      });
  }

  async stopWorkspace(root: string): Promise<void> {
    const normalized = toPosixAbsolute(root);
    this.cache.invalidateWhere((solutionPath) => isInsideWorkspace(normalized, solutionPath));
    await this.provider.stopWorkspace(normalized);
  }

  /**
   * Called by the daemon on an interval. The LSP subsystem shipped the same method with no
   * production caller and idle servers therefore never exited; this one is wired in
   * `websocket-server.ts` and asserted by a test on that wiring.
   */
  async reapIdle(): Promise<void> {
    if (!this.settings.enabled) {
      return;
    }
    await this.provider.reapIdle();
  }

  async stopAll(): Promise<void> {
    this.cache.clear();
    await this.provider.stopAll();
  }

  private assertEnabled(): void {
    if (!this.settings.enabled) {
      throw new Error("Microsoft .NET Solution Management is turned off on this host");
    }
  }

  private refFor(absolutePath: string): SolutionRefAbsolute {
    const extension = extname(absolutePath).toLowerCase();
    return {
      path: absolutePath,
      name: basename(absolutePath, extension),
      format: extension === ".slnx" ? "slnx" : "sln",
    };
  }
}

/**
 * Evaluated file paths into the directory/file tree the explorer renders.
 *
 * Done here rather than in the client because it is pure and deterministic, and doing it once
 * beats every client doing it again — but mostly because the interesting decision is a daemon
 * one: directories are synthesised from the files that are actually **in the project**, so an
 * `obj/` full of build output simply has no node, with no gitignore rule and no filter anywhere.
 * That, and marking which files the SDK contributed implicitly, is the thing a filesystem tree
 * structurally cannot show.
 */
function buildProjectNodes(input: {
  root: string;
  projectPath: string;
  files: readonly { path: string; itemType: string; isImplicit: boolean }[];
}): SolutionProjectNode[] {
  const projectDirectory = toPosixAbsolute(dirname(input.projectPath));
  const nodes = new Map<string, SolutionProjectNode>();

  for (const file of input.files) {
    const absolute = toPosixAbsolute(file.path);
    const parentId = ensureDirectories({
      absoluteDirectory: toPosix(dirname(absolute)),
      projectDirectory,
      root: input.root,
      nodes,
    });
    const wire = toWirePath(input.root, absolute);
    const id = documentKey(absolute);
    const existing = nodes.get(id);
    if (existing !== undefined) {
      // The same file can be both `Content` and `None` in a hand-authored project. One node wins;
      // an explicit declaration outranks an SDK default, because that is the one a user edited.
      if (existing.kind === "file" && existing.isImplicit && !file.isImplicit) {
        nodes.set(id, { ...existing, itemType: file.itemType, isImplicit: false });
      }
      continue;
    }
    nodes.set(id, {
      kind: "file",
      id,
      parentId,
      name: basename(absolute),
      path: wire.path,
      outsideWorkspace: wire.outsideWorkspace,
      itemType: file.itemType,
      isImplicit: file.isImplicit,
    });
  }

  // Directories before files at each level, then by name — the same ordering the Files tree uses,
  // so switching lenses does not reshuffle everything a reader had located.
  return [...nodes.values()].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.path.localeCompare(right.path);
  });
}

/**
 * Create the chain of directory nodes between the project's own folder and a file, and return the
 * id of the file's immediate parent. A file directly beside the project gets `null` — the project
 * node itself is its parent, and it lives in the solution tree rather than in this list.
 */
function ensureDirectories(input: {
  absoluteDirectory: string;
  projectDirectory: string;
  root: string;
  nodes: Map<string, SolutionProjectNode>;
}): string | null {
  const { absoluteDirectory, projectDirectory, root, nodes } = input;
  if (documentKey(absoluteDirectory) === documentKey(projectDirectory)) {
    return null;
  }
  // A linked file from outside the project's folder (`<Compile Include="../Shared/X.cs" />`) has
  // no place in the project's own directory chain. It is attached at the project root rather than
  // dragged into a synthetic parent tree that does not correspond to anything.
  if (!isInsideWorkspace(projectDirectory, absoluteDirectory)) {
    return null;
  }

  const parentId = ensureDirectories({
    absoluteDirectory: toPosix(dirname(absoluteDirectory)),
    projectDirectory,
    root,
    nodes,
  });
  const id = documentKey(absoluteDirectory);
  if (!nodes.has(id)) {
    const wire = toWirePath(root, absoluteDirectory);
    nodes.set(id, {
      kind: "directory",
      id,
      parentId,
      name: basename(absoluteDirectory),
      path: wire.path,
      outsideWorkspace: wire.outsideWorkspace,
    });
  }
  return id;
}
