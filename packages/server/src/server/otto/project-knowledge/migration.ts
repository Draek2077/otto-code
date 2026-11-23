import path from "node:path";
import { digest } from "./markdown-page.js";
import {
  KnowledgeConflictError,
  listKnowledgePayload,
  readKnowledgeBytes,
  replaceKnowledgeFile,
  withKnowledgeWrite,
} from "./knowledge-files.js";
import type { KnowledgeStore } from "./store-resolver.js";

interface PayloadFile {
  source: string;
  relative: string;
  bytes: Buffer;
  revision: string;
}
async function snapshot(store: KnowledgeStore): Promise<PayloadFile[]> {
  const result: PayloadFile[] = [];
  let totalBytes = 0;
  for (const source of await listKnowledgePayload(store)) {
    const bytes = await readKnowledgeBytes(store, source);
    if (!bytes) throw new KnowledgeConflictError();
    totalBytes += bytes.length;
    if (bytes.length > 4194304 || totalBytes > 67108864)
      throw new Error("Knowledge migration exceeds its safe copy limit");
    result.push({
      source,
      relative: path.relative(store.base, source),
      bytes,
      revision: digest(bytes),
    });
  }
  return result;
}

/**
 * Explicit copy-and-switch, never move/delete. Source is the recovery copy.
 * An interrupted copy can resume only over byte-identical destination files.
 * Registry CAS is last. Both stores remain locked through publication.
 */
export async function copyKnowledgeStore(input: {
  from: KnowledgeStore;
  to: KnowledgeStore;
  publish(): Promise<void>;
}): Promise<{ copied: number }> {
  const normalize = (value: string) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  const from = normalize(input.from.base);
  const to = normalize(input.to.base);
  if (from === to) {
    await input.publish();
    return { copied: 0 };
  }
  if (from.startsWith(`${to}${path.sep}`) || to.startsWith(`${from}${path.sep}`))
    throw new Error("Knowledge stores must not overlap");
  const locks = [input.from, input.to].sort((a, b) => a.base.localeCompare(b.base));
  return withKnowledgeWrite(locks[0], () =>
    withKnowledgeWrite(locks[1], async () => {
      const files = await snapshot(input.from);
      const expected = new Set(files.map((file) => file.relative));
      if ((await snapshot(input.to)).some((file) => !expected.has(file.relative)))
        throw new KnowledgeConflictError();
      // Validate every destination first. A conflict never replaces destination data.
      for (const file of files) {
        const existing = await readKnowledgeBytes(
          input.to,
          path.join(input.to.base, file.relative),
        );
        if (existing !== null && digest(existing) !== file.revision)
          throw new KnowledgeConflictError();
      }
      for (const file of files) {
        const target = path.join(input.to.base, file.relative);
        if ((await readKnowledgeBytes(input.to, target)) !== null) continue;
        await replaceKnowledgeFile({
          store: input.to,
          file: target,
          expectedRevision: null,
          body: file.bytes,
        });
      }
      const finalSource = await snapshot(input.from);
      if (
        finalSource.length !== files.length ||
        finalSource.some(
          (file, index) =>
            file.relative !== files[index].relative || file.revision !== files[index].revision,
        )
      )
        throw new KnowledgeConflictError();
      const finalDestination = await snapshot(input.to);
      if (
        finalDestination.length !== files.length ||
        finalDestination.some(
          (file, index) =>
            file.relative !== files[index].relative || file.revision !== files[index].revision,
        )
      )
        throw new KnowledgeConflictError();
      await input.publish();
      return { copied: files.length };
    }),
  );
}
