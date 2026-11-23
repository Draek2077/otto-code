/** Revisioned, synchronous transactions shared by the CLI and owning Brain host. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { BrainConfigSchema, type BrainConfig } from "./schema.js";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "./private-files.js";
import { resolveBrainPaths, type BrainPaths } from "./paths.js";

export class BrainConfigWriteError extends Error {
  constructor(
    readonly kind: "conflict" | "busy",
    options?: ErrorOptions,
  ) {
    super(
      kind === "conflict"
        ? "Brain configuration changed; reload before saving"
        : "Brain configuration is locked by another or interrupted writer",
      options,
    );
  }
}
function configBytes(paths: BrainPaths): string | null {
  try {
    return readFileSync(paths.configFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function revision(bytes: string | null): string {
  return createHash("sha256")
    .update(bytes === null ? "missing" : `stored:${bytes}`)
    .digest("hex");
}
export interface BrainConfigRevision {
  revision: string;
  config: BrainConfig;
}

/** Missing configuration is an in-memory default, never an implicit write. */
export function readBrainConfigRevision(
  paths: BrainPaths = resolveBrainPaths(),
): BrainConfigRevision {
  const bytes = configBytes(paths);
  return {
    revision: revision(bytes),
    config: BrainConfigSchema.parse(bytes === null ? {} : JSON.parse(bytes)),
  };
}

function attempt<T>(run: () => T): { ok: true; value: T } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** No waits or retries. A leftover claim requires owner inspection, never age-based deletion. */
export function updateBrainConfig(
  expectedRevision: string,
  update: (current: BrainConfig) => BrainConfig,
  paths: BrainPaths = resolveBrainPaths(),
): BrainConfigRevision {
  ensurePrivateDirectory(paths.root);
  const lock = `${paths.configFile}.lock`;
  const claim = JSON.stringify({ pid: process.pid, id: randomUUID() });
  try {
    writeFileSync(lock, claim, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new BrainConfigWriteError("busy", { cause: error });
    throw error;
  }
  const result = attempt(() => {
    const current = readBrainConfigRevision(paths);
    if (current.revision !== expectedRevision) throw new BrainConfigWriteError("conflict");
    const next = BrainConfigSchema.parse(update(current.config));
    // External editors do not participate in the claim. Detect edits before rename;
    // a filesystem editor racing the final compare/replace is outside this lock.
    if (revision(configBytes(paths)) !== expectedRevision)
      throw new BrainConfigWriteError("conflict");
    writePrivateFileAtomicSync(paths.configFile, `${JSON.stringify(next, null, 2)}\n`);
    return readBrainConfigRevision(paths);
  });
  const released = attempt(() => {
    if (readFileSync(lock, "utf8") !== claim) throw new BrainConfigWriteError("busy");
    unlinkSync(lock);
  });
  if (!result.ok && !released.ok)
    throw new AggregateError(
      [result.error, released.error],
      "Brain configuration write and cleanup failed",
      { cause: result.error },
    );
  if (!result.ok) throw result.error;
  if (!released.ok) throw released.error;
  return result.value;
}
