// Paseo's runtime schemas intentionally strip fields they do not own. Preserve
// those fields only at the disk boundary so editing a project or chat cannot
// discard Otto 0.9 settings before their owning features return. Known fields
// remain entirely Paseo-owned, including explicit removal and record deletion.
import { readFile } from "node:fs/promises";
import { writeJsonFileAtomic } from "../atomic-file.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// COMPAT(otto09WorkspaceFields): added in v0.10.0, remove after 2027-04-21 once persisted homes have migrated.
export function normalizeOttoWorkspaceRecord(value: unknown): unknown {
  if (!isObject(value) || typeof value.workspaceId !== "string") return value;
  return {
    ...value,
    ...(value.isPaseoOwnedWorktree === undefined && typeof value.isOttoOwnedWorktree === "boolean"
      ? { isPaseoOwnedWorktree: value.isOttoOwnedWorktree }
      : {}),
    ...(value.background === undefined && typeof value.hidden === "boolean"
      ? { background: value.hidden }
      : {}),
  };
}

function preserveUnknownFields(original: unknown, parsed: unknown, next: unknown): unknown {
  if (Array.isArray(original) && Array.isArray(parsed) && Array.isArray(next)) {
    return next.map((item: unknown) => {
      if (!isObject(item) || typeof item.id !== "string") return item;
      const index = parsed.findIndex((old: unknown) => isObject(old) && old.id === item.id);
      return index < 0 ? item : preserveUnknownFields(original[index], parsed[index], item);
    });
  }
  if (!isObject(original) || !isObject(parsed) || !isObject(next)) return next;
  const result = { ...next };
  for (const [key, value] of Object.entries(original)) {
    if (!Object.hasOwn(parsed, key) && !Object.hasOwn(next, key)) {
      Object.defineProperty(result, key, { value, enumerable: true, configurable: true });
    } else if (Object.hasOwn(next, key)) {
      Object.defineProperty(result, key, {
        value: preserveUnknownFields(value, parsed[key], next[key]),
        enumerable: true,
        configurable: true,
      });
    }
  }
  return result;
}

async function readPrevious(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeOttoAgentRecord<T>(
  file: string,
  record: T,
  previousFile: string | undefined,
  parse: (value: unknown) => T,
): Promise<void> {
  const original = await readPrevious(previousFile ?? file);
  const saved =
    original === undefined ? record : preserveUnknownFields(original, parse(original), record);
  await writeJsonFileAtomic(file, saved);
}

export async function writeOttoRegistry<T>(
  file: string,
  records: readonly T[],
  parse: (value: unknown) => T,
  getId: (record: T) => string,
): Promise<void> {
  const original = await readPrevious(file);
  if (original === undefined) return writeJsonFileAtomic(file, records);
  if (!Array.isArray(original)) throw new Error(`Invalid registry in ${file}`);
  const previous = new Map(
    original.map((raw: unknown) => {
      const parsed = parse(raw);
      return [getId(parsed), { raw, parsed }];
    }),
  );
  const saved = records.map((record) => {
    const old = previous.get(getId(record));
    return old ? preserveUnknownFields(old.raw, old.parsed, record) : record;
  });
  await writeJsonFileAtomic(file, saved);
}
