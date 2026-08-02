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
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}
