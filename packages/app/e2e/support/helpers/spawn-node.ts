import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { once } from "node:events";

/**
 * Runs a repo-local TypeScript entrypoint through Node's own tsx loader instead
 * of the `node_modules/.bin/tsx` shim.
 *
 * The shim is a platform trap, not a convenience: on Windows it is `tsx.cmd`,
 * and Node refuses to spawn `.cmd`/`.bat` without `shell: true` (EINVAL, from
 * the CVE-2024-27980 mitigation). Opting into `shell: true` to get around that
 * trades one bug for three — argv is concatenated unescaped (DEP0190), a path
 * containing spaces splits, and the kill signal lands on `cmd.exe` while the
 * real child keeps the port. Spawning `process.execPath` has none of those
 * properties and is byte-identical on POSIX, so there is no platform branch.
 */
export function spawnTsx(entrypoint: string, args: string[], options: SpawnOptions): ChildProcess {
  if (entrypoint.startsWith("-")) {
    throw new Error(`TypeScript entrypoint must be a path, received ${entrypoint}`);
  }
  return spawn(process.execPath, ["--import", "tsx", "--", entrypoint, ...args], options);
}

/**
 * Terminates a child and everything it forked, then waits for the exit.
 *
 * `child.kill()` on Windows maps to `TerminateProcess` against the direct child
 * only. Metro and the daemon supervisor both fork workers, so the signal leaves
 * grandchildren holding the listening port and the next run fails to bind.
 * `taskkill /T` walks the tree; POSIX keeps the SIGTERM-then-SIGKILL ladder.
 */
export async function killProcessTree(child: ChildProcess | null): Promise<void> {
  if (!child || hasExited(child)) return;
  const exited = once(child, "exit").then(() => undefined);

  if (process.platform === "win32") {
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error("Cannot terminate a Windows process tree without a PID");
    }
    const ownedPids = await snapshotProcessTree(pid);

    // Register the exit listener before taskkill to avoid missing a fast exit.
    // Bound taskkill itself so a stuck system utility cannot hang teardown.
    const completed = Promise.withResolvers<Error | null>();
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { timeout: 5_000 }, (error) =>
      completed.resolve(error),
    );
    const taskkillError = await completed.promise;
    if (taskkillError && !hasExited(child) && processExists(pid)) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The child can exit between the state check and the direct kill.
      }
    }
    // The OS can finish termination before Node delivers the child exit event.
    if (!hasExited(child)) await waitForExitOrTimeout(exited, 5_000);
    const remaining = ownedPids.filter(processExists);
    if (remaining.length > 0) {
      throw new Error(
        `Process tree for PID ${pid} still has live processes: ${remaining.join(", ")}`,
        {
          cause: taskkillError,
        },
      );
    }
    return;
  }

  child.kill("SIGTERM");
  if (await waitForExitOrTimeout(exited, 5_000)) return;

  child.kill("SIGKILL");
  if (!(await waitForExitOrTimeout(exited, 5_000))) {
    throw new Error(`Process ${String(child.pid)} did not exit after SIGKILL`);
  }
}

async function snapshotProcessTree(rootPid: number): Promise<number[]> {
  // Capture descendants before termination: intermediates can exit while
  // taskkill walks the tree, leaving a worker without a live parent to query.
  const rows = await new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
      ],
      { timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
  const processes = JSON.parse(rows) as { ProcessId: number; ParentProcessId: number }[];
  const owned = new Set([rootPid]);
  for (const parent of owned) {
    for (const process of processes) {
      if (process.ParentProcessId === parent) owned.add(process.ProcessId);
    }
  }
  return [...owned];
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExitOrTimeout(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  const timedOut = Promise.withResolvers<boolean>();
  const timeout = setTimeout(() => timedOut.resolve(false), timeoutMs);
  try {
    return await Promise.race([exited.then(() => true), timedOut.promise]);
  } finally {
    clearTimeout(timeout);
  }
}
