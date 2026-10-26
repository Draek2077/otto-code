import path from "node:path";
import { open, opendir, realpath, stat } from "node:fs/promises";
import { instructionDigest } from "@getpaseo/plugin/server/otto-openai";
import { readContextSource } from "./source-read.js";
import { withContextCleanup } from "./cleanup.js";

const omitted = new Set([
  ".git",
  "node_modules",
  ".tmp",
  ".dev",
  "dist",
  "build",
  "coverage",
  ".next",
  ".expo",
]);
export interface NativeFile {
  file: string;
  text: string;
  contextStart?: number;
}
function missing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
/** One bounded read budget per report, not a watcher or an unbounded recursive glob. */
export class NativeContextFiles {
  readonly notes: string[] = [];
  private readonly cache = new Map<string, NativeFile | null>();
  private readonly failures = new Map<string, "missing" | "unavailable">();
  private bytes = 0;
  private entries = 0;
  private directories = 0;
  private capped = false;
  constructor(private readonly limits = { bytes: 1048576, entries: 2048, directories: 256 }) {}

  note(message: string): void {
    if (!this.notes.includes(message)) this.notes.push(message);
  }
  private cap(): void {
    this.capped = true;
    this.note("Context discovery reached its bounded filesystem limit; this inventory is partial.");
  }
  failure(candidate: string): "missing" | "unavailable" {
    return this.failures.get(candidate) ?? "unavailable";
  }
  async identity(candidate: string): Promise<{ file: string; revision: string } | null> {
    try {
      const file = await realpath(candidate);
      const info = await stat(file);
      if (!info.isFile()) {
        this.failures.set(candidate, "unavailable");
        return null;
      }
      this.failures.delete(candidate);
      return {
        file,
        revision: instructionDigest(
          JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]),
        ),
      };
    } catch (error) {
      this.failures.set(candidate, missing(error) ? "missing" : "unavailable");
      if (!missing(error))
        this.note(`Could not inspect the identity of ${path.basename(candidate)}.`);
      return null;
    }
  }
  async header(candidate: string): Promise<(NativeFile & { revision: string }) | null> {
    if (this.capped) return null;
    const identity = await this.identity(candidate);
    if (!identity) return null;
    try {
      const handle = await open(identity.file, "r");
      const bytes = await withContextCleanup(
        async () => {
          const buffer = Buffer.alloc(16384);
          const result = await handle.read(buffer, 0, buffer.length, 0);
          return buffer.subarray(0, result.bytesRead);
        },
        () => handle.close(),
      );
      if (this.bytes + bytes.length > this.limits.bytes) {
        this.cap();
        return null;
      }
      this.bytes += bytes.length;
      if ((await this.identity(candidate))?.revision !== identity.revision) {
        this.note("A skill/subagent changed while its descriptor was read; refresh to inspect it.");
        return null;
      }
      return { ...identity, text: bytes.toString("utf8") };
    } catch (error) {
      if (!missing(error))
        this.note(`Could not inspect the descriptor in ${path.basename(candidate)}.`);
      return null;
    }
  }
  async read(candidate: string): Promise<NativeFile | null> {
    const prior = this.cache.get(candidate);
    if (prior !== undefined) return prior;
    if (this.capped) return null;
    try {
      const file = await realpath(candidate);
      const cached = this.cache.get(file);
      if (cached !== undefined) return cached;
      const text = await readContextSource(file);
      const size = Buffer.byteLength(text, "utf8");
      if (this.bytes + size > this.limits.bytes) {
        this.cap();
        return null;
      }
      this.bytes += size;
      const value = { file, text };
      this.failures.delete(candidate);
      this.cache.set(file, value);
      this.cache.set(candidate, value);
      return value;
    } catch (error) {
      if (!missing(error))
        this.note(`Could not inspect ${path.basename(candidate)} as bounded UTF-8 context text.`);
      this.cache.set(candidate, null);
      this.failures.set(candidate, missing(error) ? "missing" : "unavailable");
      return null;
    }
  }
  async children(
    directory: string,
  ): Promise<{ file: string; directory: boolean; link: boolean }[]> {
    if (this.capped) return [];
    if (++this.directories > this.limits.directories) {
      this.cap();
      return [];
    }
    const result = [];
    try {
      const handle = await opendir(directory);
      for await (const entry of handle) {
        if (++this.entries > this.limits.entries) {
          this.cap();
          break;
        }
        if (omitted.has(entry.name)) continue;
        result.push({
          file: path.join(directory, entry.name),
          directory: entry.isDirectory(),
          link: entry.isSymbolicLink(),
        });
      }
    } catch (error) {
      if (!missing(error))
        this.note(`Could not inspect the ${path.basename(directory)} context directory.`);
    }
    return result.sort((a, b) => a.file.localeCompare(b.file));
  }
  async walk(root: string, accept: (relative: string) => boolean): Promise<string[]> {
    const result: string[] = [];
    const queue = [root];
    for (let index = 0; index < queue.length && !this.capped; index++) {
      const directory = queue[index]!;
      for (const child of await this.children(directory)) {
        // Explicit skill aliases are handled separately; recursive discovery never follows directory links.
        if (child.link) continue;
        if (child.directory) queue.push(child.file);
        else if (accept(path.relative(root, child.file).split(path.sep).join("/")))
          result.push(child.file);
      }
    }
    return result;
  }
}
