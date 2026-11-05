import path from "node:path";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { EditorPreferences, EditorPreferencesPatch } from "@getpaseo/plugin/otto/editor";
import { writePrivateFileAtomicSync } from "../../private-files.js";
import { EditorError } from "./errors.js";
import type { PoolPolicy } from "./lsp/pool.js";

const Document = EditorPreferences.partial().passthrough();
// COMPAT(editor09NumericPolicy): added v0.10.0, remove after 2027-05-04.
// Old hosts accepted arbitrary positive budgets. Preserve their intent within
// the new bounded pool instead of rejecting the user's entire configuration.
const LegacyLsp = z
  .object({
    enabled: z.boolean().optional(),
    languages: z.record(z.string(), z.boolean()).optional(),
    csharpProjectScope: z.enum(["solution", "allProjects"]).optional(),
    maxRunningServers: z.number().int().positive().optional(),
    idleMinutes: z.number().int().positive().optional(),
    backgroundIdleMinutes: z.number().int().positive().optional(),
  })
  .passthrough();
const Legacy = z
  .object({
    daemon: z
      .object({
        lsp: LegacyLsp.optional(),
        dotnetSolutionManagement: z
          .object({
            enabled: z.boolean().optional(),
            maxRunningProbes: z.number().int().positive().optional(),
            idleMinutes: z.number().int().positive().optional(),
          })
          .passthrough()
          .optional(),
        dotnet: z
          .object({ maxProcesses: z.number().int().positive().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const defaults: z.infer<typeof EditorPreferences> = {
  enabled: true,
  languages: {},
  csharpProjectScope: "solution",
  maxRunningServers: 4,
  idleMinutes: 10,
  backgroundIdleMinutes: 2,
  solutionEnabled: false,
  solutionMaxProbes: 2,
  solutionIdleMinutes: 10,
  dotnetMaxProcesses: 4,
};
function read(file: string): string | null {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
      throw new EditorError("invalid", "Unsafe editor settings file.");
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
function assertSettingsDirectory(directoryPath: string) {
  try {
    const directory = lstatSync(directoryPath);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new EditorError("invalid", "Unsafe editor settings directory.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

function inheritLegacy(legacy: string | null) {
  const daemon = legacy === null ? {} : (Legacy.parse(JSON.parse(legacy)).daemon ?? {});
  const solution = daemon.dotnetSolutionManagement;
  return {
    ...daemon.lsp,
    maxRunningServers: Math.min(16, daemon.lsp?.maxRunningServers ?? defaults.maxRunningServers),
    idleMinutes: Math.min(120, daemon.lsp?.idleMinutes ?? defaults.idleMinutes),
    backgroundIdleMinutes: Math.min(
      120,
      daemon.lsp?.backgroundIdleMinutes ?? defaults.backgroundIdleMinutes,
    ),
    solutionEnabled: solution?.enabled ?? defaults.solutionEnabled,
    solutionMaxProbes: Math.min(8, solution?.maxRunningProbes ?? defaults.solutionMaxProbes),
    solutionIdleMinutes: Math.min(120, solution?.idleMinutes ?? defaults.solutionIdleMinutes),
    dotnetMaxProcesses: Math.min(16, daemon.dotnet?.maxProcesses ?? defaults.dotnetMaxProcesses),
  };
}
export class EditorSettingsStore {
  private readonly file: string;
  private cached: z.infer<typeof EditorPreferences> | null = null;
  constructor(private readonly home: string) {
    if (!path.isAbsolute(home))
      throw new EditorError("invalid", "Editor settings require the owning host home.");
    this.file = path.join(home, "editor", "settings.json");
  }
  private load() {
    assertSettingsDirectory(path.dirname(this.file));
    const stored = read(this.file);
    // COMPAT(editor09Settings): added v0.10.0, remove after 2027-05-04 once users have explicit replacements.
    const legacy = stored === null ? read(path.join(this.home, "otto-config.json")) : null;
    const inherited = inheritLegacy(legacy);
    const document = stored === null ? {} : Document.parse(JSON.parse(stored));
    const preferences = EditorPreferences.parse({ ...defaults, ...inherited, ...document });
    const revision = createHash("sha256")
      .update(JSON.stringify([stored, legacy]))
      .digest("hex");
    return { preferences, revision, document };
  }
  read() {
    const { preferences, revision } = this.load();
    this.cached = preferences;
    return { preferences, revision };
  }
  current() {
    return this.cached ?? this.read().preferences;
  }
  policy(): PoolPolicy {
    const preferences = this.current();
    return {
      enabled: preferences.enabled,
      languages: preferences.languages,
      maxServers: preferences.maxRunningServers,
      idleMs: preferences.idleMinutes * 60000,
      backgroundIdleMs: preferences.backgroundIdleMinutes * 60000,
      allCsharpProjects: preferences.csharpProjectScope === "allProjects",
    };
  }
  save(expectedRevision: string, patch: unknown) {
    const validated = EditorPreferencesPatch.parse(patch);
    const current = this.load();
    if (current.revision !== expectedRevision)
      throw new EditorError("conflict", "Code settings changed. Reload before saving.");
    const preferences = EditorPreferences.parse({ ...current.preferences, ...validated });
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    if (lstatSync(path.dirname(this.file)).isSymbolicLink())
      throw new EditorError("invalid", "Unsafe editor settings directory.");
    writePrivateFileAtomicSync(
      this.file,
      JSON.stringify({ ...current.document, ...preferences }, null, 2) + "\n",
    );
    return this.read();
  }
}
