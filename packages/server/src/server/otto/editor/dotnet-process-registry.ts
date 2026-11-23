import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";
import { spawnProcess, type SpawnProcessOptions } from "../../../utils/spawn.js";
import { terminateWithTreeKill } from "../../../utils/tree-kill.js";

export interface TrackedDotnetProcess {
  child: ChildProcessWithoutNullStreams;
  release(): void;
}
function hasPipes(child: ChildProcess): child is ChildProcessWithoutNullStreams {
  return child.stdin !== null && child.stdout !== null && child.stderr !== null;
}
export class DotnetProcessLimitError extends Error {
  constructor(limit: number) {
    super(
      `Otto's shared .NET process limit (${limit}) is reached. Close an idle workspace or adjust Host → Code.`,
    );
    this.name = "DotnetProcessLimitError";
  }
}
/** One cap across C# language servers and solution probes. All launches use
 * Paseo's external-process environment and bounded tree termination. */
class DotnetProcessRegistry {
  private limit = 4;
  private readonly live = new Set<TrackedDotnetProcess>();
  private readonly stopping = new Set<Promise<void>>();
  constructor(private readonly logger: Logger) {}
  setLimit(limit: number) {
    this.limit = Math.max(1, Math.min(16, Math.trunc(limit)));
  }
  spawnTracked(input: {
    command: string;
    args: readonly string[];
    options: SpawnProcessOptions;
    kind: "language-server" | "solution-sidecar";
    label: string;
  }): TrackedDotnetProcess {
    if (this.live.size >= this.limit) throw new DotnetProcessLimitError(this.limit);
    const child = spawnProcess(input.command, [...input.args], {
      ...input.options,
      shell: false,
      stdio: "pipe",
      windowsHide: true,
      envOverlay: {
        ...input.options.envOverlay,
        MSBUILDDISABLENODEREUSE: "1",
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_NOLOGO: "1",
      },
    });
    if (!hasPipes(child)) {
      child.kill();
      throw new Error("The .NET process did not open communication streams.");
    }
    let released = false;
    const tracked: TrackedDotnetProcess = {
      child,
      release: () => {
        if (released) return;
        released = true;
        const stop = terminateWithTreeKill(child, { gracefulTimeoutMs: 1500, forceTimeoutMs: 1500 })
          .then(() => undefined)
          .catch((error) =>
            this.logger.warn(
              { err: error, kind: input.kind, owner: input.label },
              ".NET process cleanup failed",
            ),
          )
          .finally(() => {
            this.live.delete(tracked);
            this.stopping.delete(stop);
          });
        this.stopping.add(stop);
      },
    };
    this.live.add(tracked);
    child.once("exit", tracked.release);
    child.once("error", tracked.release);
    return tracked;
  }
  async stopAll() {
    for (const child of this.live) child.release();
    await Promise.all(this.stopping);
  }
}
let shared: DotnetProcessRegistry | null = null;
export function sharedDotnetProcessRegistry(logger: Logger) {
  shared ??= new DotnetProcessRegistry(logger);
  return shared;
}
export async function stopAllEditorDotnetProcesses() {
  await shared?.stopAll();
}
