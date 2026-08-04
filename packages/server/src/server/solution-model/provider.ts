import type {
  SolutionFormat,
  SolutionPackageReference,
  SolutionProjectStatus,
  SolutionTreeFolder,
  SolutionTreeProject,
} from "@otto-code/protocol/messages";

/**
 * The language-neutral seam. .NET is implementation #1, not the interface.
 *
 * Cargo workspaces, npm workspaces and Gradle multi-project builds all fit this shape: a
 * discovery step that is cheap enough to run everywhere, a structure step, and a per-unit
 * membership step that is paid lazily. Declaring the interface now costs almost nothing;
 * retrofitting it around a hardcoded .NET tree would cost a rewrite.
 *
 * Everything here speaks **absolute** paths. Turning those into the workspace-relative form the
 * wire carries is `paths.ts`'s job, done once at the service boundary - a provider that had to
 * know about workspaces would be a provider that has to re-implement containment.
 */

export interface SolutionRefAbsolute {
  /** Absolute, forward-slashed. */
  path: string;
  name: string;
  format: SolutionFormat;
}

export interface SolutionStructure {
  solutionPath: string;
  name: string;
  format: SolutionFormat;
  folders: SolutionTreeFolder[];
  /** `path` is absolute here; the service rewrites it before it reaches the wire. */
  projects: (Omit<SolutionTreeProject, "outsideWorkspace"> & { path: string })[];
  buildTypes: string[];
  platforms: string[];
}

/** One evaluated file, before the service groups it into directories. */
export interface SolutionProjectFile {
  /** Absolute, forward-slashed. */
  path: string;
  itemType: string;
  isImplicit: boolean;
}

export interface SolutionProjectContents {
  projectPath: string;
  status: SolutionProjectStatus;
  files: SolutionProjectFile[];
  projectReferences: string[];
  packageReferences: SolutionPackageReference[];
  targetFrameworks: string[];
  outputType: string | null;
  isSdkStyle: boolean;
  /** The build system's own message when `status` is `failed`, verbatim. */
  error: string | null;
}

export interface SolutionProvider {
  /** `"dotnet"`. */
  readonly id: string;

  /**
   * Solutions in this workspace. **Must stay cheap**: it runs for every workspace, and the
   * overwhelmingly common answer is `[]` - an empty result means no switcher, no probe cost, and
   * a Files tab that behaves exactly as it does today. Spawning anything here would make every
   * .NET-free workspace pay for a feature it will never show.
   */
  detect(root: string): Promise<SolutionRefAbsolute[]>;

  /**
   * `root` is the workspace, and it rides on every call rather than being derived from the
   * solution's own directory. Those two differ - a solution can sit in a subdirectory - and the
   * workspace is what `stopWorkspace` has to be able to match, so deriving it would leave a
   * closed workspace holding a live process.
   */
  loadTree(input: { root: string; ref: SolutionRefAbsolute }): Promise<SolutionStructure>;

  loadProject(input: {
    root: string;
    solutionPath: string;
    projectPath: string;
  }): Promise<SolutionProjectContents>;

  /** Drop cached evaluation for a solution, or for one project inside it. */
  invalidate(input: { root: string; solutionPath: string; projectPath?: string }): Promise<void>;

  /** Release any process this provider is holding for a workspace. */
  stopWorkspace(root: string): Promise<void>;

  stopAll(): Promise<void>;

  /** Shut down anything idle past its allowance. Called by the daemon on an interval. */
  reapIdle(): Promise<void>;
}
