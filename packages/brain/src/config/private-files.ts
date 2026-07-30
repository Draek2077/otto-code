/**
 * Private-file helpers mirroring the daemon's `private-files.ts`: directories are
 * created `0700`, files written `0600`, and every write is atomic (temp + rename)
 * so a crash mid-write never leaves a truncated config on disk. chmod is
 * best-effort because Windows POSIX-mode support is partial.
 */
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function ensurePrivateDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  try {
    chmodSync(dir, DIR_MODE);
  } catch {
    // best effort: Windows filesystems may reject POSIX modes
  }
}

export function writePrivateFileAtomicSync(filePath: string, contents: string): void {
  ensurePrivateDirectory(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, { mode: FILE_MODE });
  renameSync(tmp, filePath);
  try {
    chmodSync(filePath, FILE_MODE);
  } catch {
    // best effort
  }
}
