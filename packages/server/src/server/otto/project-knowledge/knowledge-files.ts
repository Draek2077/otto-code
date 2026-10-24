import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  rmdir,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { digest } from "./markdown-page.js";
import { hasCode, type KnowledgeStore } from "./store-resolver.js";

export class KnowledgeConflictError extends Error {
  constructor() {
    super("Knowledge changed; read it again before saving");
    this.name = "KnowledgeConflictError";
  }
}

export class KnowledgeBusyError extends Error {
  constructor() {
    super("Knowledge store is locked; inspect the owning writer before recovery");
    this.name = "KnowledgeBusyError";
  }
}

const queues = new Map<string, Promise<unknown>>();

export interface KnowledgeReplacementPorts {
  openStagedFile: (file: string) => Promise<FileHandle>;
  renameFile: (source: string, target: string) => Promise<void>;
}

const replacementPorts: KnowledgeReplacementPorts = {
  openStagedFile: (file) => open(file, "wx", 0o600),
  renameFile: rename,
};

/** The lock coordinates Otto writers, including independent service instances. */
export async function withKnowledgeWrite<T>(
  store: KnowledgeStore,
  write: () => Promise<T>,
): Promise<T> {
  const key = process.platform === "win32" ? store.base.toLowerCase() : store.base;
  const previous = queues.get(key) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const directory = path.join(store.base, "knowledge");
      await checkPath(store, directory, true);
      const lock = path.join(directory, ".write-lock");
      try {
        await mkdir(lock);
      } catch (error) {
        if (hasCode(error, "EEXIST")) throw new KnowledgeBusyError();
        throw error;
      }
      return runWithKnowledgeCleanup({ operation: write, cleanup: () => rmdir(lock) });
    });
  queues.set(key, operation);
  try {
    return await operation;
  } finally {
    if (queues.get(key) === operation) queues.delete(key);
  }
}

export async function readKnowledgeFile(
  store: KnowledgeStore,
  file: string,
): Promise<string | null> {
  try {
    await checkPath(store, file, false);
    return await readFile(file, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

/** Presence includes partially initialized/corrupt stores. It never creates a
 * directory or follows a link while deciding whether existing intent is kept. */
export async function knowledgePathExists(store: KnowledgeStore, file: string): Promise<boolean> {
  try {
    await checkPath(store, file, false);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Byte-preserving migration reads share the same no-symlink boundary as Markdown reads. */
export async function readKnowledgeBytes(
  store: KnowledgeStore,
  file: string,
): Promise<Buffer | null> {
  try {
    await checkPath(store, file, false);
    return await readFile(file);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

/** Enumerates payload only, never follows links or enters the cooperative writer lock. */
export async function listKnowledgePayload(store: KnowledgeStore): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    await checkPath(store, directory, false);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === path.join(store.base, "knowledge") && entry.name === ".write-lock")
        continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Knowledge migration cannot follow symbolic links");
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
      else throw new Error("Knowledge migration cannot copy special files");
      if (files.length > 10000) throw new Error("Knowledge migration exceeds the file limit");
    }
  }
  const root = path.join(store.base, "knowledge");
  let exists = true;
  try {
    await checkPath(store, root, false);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    exists = false;
  }
  if (exists) await visit(root);
  const policy = path.join(store.base, "KNOWLEDGE.md");
  if (await readKnowledgeBytes(store, policy)) files.push(policy);
  return files.sort();
}

export async function listKnowledgeFiles(
  store: KnowledgeStore,
  directory: string,
): Promise<string[]> {
  try {
    await checkPath(store, directory, false);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error("Knowledge cannot follow symbolic links");
    }
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }
}

/** Call only under withKnowledgeWrite. null means create, never overwrite. */
export async function replaceKnowledgeFile(input: {
  store: KnowledgeStore;
  file: string;
  expectedRevision: string | null;
  body: string | Uint8Array;
  replacement?: KnowledgeReplacementPorts;
}): Promise<void> {
  const { store, file, expectedRevision, body } = input;
  const ports = input.replacement ?? replacementPorts;
  await checkPath(store, path.dirname(file), true);
  const current = await readKnowledgeBytes(store, file);
  assertRevision(current, expectedRevision);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = await ports.openStagedFile(temporary);
  await runWithKnowledgeCleanup({
    operation: async () => {
      await runWithKnowledgeCleanup({
        operation: async () => {
          await handle.writeFile(body, "utf8");
          await handle.sync();
        },
        cleanup: () => handle.close(),
      });
      // Catch external saves since preparation. Filesystems do not offer a portable
      // compare-and-rename against an editor that ignores the Otto store lock.
      assertRevision(await readKnowledgeBytes(store, file), expectedRevision);
      if (expectedRevision === null) {
        try {
          await link(temporary, file);
        } catch (error) {
          if (hasCode(error, "EEXIST")) throw new KnowledgeConflictError();
          throw error;
        }
      } else {
        await ports.renameFile(temporary, file);
      }
    },
    cleanup: async () => {
      try {
        await unlink(temporary);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
    },
  });
}

/** Explicit canonical-page purge only, under withKnowledgeWrite. No recursive
 * deletion, archive, retry or lock recovery. External editors still do not
 * participate in the final compare/unlink interval. */
export async function removeKnowledgeFile(
  store: KnowledgeStore,
  file: string,
  expectedRevision: string,
): Promise<void> {
  const current = await readKnowledgeBytes(store, file);
  assertRevision(current, expectedRevision);
  await unlink(file);
}

/** Keep both failures available, with the operation failure as the primary cause. */
export async function runWithKnowledgeCleanup<T>(input: {
  operation: () => Promise<T>;
  cleanup: () => Promise<void>;
}): Promise<T> {
  let result: T;
  try {
    result = await input.operation();
  } catch (primaryError) {
    const cleanupFailure = await input.cleanup().then(
      () => null,
      (error: unknown) => ({ error }),
    );
    if (cleanupFailure) {
      throw combineKnowledgeFailures({ primaryError, cleanupError: cleanupFailure.error });
    }
    throw primaryError;
  }
  await input.cleanup();
  return result;
}

function combineKnowledgeFailures(input: {
  primaryError: unknown;
  cleanupError: unknown;
}): AggregateError {
  return new AggregateError(
    [input.primaryError, input.cleanupError],
    "Knowledge operation failed and cleanup also failed",
    { cause: input.primaryError },
  );
}

function assertRevision(raw: string | Uint8Array | null, expected: string | null): void {
  const actual = raw === null ? null : digest(raw);
  if (actual !== expected) throw new KnowledgeConflictError();
}

async function checkPath(store: KnowledgeStore, target: string, create: boolean): Promise<void> {
  const relative = path.relative(store.boundary, target);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Knowledge path escapes its owning host/project boundary");
  }
  // The boundary itself is selected by the daemon. Refuse links below it rather
  // than allowing a repository link to redirect a mutation outside the store.
  let current = store.boundary;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (create) {
      try {
        await mkdir(current);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
    }
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Knowledge cannot follow symbolic links");
    if (create && !info.isDirectory()) throw new Error("Knowledge directory is not a directory");
  }
}
