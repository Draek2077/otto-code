import type { Logger } from "pino";
import { z } from "zod";
import type {
  SolutionProjectContents,
  SolutionProvider,
  SolutionRefAbsolute,
  SolutionStructure,
} from "../provider.js";
import { toPosixAbsolute } from "../paths.js";
import { discoverSolutions } from "./discover.js";
import { DotnetProbePool, type DotnetProbePoolLimits, type RunningProbe } from "./pool.js";
import { ProbeRequestError } from "./probe.js";

/**
 * `SolutionProvider` for .NET — implementation #1 of the seam, and the acceptance criteria.
 *
 * It owns two things and delegates everything else: the discovery walk (cheap, in Node, because
 * it runs everywhere) and the translation between the sidecar's payloads and the provider-neutral
 * shapes. The domain knowledge — what a `.slnx` folder nesting means, which files MSBuild
 * actually compiles — belongs to Microsoft's libraries inside the sidecar, which is the whole
 * reason this exists as a subsystem rather than as a parser.
 */

const SolutionTreePayloadSchema = z.object({
  solutionPath: z.string(),
  format: z.enum(["sln", "slnx"]),
  name: z.string(),
  folders: z.array(
    z.object({ path: z.string(), name: z.string(), parentPath: z.string().nullish() }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
      typeId: z.string().nullish(),
      folderPath: z.string().nullish(),
    }),
  ),
  buildTypes: z.array(z.string()),
  platforms: z.array(z.string()),
});

const ProjectContentsPayloadSchema = z.object({
  projectPath: z.string(),
  items: z.record(z.string(), z.array(z.object({ path: z.string(), isImplicit: z.boolean() }))),
  projectReferences: z.array(z.string()),
  packageReferences: z.array(z.object({ name: z.string(), version: z.string().nullish() })),
  targetFrameworks: z.array(z.string()),
  outputType: z.string().nullish(),
  isSdkStyle: z.boolean(),
});

const InvalidatePayloadSchema = z.object({ invalidated: z.boolean() });

export interface DotnetSolutionProviderOptions {
  logger: Logger;
  limits?: Partial<DotnetProbePoolLimits>;
  now?: () => number;
  /** How deep the discovery walk goes. Tests use this; nothing in production sets it. */
  discoveryMaxDepth?: number;
}

export class DotnetSolutionProvider implements SolutionProvider {
  readonly id = "dotnet";

  private readonly pool: DotnetProbePool;
  private readonly discoveryMaxDepth: number | undefined;

  constructor(options: DotnetSolutionProviderOptions) {
    this.pool = new DotnetProbePool({
      logger: options.logger,
      limits: options.limits,
      now: options.now,
    });
    this.discoveryMaxDepth = options.discoveryMaxDepth;
  }

  detect(root: string): Promise<SolutionRefAbsolute[]> {
    return discoverSolutions(root, { maxDepth: this.discoveryMaxDepth });
  }

  async loadTree(input: { root: string; ref: SolutionRefAbsolute }): Promise<SolutionStructure> {
    const probe = await this.pool.acquire({
      root: toPosixAbsolute(input.root),
      solutionPath: input.ref.path,
    });
    const payload = await probe.request(
      "solution.tree",
      { solutionPath: input.ref.path },
      SolutionTreePayloadSchema,
    );

    return {
      solutionPath: toPosixAbsolute(payload.solutionPath),
      name: payload.name,
      format: payload.format,
      folders: payload.folders.map((folder) => ({
        path: folder.path,
        name: folder.name,
        parentPath: folder.parentPath ?? null,
      })),
      projects: payload.projects.map((project) => ({
        id: project.id,
        name: project.name,
        path: toPosixAbsolute(project.path),
        folderPath: project.folderPath ?? null,
        ...(project.typeId === null || project.typeId === undefined
          ? {}
          : { typeId: project.typeId }),
      })),
      buildTypes: payload.buildTypes,
      platforms: payload.platforms,
    };
  }

  async loadProject(input: {
    root: string;
    solutionPath: string;
    projectPath: string;
  }): Promise<SolutionProjectContents> {
    const probe = await this.pool.acquire({
      root: toPosixAbsolute(input.root),
      solutionPath: input.solutionPath,
    });

    let payload: z.infer<typeof ProjectContentsPayloadSchema>;
    try {
      payload = await probe.request(
        "project.load",
        { projectPath: input.projectPath },
        ProjectContentsPayloadSchema,
      );
    } catch (error) {
      // A project MSBuild refuses is a per-node answer carrying its own message, not a failure of
      // the tree: one bad project must not blank the other forty-nine. A sidecar that died is a
      // different thing and is allowed to propagate.
      if (error instanceof ProbeRequestError) {
        return {
          projectPath: input.projectPath,
          status: "failed",
          files: [],
          projectReferences: [],
          packageReferences: [],
          targetFrameworks: [],
          outputType: null,
          isSdkStyle: false,
          error: error.message,
        };
      }
      throw error;
    }

    return {
      projectPath: toPosixAbsolute(payload.projectPath),
      status: "ok",
      files: Object.entries(payload.items).flatMap(([itemType, items]) =>
        items.map((item) => ({
          path: toPosixAbsolute(item.path),
          itemType,
          isImplicit: item.isImplicit,
        })),
      ),
      projectReferences: payload.projectReferences.map(toPosixAbsolute),
      packageReferences: payload.packageReferences.map((reference) => ({
        name: reference.name,
        version: reference.version ?? null,
      })),
      targetFrameworks: payload.targetFrameworks,
      outputType: payload.outputType ?? null,
      isSdkStyle: payload.isSdkStyle,
      error: null,
    };
  }

  /**
   * Drop a stale evaluation. Best-effort on purpose: if the sidecar is not running there is
   * nothing cached to drop, and spawning one to tell it to forget something it never knew would
   * be the most expensive no-op in the subsystem.
   */
  async invalidate(input: {
    root: string;
    solutionPath: string;
    projectPath?: string;
  }): Promise<void> {
    const alreadyRunning = this.pool
      .running()
      .some((entry) => entry.solutionPath === input.solutionPath);
    if (!alreadyRunning) {
      return;
    }
    const probe = await this.pool.acquire({
      root: toPosixAbsolute(input.root),
      solutionPath: input.solutionPath,
    });
    await probe.request(
      "project.invalidate",
      input.projectPath === undefined ? {} : { projectPath: input.projectPath },
      InvalidatePayloadSchema,
    );
  }

  stopWorkspace(root: string): Promise<void> {
    this.pool.stopWorkspace(root);
    return Promise.resolve();
  }

  stopAll(): Promise<void> {
    this.pool.stopAll();
    return Promise.resolve();
  }

  reapIdle(): Promise<void> {
    this.pool.reapIdle();
    return Promise.resolve();
  }

  running(): RunningProbe[] {
    return this.pool.running();
  }

  setLimits(limits: Partial<DotnetProbePoolLimits>): void {
    this.pool.setLimits(limits);
  }
}
