/**
 * What `~/.local/bin/otto` should point at. The answer is the bundled CLI
 * wrapper (`resources/bin/otto`) everywhere the bundle has a stable path on
 * disk: it runs the CLI on a plain Node host (`ELECTRON_RUN_AS_NODE=1`), which
 * is what long-running commands like `otto brain serve` need. Linking the GUI
 * executable instead only appears to work — short commands complete before
 * Electron quits, and anything holding an open handle is killed with it.
 *
 * The AppImage is the one exception, and only because it has no stable shim
 * path: `resources/` lives inside the ephemeral `/tmp/.mount_*` and disappears
 * when the app exits, so the link has to be the AppImage file itself, whose
 * CLI passthrough re-execs into that same wrapper.
 */
export function resolveCliInstallSourcePath(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  executablePath: string;
  shimPath: string;
  appImagePath?: string | null;
}): string {
  if (input.platform === "win32") {
    return input.shimPath;
  }

  if (!input.isPackaged) {
    return input.shimPath;
  }

  if (input.platform === "darwin") {
    return input.shimPath;
  }

  if (input.platform === "linux") {
    const appImagePath = input.appImagePath?.trim();
    if (appImagePath) {
      return appImagePath;
    }
    return input.shimPath;
  }

  return input.executablePath;
}
