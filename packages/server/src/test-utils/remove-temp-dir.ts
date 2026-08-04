import { rmSync } from "node:fs";
import { rm } from "node:fs/promises";

/**
 * Delete a throwaway test directory, tolerating Windows file locking.
 *
 * Windows refuses to remove a directory while any process still holds a handle
 * inside it - a PTY sitting in it as its cwd, a git child that has not fully
 * exited, or an antivirus scanner mid-scan. The OS reports that as EPERM (and
 * sometimes EBUSY), so a bare `rmSync` fails a suite whose assertions all
 * passed, which reads as a product bug when it is only cleanup losing a race.
 *
 * `fs.rm` retries on exactly these codes when `maxRetries` is set, with a
 * linear backoff, which clears the transient case. If a handle outlives the
 * retries, that is still not worth failing a green test over: the directory
 * lives under the OS temp dir and the OS reclaims it.
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    rethrowUnlessLocked(error);
  }
}

/** {@link removeTempDir} for suites whose teardown is already async. */
export async function removeTempDirAsync(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    rethrowUnlessLocked(error);
  }
}

function rethrowUnlessLocked(error: unknown): void {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") {
    throw error;
  }
}
