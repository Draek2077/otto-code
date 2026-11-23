import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ProviderPersistence } from "../../../server/provider.js";

const pointerSchema = z.object({ format: z.literal("otto-openai-host-session-v1"), id: z.uuid() });
const stateSchema = z.object({ format: z.literal("otto-openai-compatible-v1") }).passthrough();
const maxBytes = 128 * 1024 * 1024;
function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
function read(file: string): string | undefined {
  try {
    if (statSync(file).size > maxBytes)
      throw new Error("Conversation archive exceeds 128 MiB. Its saved history was left intact.");
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function atomicWrite(file: string, raw: string): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, raw, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* A cleanup failure must not hide the checkpoint operation's error. */
    }
  }
}

export function preserveImport(input: {
  directory: string;
  value: ProviderPersistence["data"];
}): void {
  const raw = JSON.stringify(input.value);
  const file = path.join(input.directory, `${hash(raw)}.json`);
  const existing = read(file);
  if (existing === undefined) atomicWrite(file, raw);
  else if (existing !== raw)
    throw new Error("The original conversation backup changed. It was left intact.");
}

/** Native conversation identity means the latest host archive, like other Paseo providers.
 * The opaque handle never contains a transcript or a host path. Checkpoints are atomic and
 * concurrent live sessions cannot overwrite one another's newer state.
 */
export class SessionArchive {
  readonly id: string;
  private readonly file: string;
  private revision: string | undefined;
  readonly restored: ProviderPersistence | undefined;
  constructor(
    private readonly directory: string,
    persistence?: ProviderPersistence,
  ) {
    if (!path.isAbsolute(directory))
      throw new Error("Conversation storage requires an absolute host directory.");
    const data = persistence?.data;
    const native =
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      data.format === "otto-openai-host-session-v1";
    if (native) {
      if (persistence.version !== 1)
        throw new Error(
          "This conversation archive needs a supported migration. Its history was left intact.",
        );
      const pointer = pointerSchema.parse(data);
      this.id = pointer.id;
      this.file = path.join(directory, `${this.id}.json`);
      const raw = read(this.file);
      if (raw === undefined)
        throw new Error(
          "The host conversation archive is missing. Restore it before resuming this chat.",
        );
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
        stateSchema.parse(parsed);
      } catch {
        throw new Error(
          "The host conversation archive is invalid. Its saved history was left intact.",
        );
      }
      this.restored = { version: 1, data: z.json().parse(parsed) };
      this.revision = hash(raw);
    } else {
      this.id = randomUUID();
      this.file = path.join(directory, `${this.id}.json`);
      this.restored = persistence;
      if (persistence) {
        // COMPAT(inlineProviderArchive): v0.10.0, review after 2027-04-22.
        // Preserve the exact earlier checkpoint before replacing its core handle.
        preserveImport({
          directory: path.join(directory, "imports"),
          value: z.json().parse(persistence),
        });
      }
    }
  }
  save(data: ProviderPersistence["data"]): ProviderPersistence {
    stateSchema.parse(data);
    const raw = JSON.stringify(data);
    if (Buffer.byteLength(raw) > maxBytes)
      throw new Error("Conversation archive exceeds 128 MiB. Its saved history was left intact.");
    const current = read(this.file);
    if ((current === undefined ? undefined : hash(current)) !== this.revision)
      throw new Error(
        "This conversation changed in another live session. Reopen it before continuing; saved history was left intact.",
      );
    atomicWrite(this.file, raw);
    this.revision = hash(raw);
    return { version: 1, data: { format: "otto-openai-host-session-v1", id: this.id } };
  }
}
