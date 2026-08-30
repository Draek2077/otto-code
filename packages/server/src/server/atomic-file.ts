import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function writeFileAtomic(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  options?: { mode?: number },
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, data, { encoding: "utf8", mode: options?.mode });
    // chmod after create, because the mode passed to open() is masked by the
    // process umask: a caller preserving 0o764 across a replacement got 0o744
    // under the usual 0o022, silently dropping group write from every file the
    // explorer saved. chmod is not masked, so the requested mode survives.
    if (options?.mode !== undefined) {
      await fs.chmod(tempPath, options.mode);
    }
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

// Windows refuses to rename over a file another handle currently has open
// (EPERM/EBUSY rather than POSIX's silent replace). Anything that reads a
// record on a timer - the artifact watcher polls every ready artifact's JSON
// once a second - can therefore collide with a writer for a few
// milliseconds. Retry briefly; a persistent failure still surfaces.
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_ATTEMPTS = 6;
const RENAME_RETRY_BASE_DELAY_MS = 10;

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (!code || !RENAME_RETRY_CODES.has(code) || attempt >= RENAME_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RENAME_RETRY_BASE_DELAY_MS * 2 ** attempt),
      );
    }
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}
