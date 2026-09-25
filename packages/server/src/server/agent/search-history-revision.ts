import { readFile, stat } from "node:fs/promises";

/** A cheap change hint. Periodic full reads also cover preserved timestamps. */
export async function searchHistoryFileRevision(path: string): Promise<string> {
  const info = await stat(path);
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}

/** Tolerant display replayers must not turn a truncated native log into a complete search source. */
export async function validateSearchHistoryJsonl(path: string): Promise<void> {
  const content = await readFile(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid native chat history record");
  }
}
