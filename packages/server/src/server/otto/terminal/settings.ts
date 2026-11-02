import path from "node:path";
import { readFileSync, lstatSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  TerminalPreferencesSchema,
  TerminalPreferencesPatchSchema,
  type TerminalPreferences,
} from "@getpaseo/plugin/otto/terminal";
import { writePrivateFileAtomicSync } from "../../private-files.js";
import { TerminalSettingsError } from "./errors.js";

const documentSchema = TerminalPreferencesPatchSchema.passthrough();
const legacySchema = z.object({ daemon: documentSchema.optional() }).passthrough();
const DEFAULTS: TerminalPreferences = {
  terminalTitleMode: "auto",
  terminalTitleIncludePaths: false,
  defaultTerminalShell: "system",
};

function bytes(file: string): string | null {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
      throw new Error("Unsafe terminal settings file");
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/** Own file avoids whole-document races with Brain and other retained 0.9 settings. */
export class TerminalSettingsStore {
  private readonly file: string;
  private readonly legacyFile: string;
  constructor(home: string) {
    if (!path.isAbsolute(home)) throw new Error("Terminal settings require the owning host home");
    this.file = path.join(home, "terminal", "settings.json");
    this.legacyFile = path.join(home, "otto-config.json");
  }
  private loadDocument() {
    try {
      const directory = lstatSync(path.dirname(this.file));
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw new Error("Unsafe terminal settings directory");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const stored = bytes(this.file);
    // COMPAT(terminal09Settings): added v0.10.0, remove after 2027-05-02 once inherited settings have explicit replacements.
    const legacy = stored === null ? bytes(this.legacyFile) : null;
    const inherited = legacy === null ? {} : legacySchema.parse(JSON.parse(legacy)).daemon;
    const document = stored === null ? {} : documentSchema.parse(JSON.parse(stored));
    const preferences = TerminalPreferencesSchema.parse({
      ...DEFAULTS,
      ...TerminalPreferencesPatchSchema.strip().parse(inherited ?? {}),
      ...TerminalPreferencesPatchSchema.strip().parse(document),
    });
    const revision = createHash("sha256")
      .update(JSON.stringify([stored, legacy]))
      .digest("hex");
    return { document, preferences, revision };
  }
  private load() {
    try {
      return this.loadDocument();
    } catch (error) {
      throw new TerminalSettingsError(
        "unavailable",
        "Host terminal settings could not be read. Existing files were left unchanged.",
        { cause: error },
      );
    }
  }
  read() {
    const { preferences, revision } = this.load();
    return { preferences, revision };
  }
  save(expectedRevision: string, patch: unknown) {
    const validated = TerminalPreferencesPatchSchema.parse(patch);
    const current = this.load();
    if (current.revision !== expectedRevision)
      throw new TerminalSettingsError(
        "conflict",
        "Terminal settings changed. Reload before saving.",
      );
    const next = TerminalPreferencesSchema.parse({ ...current.preferences, ...validated });
    // Compare and publish synchronously: daemon writers cannot interleave across an await.
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    if (lstatSync(path.dirname(this.file)).isSymbolicLink())
      throw new Error("Unsafe terminal settings directory");
    writePrivateFileAtomicSync(
      this.file,
      JSON.stringify({ ...current.document, ...next }, null, 2) + "\n",
    );
    return this.read();
  }
}
