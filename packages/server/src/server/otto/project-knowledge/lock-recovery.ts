import { lstat, readdir, writeFile, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { KnowledgeLockInspection } from "@getpaseo/plugin/otto/project-knowledge";
import { digest } from "./markdown-page.js";
import { knowledgePathExists, knowledgeWriterPending } from "./knowledge-files.js";
import type { KnowledgeStore } from "./store-resolver.js";

export class KnowledgeLockRecoveryError extends Error {
  constructor(
    readonly code: "conflict" | "invalid",
    message: string,
  ) {
    super(message);
  }
}
interface LockSnapshot {
  inspection: KnowledgeLockInspection;
  identity: string;
  lock: string;
}
function directoryIdentity(info: Awaited<ReturnType<typeof lstat>>): string {
  return JSON.stringify([String(info.dev), String(info.ino), String(info.birthtimeMs)]);
}
async function snapshot(store: KnowledgeStore): Promise<LockSnapshot> {
  const lock = path.join(store.base, "knowledge", ".write-lock");
  if (!(await knowledgePathExists(store, lock)))
    return {
      lock,
      identity: "",
      inspection: {
        revision: digest("unlocked"),
        state: "unlocked",
        message: "No Knowledge write lock is present.",
      },
    };
  const info = await lstat(lock);
  const identity = directoryIdentity(info);
  if (!info.isDirectory())
    return {
      lock,
      identity,
      inspection: {
        revision: digest(identity),
        state: "unsupported",
        message:
          "The write-lock path is not a directory. Inspect it on the owning host; Otto will not move it.",
      },
    };
  const entries = (await readdir(lock)).sort();
  const revision = digest(JSON.stringify({ identity, modified: String(info.mtimeMs), entries }));
  if (knowledgeWriterPending(store))
    return {
      lock,
      identity,
      inspection: {
        revision,
        state: "busy",
        message:
          "This daemon has an admitted Knowledge writer. Wait for it to finish; recovery is refused.",
      },
    };
  if (entries.length)
    return {
      lock,
      identity,
      inspection: {
        revision,
        state: "unsupported",
        message:
          "The lock contains unknown files or an earlier recovery claim. Inspect its owner and retained evidence on the owning host; nothing was removed.",
      },
    };
  return {
    lock,
    identity,
    inspection: {
      revision,
      state: "unverified",
      message:
        "An empty lock exists. It may belong to another active daemon. Verify that all Knowledge writers for this store have stopped before explicitly recovering it. Age does not prove abandonment.",
    },
  };
}
export async function inspectKnowledgeLock(
  store: KnowledgeStore,
): Promise<KnowledgeLockInspection> {
  return (await snapshot(store)).inspection;
}
interface RecoveryInput {
  store: KnowledgeStore;
  expectedRevision: string;
  reason: string;
  userVerifiedNoActiveWriter: boolean;
}
/** Human-adjudicated recovery only. The old lock and recovery claim are retained,
 * never recursively deleted. No record, root, staged write or settings file moves. */
export async function recoverKnowledgeLock(
  input: RecoveryInput,
): Promise<{ recoveryName: string }> {
  if (!input.userVerifiedNoActiveWriter || !input.reason.trim())
    throw new KnowledgeLockRecoveryError(
      "invalid",
      "Recovery requires a reason and explicit verification that no writer remains active.",
    );
  const before = await snapshot(input.store);
  if (
    before.inspection.revision !== input.expectedRevision ||
    before.inspection.state !== "unverified"
  )
    throw new KnowledgeLockRecoveryError(
      "conflict",
      "The lock changed or cannot be recovered. Inspect it again; no automatic retry was attempted.",
    );
  const claim = path.join(before.lock, ".recovery-claim.json");
  const evidence = JSON.stringify({
    version: 1,
    nonce: randomUUID(),
    reason: input.reason.trim(),
    humanVerifiedNoActiveWriter: true,
    inspectedRevision: input.expectedRevision,
    recordedAt: new Date().toISOString(),
  });
  // Exclusive creation arbitrates cooperating recovery attempts across processes.
  // A crash leaves this claim for manual inspection, never silent takeover.
  await writeFile(claim, evidence, { flag: "wx", mode: 0o600 });
  try {
    await knowledgePathExists(input.store, before.lock);
    const identity = directoryIdentity(await lstat(before.lock));
    const entries = await readdir(before.lock);
    if (
      identity !== before.identity ||
      knowledgeWriterPending(input.store) ||
      entries.length !== 1 ||
      entries[0] !== ".recovery-claim.json" ||
      (await readFile(claim, "utf8")) !== evidence
    )
      throw new KnowledgeLockRecoveryError(
        "conflict",
        "The lock changed during recovery. Inspect it again before another explicit attempt.",
      );
    const recoveryName = `.recovered-write-lock-${randomUUID()}`;
    await rename(before.lock, path.join(input.store.base, "knowledge", recoveryName));
    return { recoveryName };
  } catch (primary) {
    // Remove only this operation's exact claim if it still owns that path.
    // Never unlink a lock, a target page, or a peer's claim on failure.
    const cleanup = await releaseClaim({ claim, evidence });
    if (cleanup) throw combinedRecoveryError({ primary, cleanup });
    throw primary;
  }
}
async function releaseClaim({
  claim,
  evidence,
}: {
  claim: string;
  evidence: string;
}): Promise<unknown> {
  try {
    if ((await readFile(claim, "utf8")) === evidence) await unlink(claim);
    return null;
  } catch (error) {
    return error;
  }
}
function combinedRecoveryError({ primary, cleanup }: { primary: unknown; cleanup: unknown }) {
  return new AggregateError(
    [primary, cleanup],
    "Knowledge lock recovery and claim cleanup failed",
    { cause: primary },
  );
}
