import { spawnProcess } from "@getpaseo/server/process";
import type { NodeEntrypointInvocation } from "../daemon/node-entrypoint-launcher.js";

/** A shutdown request cannot consume the supervisor's entire stop deadline. */
export function runBoundedDesktopCli(
  invocation: NodeEntrypointInvocation,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(invocation.command, invocation.args, {
      envMode: "internal",
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // This is the exact CLI child we spawned, never the daemon or an enumerated PID.
      child.kill();
      child.stdout?.destroy();
      child.stderr?.destroy();
      reject(
        new Error(
          `The daemon shutdown request did not complete within ${timeoutMs / 1000} seconds.`,
        ),
      );
    }, timeoutMs);
    child.stdout?.on("data", (data: Buffer) => {
      stdout = (stdout + data.toString()).slice(-65536);
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-65536);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ stdout, stderr, exitCode });
      }
    });
  });
}
