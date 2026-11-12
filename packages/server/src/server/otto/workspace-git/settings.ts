import path from "node:path";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  DEFAULT_GIT_FETCH_PREFERENCES,
  GitFetchPreferencesSchema,
  GitFetchPatchSchema,
  type GitFetchSettings,
} from "@getpaseo/plugin/otto/workspace-git";
import { writePrivateFileAtomicSync } from "../../private-files.js";

export class GitFetchSettingsError extends Error {
  constructor(
    readonly kind: "conflict" | "unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
const Legacy = z.object({
  daemon: z
    .object({
      gitFetch: GitFetchPreferencesSchema.partial().passthrough().optional(),
    })
    .optional(),
});
const Document = z.object({ version: z.literal(1), ...GitFetchPreferencesSchema.shape });
function bytes(file: string): string | null {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
      throw new Error("Unsafe Git fetch settings file");
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A private feature file avoids races with retained provider/team credentials in otto-config.json. */
export class GitFetchSettingsStore {
  private readonly file: string;
  private readonly legacy: string;
  constructor(home: string) {
    if (!path.isAbsolute(home)) throw new Error("Git settings require their owning host home.");
    this.file = path.join(home, "workspace-git", "settings.json");
    this.legacy = path.join(home, "otto-config.json");
  }
  private load() {
    try {
      try {
        const dir = lstatSync(path.dirname(this.file));
        if (!dir.isDirectory() || dir.isSymbolicLink())
          throw new Error("Unsafe settings directory");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const stored = bytes(this.file);
      // COMPAT(gitFetch09Settings): added v0.10.0; remove after 2027-05-12 once inherited preferences have explicit replacements.
      const legacy = stored === null ? bytes(this.legacy) : null;
      const inherited =
        legacy === null ? {} : (Legacy.parse(JSON.parse(legacy)).daemon?.gitFetch ?? {});
      const raw: unknown = stored === null ? {} : JSON.parse(stored);
      if (!object(raw)) throw new Error("Invalid settings document");
      if (stored !== null) Document.parse(raw);
      const preferences = GitFetchPreferencesSchema.parse({
        ...DEFAULT_GIT_FETCH_PREFERENCES,
        ...inherited,
        ...(stored === null ? {} : GitFetchPreferencesSchema.parse(raw)),
      });
      const revision = createHash("sha256")
        .update(JSON.stringify([stored, legacy]))
        .digest("hex");
      return { raw, preferences, revision };
    } catch (error) {
      throw new GitFetchSettingsError(
        "unavailable",
        "Git fetch settings could not be read. Existing files were left unchanged.",
        { cause: error },
      );
    }
  }
  read(): GitFetchSettings {
    const { preferences, revision } = this.load();
    return { preferences, revision };
  }
  save(expectedRevision: string, patch: unknown): GitFetchSettings {
    const changes = GitFetchPatchSchema.parse(patch),
      current = this.load();
    if (current.revision !== expectedRevision)
      throw new GitFetchSettingsError(
        "conflict",
        "Git fetch settings changed. Reload before saving.",
      );
    const next = GitFetchPreferencesSchema.parse({ ...current.preferences, ...changes });
    if (
      next.enabled === current.preferences.enabled &&
      next.intervalSeconds === current.preferences.intervalSeconds
    )
      return this.read();
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    if (lstatSync(path.dirname(this.file)).isSymbolicLink())
      throw new Error("Unsafe settings directory");
    writePrivateFileAtomicSync(
      this.file,
      JSON.stringify({ ...current.raw, version: 1, ...next }, null, 2) + "\n",
    );
    return this.read();
  }
}
