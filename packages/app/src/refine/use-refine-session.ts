import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FileRefineDocument,
  FileRefineReference,
} from "@otto-code/client/internal/daemon-client";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useSessionStore } from "@/stores/session-store";
import { normalizeToLf } from "@/editor/editor-buffer-state";
import { buildRefineDiff } from "./hunks";
import { linkedDocumentsFor, refinePathKey } from "./refine-links";
import { DEFAULT_REFINE_REFERENCE_BUDGET_BYTES } from "./refine-reference-budget";
import { buildRefineLabel } from "./refine-working-set";
import {
  EMPTY_REFINE_SET_STATS,
  allRefineSetKeys,
  applyRefineSet,
  countRefineSetChanges,
  refineDecisionKey,
  splitAbsolutePath,
  type RefineFileProposal,
  type RefinePinnedFile,
  type RefineSetFile,
  type RefineSetStats,
} from "./refine-set";

/**
 * The Refine loop's state machine, over a *set* of files.
 *
 * Four values, and the discipline is that only the last one is ever written:
 *
 *   base       every file as it was when the session opened, with its identity
 *   proposal   the model's latest whole-document answer, per file
 *   decisions  per-change keep/drop across the whole set
 *   result     each base with its kept changes applied  ← all accept() writes
 *
 * Three rules carry most of the safety:
 *
 * 1. **Every diff is against that file's pinned base, never the previous
 *    proposal.** The user's reference point is the file as it was, so total
 *    drift stays visible however many rounds have run. Five rounds of "tighten
 *    it further" can wander, and a base-pinned diff makes that obvious.
 *
 * 2. **Regeneration feeds the current result back in.** What the user kept is
 *    already in the documents handed to the model, so the next round builds on
 *    it without a constraint-prompt the model may ignore - and because it is
 *    baked in, decisions do not need to survive a round. Each new diff arrives
 *    with every change kept, and no change identity has to be matched across
 *    regenerations. A dropped change reappearing is correct behaviour, not a
 *    bug: the model still thinks it is a good idea. Drop it again, or say why.
 *
 * 3. **Only writable files are sent as rewritable.** Read-only members of the
 *    set go up as references so the rewrite fits its project, and can never
 *    come back as an edit. The writable subset is the session's blast radius,
 *    and it is enforced twice: here, and again on the daemon.
 *
 * `accept` is the only method that writes, and it is a separate callback from
 * the rest on purpose: a read-only lens over the same loop ("explain this to
 * me") is this hook with `accept` never called.
 */
export type RefinePhase =
  | { kind: "pinning" }
  | { kind: "unreadable"; reason: string }
  /** Every file pinned, nothing proposed yet. */
  | { kind: "idle" }
  | { kind: "generating"; round: number }
  | { kind: "reviewing"; round: number }
  | { kind: "accepting" }
  /** Every write landed. */
  | { kind: "accepted"; outcomes: RefineWriteOutcome[] }
  /**
   * At least one file changed underneath the session, so its conditional write
   * refused. Whatever was written is reported honestly; nothing was clobbered.
   */
  | { kind: "partiallyAccepted"; outcomes: RefineWriteOutcome[] };

export interface RefineWriteOutcome {
  label: string;
  kind: "written" | "stale" | "failed";
  reason: string | null;
}

export interface RefineSession {
  phase: RefinePhase;
  /** The working set, in the order the opening surface supplied it. */
  files: RefineSetFile[];
  /** Per-file proposals, only for writable files the model actually changed. */
  proposals: RefineFileProposal[];
  /** Last failed round, kept beside the previous proposal rather than replacing it. */
  error: string | null;
  round: number;
  stats: RefineSetStats;
  isKept: (fileId: string, hunkId: string) => boolean;
  toggleHunk: (fileId: string, hunkId: string) => void;
  /** Keep or drop every change in one file. */
  setFileKept: (fileId: string, kept: boolean) => void;
  keepAll: () => void;
  dropAll: () => void;
  /** Move a file between "may be rewritten" and "read-only context". */
  setWritable: (fileId: string, writable: boolean) => void;
  /**
   * Widen the blast radius to the whole set, or narrow it back to the primary.
   * Narrowing never empties it - a set with nothing rewritable is a request the
   * daemon cannot answer.
   */
  setAllWritable: (writable: boolean) => void;
  /** Run a round, building on what the user has kept so far. */
  run: (instruction: string) => void;
  /** Throw the proposals away and re-run against the pinned bases. */
  startOver: (instruction: string) => void;
  /** Conditional-write every changed file. The only method that touches disk. */
  accept: () => void;
  /** Discard everything and re-read the set from disk. */
  repin: () => void;
}

export interface UseRefineSessionInput {
  serverId: string;
  /**
   * The workspace root: provider resolution, and the root discovered references
   * are labelled against. Each file is still read and written by its own path.
   */
  cwd: string;
  /** The working set. Absolute paths; the first is the primary. */
  files: readonly RefineSetFile[];
  enabled: boolean;
  /** A memory-backed document whose accepted result is committed by its owner. */
  virtualDocuments?: readonly RefinePinnedFile[];
  acceptResults?: (
    results: { id: string; label: string; content: string }[],
  ) => Promise<RefineWriteOutcome[]>;
  onAccepted?: (outcomes: RefineWriteOutcome[]) => void;
}

type RefineFileReader = Pick<NonNullable<ReturnType<typeof useRefineClient>>, "readTextFile">;

/** Read one file and pin it: its content as of now, with the identity a later write preconditions on. */
async function pinFile(client: RefineFileReader, file: RefineSetFile): Promise<RefinePinnedFile> {
  const { dir, base } = splitAbsolutePath(file.absolutePath);
  const contents = await client.readTextFile(dir, base);
  return {
    id: file.id,
    absolutePath: file.absolutePath,
    label: file.label,
    writable: file.writable,
    content: normalizeToLf(contents.content),
    modifiedAt: contents.modifiedAt,
    hash: contents.hash,
  };
}

/**
 * Read the read-only half of the set, dropping whatever cannot be read.
 *
 * References are tolerant where documents are not, and deliberately so. A
 * reference is context: a stale entry in the context graph, or a link into a
 * file that has since moved, should cost that one file's worth of context - not
 * the session. A document that cannot be read is the opposite: the job is about
 * it, so failing loudly is the only honest answer.
 *
 * Budgeted by total content, because the daemon caps documents and references
 * together. Going over would fail every round with an error the user has no way
 * to act on, since they cannot see which reference was the expensive one.
 */
async function pinReferences(
  client: RefineFileReader,
  files: readonly RefineSetFile[],
  budgetBytes: number,
): Promise<RefinePinnedFile[]> {
  const kept: RefinePinnedFile[] = [];
  let spent = 0;
  for (const file of files) {
    let pinnedFile: RefinePinnedFile;
    try {
      pinnedFile = await pinFile(client, file);
    } catch {
      continue;
    }
    if (spent + pinnedFile.content.length > budgetBytes) {
      continue;
    }
    spent += pinnedFile.content.length;
    kept.push(pinnedFile);
  }
  return kept;
}

/**
 * The documents the pinned set points at, as read-only members of it.
 *
 * This is what makes a plain Refine project-aware without a context graph: an
 * index is defined by its entries and an instruction file by the docs it defers
 * to, so a rewrite made without them is a rewrite made blind. They arrive
 * read-only; widening the blast radius stays the user's decision, taken in the
 * working-set strip where it is visible.
 */
function discoverLinkedFiles(
  documents: readonly RefinePinnedFile[],
  seeded: readonly RefineSetFile[],
  workspaceRoot: string,
): RefineSetFile[] {
  const known = new Set(seeded.map((file) => refinePathKey(file.absolutePath)));
  const discovered: RefineSetFile[] = [];
  for (const document of documents) {
    const linked = linkedDocumentsFor({
      content: document.content,
      absolutePath: document.absolutePath,
      exclude: [...known],
    });
    for (const absolutePath of linked) {
      known.add(refinePathKey(absolutePath));
      discovered.push({
        // `l` for linked: discovered ids must not collide with the seed's `d`
        // ids, which are positional in a list this one is appended to.
        id: `l${discovered.length}`,
        absolutePath,
        label: buildRefineLabel(absolutePath, workspaceRoot || null),
        writable: false,
      });
    }
  }
  return discovered;
}

function useRefineClient(serverId: string) {
  return useSessionStore((state) => state.sessions[serverId]?.client ?? null);
}

export function useRefineSession(input: UseRefineSessionInput): RefineSession {
  const { serverId, cwd, files, enabled, virtualDocuments, acceptResults, onAccepted } = input;
  const client = useRefineClient(serverId);

  const [phase, setPhase] = useState<RefinePhase>({ kind: "pinning" });
  const [pinned, setPinned] = useState<RefinePinnedFile[]>([]);
  const [proposals, setProposals] = useState<RefineFileProposal[]>([]);
  const [keptKeys, setKeptKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  // Writability is a live session decision, not a property of the seed: the
  // whole point of showing the set is letting the user widen or narrow it.
  const [writableOverrides, setWritableOverrides] = useState<Record<string, boolean>>({});

  // Guards a slow read or a slow round landing after the tab moved on.
  const tokenRef = useRef(0);
  const bump = useCallback(() => {
    tokenRef.current += 1;
    return tokenRef.current;
  }, []);

  // The seed array is rebuilt on every render by its host; key on the paths so
  // re-pinning happens when the set genuinely changes, not on every render.
  const seedKey = useMemo(
    () =>
      [
        ...files.map((file) => file.absolutePath),
        ...(virtualDocuments ?? []).map((file) => file.absolutePath),
      ].join("\0"),
    [files, virtualDocuments],
  );
  const filesRef = useRef(files);
  filesRef.current = files;

  const pin = useCallback(async () => {
    if (!client || !enabled || (filesRef.current.length === 0 && !virtualDocuments?.length)) {
      return;
    }
    const token = bump();
    setPhase({ kind: "pinning" });
    setProposals([]);
    setKeptKeys(new Set());
    setError(null);
    setRound(0);
    setWritableOverrides({});
    const seed = filesRef.current;
    try {
      if (virtualDocuments?.length) {
        setPinned([...virtualDocuments]);
        setPhase({ kind: "idle" });
        return;
      }
      // The documents first and on their own: the job is about them, so a read
      // that fails here fails the session rather than quietly shrinking it.
      const documents = await Promise.all(
        seed.filter((file) => file.writable).map((file) => pinFile(client, file)),
      );
      if (tokenRef.current !== token) {
        return;
      }
      const seededReferences = seed.filter((file) => !file.writable);
      const references = await pinReferences(
        client,
        [...seededReferences, ...discoverLinkedFiles(documents, seed, cwd)],
        DEFAULT_REFINE_REFERENCE_BUDGET_BYTES,
      );
      if (tokenRef.current !== token) {
        return;
      }
      setPinned([...documents, ...references]);
      setPhase({ kind: "idle" });
    } catch (readError) {
      if (tokenRef.current !== token) {
        return;
      }
      setPhase({ kind: "unreadable", reason: getErrorMessage(readError) });
    }
    // seedKey, not `files`: the identity of the set is its paths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump, client, cwd, enabled, seedKey, virtualDocuments]);

  useEffect(() => {
    void pin();
  }, [pin]);

  const isWritable = useCallback(
    (file: RefineSetFile) => writableOverrides[file.id] ?? file.writable,
    [writableOverrides],
  );

  const setFiles = useMemo<RefineSetFile[]>(
    () => pinned.map((file) => ({ ...file, writable: isWritable(file) })),
    [isWritable, pinned],
  );

  /**
   * What the next round sees: each writable file with its kept changes already
   * applied (rule 2), and each read-only file as it is on disk.
   */
  const buildRequestPayload = useCallback(
    (fromBase: boolean): { documents: FileRefineDocument[]; references: FileRefineReference[] } => {
      const results = fromBase ? [] : applyRefineSet(proposals, keptKeys);
      const contentById = new Map(results.map((result) => [result.id, result.content]));
      const documents: FileRefineDocument[] = [];
      const references: FileRefineReference[] = [];
      for (const file of pinned) {
        const content = contentById.get(file.id) ?? file.content;
        if (isWritable(file)) {
          documents.push({ id: file.id, label: file.label, content });
        } else {
          references.push({ label: file.label, content: file.content });
        }
      }
      return { documents, references };
    },
    [isWritable, keptKeys, pinned, proposals],
  );

  const generate = useCallback(
    (instruction: string, fromBase: boolean) => {
      if (!client || pinned.length === 0) {
        return;
      }
      const { documents, references } = buildRequestPayload(fromBase);
      if (documents.length === 0) {
        setError("Nothing in this set may be rewritten. Mark at least one file as editable.");
        return;
      }
      const token = bump();
      const nextRound = round + 1;
      const hadProposals = proposals.length > 0;
      setError(null);
      setPhase({ kind: "generating", round: nextRound });
      void (async () => {
        try {
          const outcome = await client.refineFile({
            cwd,
            documents,
            ...(references.length > 0 ? { references } : {}),
            instruction,
          });
          if (tokenRef.current !== token) {
            return;
          }
          if (outcome.status === "error") {
            setError(outcome.message);
            setPhase(hadProposals ? { kind: "reviewing", round } : { kind: "idle" });
            return;
          }
          // Rule 1: each diff is against that file's pinned base, never the
          // previous proposal and never the round's input.
          const byId = new Map(pinned.map((file) => [file.id, file]));
          const next: RefineFileProposal[] = [];
          for (const file of outcome.files) {
            const source = byId.get(file.id);
            if (!source || !isWritable(source)) {
              continue;
            }
            const afterSource = normalizeToLf(file.content);
            const diff = buildRefineDiff(source.content, afterSource);
            if (diff.hunks.length === 0) {
              continue;
            }
            next.push({
              id: source.id,
              label: source.label,
              absolutePath: source.absolutePath,
              beforeSource: source.content,
              afterSource,
              diff,
            });
          }
          setProposals(next);
          setKeptKeys(allRefineSetKeys(next));
          setRound(nextRound);
          setPhase({ kind: "reviewing", round: nextRound });
        } catch (runError) {
          if (tokenRef.current !== token) {
            return;
          }
          setError(getErrorMessage(runError));
          setPhase(hadProposals ? { kind: "reviewing", round } : { kind: "idle" });
        }
      })();
    },
    [buildRequestPayload, bump, client, cwd, isWritable, pinned, proposals.length, round],
  );

  const run = useCallback((instruction: string) => generate(instruction, false), [generate]);
  const startOver = useCallback((instruction: string) => generate(instruction, true), [generate]);

  const accept = useCallback(() => {
    if (!client || proposals.length === 0) {
      return;
    }
    const results = applyRefineSet(proposals, keptKeys).filter((result) => result.changed);
    if (results.length === 0) {
      return;
    }
    const identityById = new Map(pinned.map((file) => [file.id, file]));
    const token = bump();
    setPhase({ kind: "accepting" });
    void (async () => {
      if (acceptResults) {
        try {
          const outcomes = await acceptResults(results);
          if (tokenRef.current !== token) return;
          const complete = outcomes.every((outcome) => outcome.kind === "written");
          setPhase(
            complete ? { kind: "accepted", outcomes } : { kind: "partiallyAccepted", outcomes },
          );
          onAccepted?.(outcomes);
        } catch (writeError) {
          if (tokenRef.current === token) {
            setPhase({
              kind: "partiallyAccepted",
              outcomes: [
                {
                  label: results[0]?.label ?? "Document",
                  kind: "failed",
                  reason: getErrorMessage(writeError),
                },
              ],
            });
          }
        }
        return;
      }
      const outcomes: RefineWriteOutcome[] = [];
      for (const result of results) {
        const identity = identityById.get(result.id);
        if (!identity) {
          continue;
        }
        const { dir, base } = splitAbsolutePath(result.absolutePath);
        try {
          const written = await client.writeFile({
            cwd: dir,
            path: base,
            content: result.content,
            expectedModifiedAt: identity.modifiedAt,
            ...(identity.hash ? { expectedHash: identity.hash } : {}),
          });
          if (written.status === "ok") {
            outcomes.push({ label: result.label, kind: "written", reason: null });
          } else if (written.status === "conflict") {
            // Nothing was written for this file. Never a silent overwrite of
            // whatever landed underneath the session.
            outcomes.push({
              label: result.label,
              kind: "stale",
              reason: "Changed on disk while you were reviewing, so it was left alone.",
            });
          } else {
            outcomes.push({ label: result.label, kind: "failed", reason: written.message });
          }
        } catch (writeError) {
          outcomes.push({
            label: result.label,
            kind: "failed",
            reason: getErrorMessage(writeError),
          });
        }
      }
      if (tokenRef.current !== token) {
        return;
      }
      const complete = outcomes.every((outcome) => outcome.kind === "written");
      setPhase(complete ? { kind: "accepted", outcomes } : { kind: "partiallyAccepted", outcomes });
      onAccepted?.(outcomes);
    })();
  }, [acceptResults, bump, client, keptKeys, onAccepted, pinned, proposals]);

  const isKept = useCallback(
    (fileId: string, hunkId: string) => keptKeys.has(refineDecisionKey(fileId, hunkId)),
    [keptKeys],
  );

  const toggleHunk = useCallback((fileId: string, hunkId: string) => {
    const key = refineDecisionKey(fileId, hunkId);
    setKeptKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }, []);

  const setFileKept = useCallback(
    (fileId: string, kept: boolean) => {
      const proposal = proposals.find((candidate) => candidate.id === fileId);
      if (!proposal) {
        return;
      }
      setKeptKeys((current) => {
        const next = new Set(current);
        for (const hunk of proposal.diff.hunks) {
          const key = refineDecisionKey(fileId, hunk.id);
          if (kept) {
            next.add(key);
          } else {
            next.delete(key);
          }
        }
        return next;
      });
    },
    [proposals],
  );

  const keepAll = useCallback(() => setKeptKeys(allRefineSetKeys(proposals)), [proposals]);
  const dropAll = useCallback(() => setKeptKeys(new Set()), []);

  const setWritable = useCallback((fileId: string, writable: boolean) => {
    setWritableOverrides((current) => ({ ...current, [fileId]: writable }));
  }, []);

  const setAllWritable = useCallback(
    (writable: boolean) => {
      const overrides: Record<string, boolean> = {};
      for (const [index, file] of pinned.entries()) {
        // Narrowing keeps the primary: documents are pinned first, so index 0 is
        // the file the tab is named after, and a set with nothing rewritable is
        // a round that cannot run.
        overrides[file.id] = writable || index === 0;
      }
      setWritableOverrides(overrides);
    },
    [pinned],
  );

  const stats = useMemo(
    () =>
      proposals.length === 0 ? EMPTY_REFINE_SET_STATS : countRefineSetChanges(proposals, keptKeys),
    [keptKeys, proposals],
  );

  return {
    phase,
    files: setFiles,
    proposals,
    error,
    round,
    stats,
    isKept,
    toggleHunk,
    setFileKept,
    keepAll,
    dropAll,
    setWritable,
    setAllWritable,
    run,
    startOver,
    accept,
    repin: () => {
      void pin();
    },
  };
}
