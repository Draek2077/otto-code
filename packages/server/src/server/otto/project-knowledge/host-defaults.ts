import path from "node:path";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { writeJsonFileAtomic } from "../../atomic-file.js";
import { digest } from "./markdown-page.js";
import { hasCode, type KnowledgeLocation } from "./store-resolver.js";

const location = z.enum(["repository", "host"]);
const preferences = z
  .object({ version: z.literal(1), defaultStoreLocation: location })
  .passthrough();
const retained = z
  .object({ projectKnowledge: z.object({ defaultStoreLocation: location.optional() }).optional() })
  .passthrough();
const queues = new Map<string, Promise<unknown>>();
export interface KnowledgeHostDefaults {
  revision: string;
  defaultStoreLocation: KnowledgeLocation;
}
export interface KnowledgeHostDefaultsWrite {
  expectedRevision: string;
  defaultStoreLocation: KnowledgeLocation;
  /** Trusted daemon composition only: preserve initialized inherited project
   * stores before publishing a new default. Never accepts a wire callback. */
  preserveAndPublish?(input: {
    current: KnowledgeHostDefaults;
    publish(): Promise<KnowledgeHostDefaults>;
  }): Promise<KnowledgeHostDefaults>;
}
export class KnowledgeHostDefaultsError extends Error {
  constructor(
    readonly kind: "conflict" | "unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
/** Feature-owned, nonsecret host preference. The retained Otto document remains
 * read-only, so Brain/provider writes cannot race a whole-document replacement. */
export class KnowledgeHostDefaultsStore {
  private readonly directory: string;
  private readonly file: string;
  private readonly legacyFile: string;
  constructor(home: string) {
    if (!path.isAbsolute(home)) throw new Error("Knowledge defaults require the owning host home");
    this.directory = path.join(home, "project-knowledge");
    this.file = path.join(this.directory, "settings.json");
    this.legacyFile = path.join(home, "otto-config.json");
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const key = process.platform === "win32" ? this.file.toLowerCase() : this.file;
    const task = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
    queues.set(key, task);
    return task.finally(() => {
      if (queues.get(key) === task) queues.delete(key);
    });
  }
  private async bytes(file: string): Promise<string | null> {
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("Unsafe host preferences file");
      return await readFile(file, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }
  private async checkDirectory() {
    try {
      const info = await lstat(this.directory);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error("Unsafe host preferences directory");
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  private async load() {
    try {
      await this.checkDirectory();
      const stored = await this.bytes(this.file);
      const document = stored === null ? null : preferences.parse(JSON.parse(stored));
      // COMPAT(knowledgeHostDefaults): added v0.10.0; removal target 2027-04-24,
      // only after retained defaults have an explicit persisted replacement.
      const legacy = stored === null ? await this.bytes(this.legacyFile) : null;
      const inherited = legacy === null ? undefined : retained.parse(JSON.parse(legacy));
      const defaultStoreLocation =
        document?.defaultStoreLocation ??
        inherited?.projectKnowledge?.defaultStoreLocation ??
        "repository";
      return {
        document,
        snapshot: { revision: digest(JSON.stringify({ stored, legacy })), defaultStoreLocation },
      };
    } catch (error) {
      throw new KnowledgeHostDefaultsError(
        "unavailable",
        "Host Knowledge settings could not be read; existing settings were left unchanged.",
        { cause: error },
      );
    }
  }
  read(): Promise<KnowledgeHostDefaults> {
    return this.exclusive(async () => (await this.load()).snapshot);
  }
  save(input: KnowledgeHostDefaultsWrite): Promise<KnowledgeHostDefaults> {
    return this.exclusive(async () => {
      const selected = location.parse(input.defaultStoreLocation);
      const current = await this.load();
      if (current.snapshot.revision !== input.expectedRevision)
        throw new KnowledgeHostDefaultsError(
          "conflict",
          "Host Knowledge settings changed. Reload before saving.",
        );
      const publish = async () => {
        if ((await this.load()).snapshot.revision !== current.snapshot.revision)
          throw new KnowledgeHostDefaultsError(
            "conflict",
            "Host Knowledge settings changed before publication. Reload before another explicit attempt.",
          );
        await this.checkDirectory();
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await this.checkDirectory();
        await writeJsonFileAtomic(this.file, {
          ...current.document,
          version: 1,
          defaultStoreLocation: selected,
        });
        return (await this.load()).snapshot;
      };
      return input.preserveAndPublish
        ? input.preserveAndPublish({ current: current.snapshot, publish })
        : publish();
    });
  }
}
