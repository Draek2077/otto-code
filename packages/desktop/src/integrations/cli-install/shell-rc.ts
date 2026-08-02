import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import log from "electron-log/main";
import { ensureWindowsUserPath } from "./windows-path.js";

export interface ShellRcInfo {
  shell: string;
  rcFile: string;
  pathCheckPattern: RegExp;
  exportLine: string;
}

async function pathOrSymlinkExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

export function detectShellRcInfo(): ShellRcInfo | null {
  if (process.platform === "win32") return null;

  const shell = process.env.SHELL;
  if (!shell) return null;

  const shellName = path.basename(shell);

  if (shellName === "zsh") {
    return {
      shell: "zsh",
      rcFile: path.join(os.homedir(), ".zshrc"),
      pathCheckPattern: /\.local\/bin/,
      exportLine: 'export PATH="$HOME/.local/bin:$PATH"',
    };
  }

  if (shellName === "bash") {
    const rcFile =
      process.platform === "darwin"
        ? path.join(os.homedir(), ".bash_profile")
        : path.join(os.homedir(), ".bashrc");
    return {
      shell: "bash",
      rcFile,
      pathCheckPattern: /\.local\/bin/,
      exportLine: 'export PATH="$HOME/.local/bin:$PATH"',
    };
  }

  if (shellName === "fish") {
    return {
      shell: "fish",
      rcFile: path.join(os.homedir(), ".config", "fish", "config.fish"),
      pathCheckPattern: /\.local\/bin/,
      exportLine: "fish_add_path $HOME/.local/bin",
    };
  }

  return null;
}

export function pathAlreadyContainsLocalBin(): boolean {
  const pathEnv = process.env.PATH ?? "";
  const localBin = path.join(os.homedir(), ".local", "bin");
  return pathEnv.split(path.delimiter).some((p) => p === localBin || p === "~/.local/bin");
}

export async function ensurePathInShellRc(): Promise<{ shellUpdated: boolean }> {
  // Windows has no rc file. `~/.local/bin` is a POSIX convention that Windows
  // never puts on PATH, so without this the shim we just wrote is unreachable.
  // The registry is authoritative here: process.env.PATH was inherited from
  // Explorer at launch and can be stale.
  if (process.platform === "win32") {
    const binDir = path.join(os.homedir(), ".local", "bin");
    try {
      const { updated } = await ensureWindowsUserPath(binDir);
      return { shellUpdated: updated };
    } catch (err) {
      log.warn("[integrations] Failed to register ~/.local/bin on the user PATH", { binDir, err });
      return { shellUpdated: false };
    }
  }

  if (pathAlreadyContainsLocalBin()) {
    return { shellUpdated: false };
  }

  const info = detectShellRcInfo();
  if (!info) {
    return { shellUpdated: false };
  }

  try {
    const exists = await pathOrSymlinkExists(info.rcFile);
    if (exists) {
      const content = await fs.readFile(info.rcFile, "utf-8");
      if (info.pathCheckPattern.test(content)) {
        return { shellUpdated: false };
      }
    }

    await fs.mkdir(path.dirname(info.rcFile), { recursive: true });
    await fs.appendFile(info.rcFile, `\n# Added by Otto\n${info.exportLine}\n`);

    return { shellUpdated: true };
  } catch (err) {
    log.warn("[integrations] Failed to update shell rc file", { rcFile: info.rcFile, err });
    return { shellUpdated: false };
  }
}
