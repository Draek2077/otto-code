import { readFileSync } from "node:fs";

/**
 * Detects whether the daemon process is running inside WSL (WSL1 or WSL2).
 *
 * WSL sets WSL_DISTRO_NAME/WSL_INTEROP for interactive shells, but a daemon
 * launched non-interactively (systemd, a background service) may not inherit
 * them, so fall back to the kernel version string, which WSL always patches
 * to mention "microsoft".
 */
export function isRunningInWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) {
    return true;
  }

  if (process.platform !== "linux") {
    return false;
  }

  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}
