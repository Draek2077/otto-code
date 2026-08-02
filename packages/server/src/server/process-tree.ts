import { spawn, type ChildProcess } from "node:child_process";

/**
 * Kill a child process *and everything it spawned*.
 *
 * `ChildProcess.kill()` signals one process. That is enough for a self-contained
 * server, and wrong for anything that shells out: on Windows a `.cmd` shim means the
 * process we hold is `cmd.exe` and the real server is its child, and an MSBuild-backed
 * language server leaves worker nodes of its own. Killing only the named process left
 * those behind with no parent to reap them, which is how a machine ends up with dozens
 * of resident `dotnet` processes after a few workspace visits.
 *
 * Windows has no process groups to signal, so `taskkill /T` is the only way to reach
 * the tree. POSIX keeps the direct signal: our children are not started detached, so
 * they have no group of their own to address, and the subsystems that could orphan
 * grandchildren (see MSBUILD_ENV) are configured not to.
 */
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
  const pid = child.pid;

  if (process.platform !== "win32" || pid === undefined) {
    child.kill(signal);
    return;
  }

  // Never taskkill a pid we no longer own. Windows recycles pids aggressively,
  // and this call is fire-and-forget and detached: if the child has already
  // exited, the pid may belong to something else entirely by the time taskkill
  // runs, and `/T /F` would take that stranger and its whole tree down without a
  // trace. POSIX has no such exposure, because there the signal goes to a handle
  // rather than a number.
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    // Detached with ignored stdio: this is fire-and-forget cleanup, and a taskkill
    // that outlives the caller is better than one that blocks shutdown. `/F` because
    // a language server that missed its shutdown handshake will not leave politely.
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });
    killer.unref();
    // A failed taskkill (process already gone, or no permission) must not become an
    // unhandled 'error' event on a process nobody is listening to.
    killer.on("error", () => {});
  } catch {
    // Fall through to the direct kill below.
  }

  // Always signal directly too: taskkill is asynchronous, and if it cannot run at all
  // this is still the behaviour we had before.
  child.kill(signal);
}

/**
 * Environment every MSBuild-backed child gets.
 *
 * `MSBUILDDISABLENODEREUSE` is the important one. By default MSBuild keeps its worker
 * nodes alive for 15 minutes after a build so the next build can reuse them, and each
 * node is a separate `dotnet` process. A language server that loads a solution on
 * every workspace visit therefore leaves a growing pile of them behind, outliving the
 * server we reaped and answering to nobody. We trade a slightly slower cold project
 * load for nodes that exit with the work that started them.
 */
export const MSBUILD_ENV: Readonly<Record<string, string>> = {
  MSBUILDDISABLENODEREUSE: "1",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_NOLOGO: "1",
};
