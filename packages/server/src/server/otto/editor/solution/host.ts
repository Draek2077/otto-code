import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import {
  listEditorSolutions,
  readEditorSolution,
  readEditorSolutionProject,
  refreshEditorSolution,
} from "@getpaseo/plugin/otto/editor-solution";
import { resetDotnetRuntimeCache } from "./dotnet/bootstrap.js";
import { SolutionService } from "./service.js";
import type { EditorSettingsStore } from "../settings.js";
import { EditorError } from "../errors.js";

/** The read-only Solution Files lens is opt-in. Constructing the owner does
 * not enumerate a directory, probe the SDK or start MSBuild. */
export class EditorSolutionHost {
  private readonly service: SolutionService;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  constructor(
    private readonly hostId: () => string,
    private readonly settings: EditorSettingsStore,
    private readonly logger: Logger,
  ) {
    this.service = new SolutionService({ logger });
  }
  invoke(method: string, input: unknown): Promise<unknown> | undefined {
    if (method === listEditorSolutions.name) {
      const value = listEditorSolutions.input.parse(input);
      return this.list(value);
    }
    if (method === readEditorSolution.name) {
      const value = readEditorSolution.input.parse(input);
      return this.tree(value);
    }
    if (method === readEditorSolutionProject.name) {
      const value = readEditorSolutionProject.input.parse(input);
      return this.project(value);
    }
    if (method === refreshEditorSolution.name) {
      const value = refreshEditorSolution.input.parse(input);
      return this.refresh(value);
    }
    return undefined;
  }
  async configure() {
    const prefs = this.settings.current();
    await this.service.applySettings({
      enabled: prefs.solutionEnabled,
      maxRunningProbes: prefs.solutionMaxProbes,
      idleMinutes: prefs.solutionIdleMinutes,
    });
    if (!prefs.solutionEnabled && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  private async root(input: { hostId: string; root: string }) {
    if (this.closed) throw new EditorError("closed", "Solution management is shutting down.");
    if (input.hostId !== this.hostId() || !path.isAbsolute(input.root))
      throw new EditorError("invalid", "Solution paths must belong to the selected host.");
    await this.configure();
    // Disabled is genuinely off, including directory and SDK discovery.
    if (!this.service.isEnabled) return null;
    const root = await realpath(input.root);
    if (!(await stat(root)).isDirectory())
      throw new EditorError("invalid", "The solution workspace is not a directory.");
    if (this.closed) throw new EditorError("closed", "Solution management is shutting down.");
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.service
          .reapIdle()
          .catch((error) => this.logger.warn({ err: error }, "Solution idle cleanup failed"));
      }, 30000);
      this.timer.unref();
    }
    return root;
  }
  private async list(input: { hostId: string; root: string }) {
    const root = await this.root(input);
    return {
      enabled: root !== null,
      solutions: root ? await this.service.listSolutions(root) : [],
    };
  }
  private async tree(input: { hostId: string; root: string; solutionPath: string }) {
    const root = await this.root(input);
    if (!root)
      throw new EditorError(
        "unavailable",
        "Enable Microsoft .NET Solution Management in Host → Code.",
      );
    return this.service.getTree({ ...input, root });
  }
  private async project(input: {
    hostId: string;
    root: string;
    solutionPath: string;
    projectPath: string;
  }) {
    const root = await this.root(input);
    if (!root)
      throw new EditorError(
        "unavailable",
        "Enable Microsoft .NET Solution Management in Host → Code.",
      );
    return this.service.loadProject({ ...input, root });
  }
  private async refresh(input: { hostId: string; root: string }) {
    const root = await this.root(input);
    if (root) {
      resetDotnetRuntimeCache();
      await this.service.refreshWorkspace(root);
    }
    return { refreshed: root !== null };
  }
  async releaseWorkspace(root: string) {
    await this.service.stopWorkspace(root);
  }
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.service.stopAll();
  }
}
