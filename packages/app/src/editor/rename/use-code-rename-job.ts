import type { CodeRenameApplyOutcome, CodeRenameUndoOutcome } from "@otto-code/client";
import type { CodeRenameFilePlan } from "@otto-code/protocol/messages";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";

/**
 * A rename set up as a job: compute the dry run, hold it while the user audits it, and
 * execute exactly that plan or nothing.
 *
 * The `indexing` state is load-bearing here in a way it is nowhere else in this subsystem.
 * A language server that is still loading its project under-reports a rename's blast radius
 * — measured on this repo at 1 file / 2 edits for something that actually touches 4 files
 * and 14 sites — and a dry run that under-reports is worse than no dry run at all, because
 * it is believed. So the daemon refuses to plan while indexing, and this hook waits and
 * re-asks rather than showing a plan it cannot stand behind.
 */

const FIRST_RETRY_MS = 600;
const MAX_RETRY_MS = 4_000;
const SETTLE_CEILING_MS = 90_000;

export type RenameJobPhase =
  /** Waiting for a plan: either the first request or a project still loading. */
  | { kind: "planning"; waitingForProject: boolean }
  /** A plan the user can audit and run. */
  | { kind: "ready" }
  /** Running right now. */
  | { kind: "applying" }
  /**
   * The run happened. NOT necessarily "everything applied" — `outcome.complete` says that,
   * and the per-file outcomes say which parts did not. The tab becomes a receipt with an
   * undo, rather than a success message.
   */
  | { kind: "ran"; outcome: CodeRenameApplyOutcome }
  /** Undoing right now. */
  | { kind: "undoing"; outcome: CodeRenameApplyOutcome }
  /** The run was taken back — wholly or partly. */
  | { kind: "undone"; undo: CodeRenameUndoOutcome }
  /** Nothing ran, and why. */
  | { kind: "failed"; reason: string; canRetry: boolean };

export interface CodeRenameJob {
  phase: RenameJobPhase;
  files: CodeRenameFilePlan[];
  fileCount: number;
  editCount: number;
  /** Re-plan from scratch. Also the way back after a run or an undo. */
  replan: () => void;
  /** Run the audited plan. No-op unless the phase is `ready`. */
  apply: () => void;
  /** Take the run back. No-op unless a run is on screen. */
  undo: () => void;
}

export interface UseCodeRenameJobInput {
  serverId: string;
  cwd: string;
  path: string;
  line: number;
  column: number;
  newName: string;
  enabled: boolean;
}

export function useCodeRenameJob(input: UseCodeRenameJobInput): CodeRenameJob {
  const { serverId, cwd, path, line, column, newName, enabled } = input;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  const [phase, setPhase] = useState<RenameJobPhase>({
    kind: "planning",
    waitingForProject: false,
  });
  const [files, setFiles] = useState<CodeRenameFilePlan[]>([]);
  const [counts, setCounts] = useState({ fileCount: 0, editCount: 0 });
  const [replanToken, setReplanToken] = useState(0);

  // The identity of the plan on screen. Sent back on apply so the daemon can prove the plan
  // it is about to write is the plan that was audited — the client never posts edits.
  const planIdRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replan = useCallback(() => setReplanToken((current) => current + 1), []);

  useEffect(() => {
    if (!enabled || client === null || cwd.length === 0) {
      return;
    }
    let cancelled = false;
    let attemptMs = FIRST_RETRY_MS;
    const startedAt = Date.now();

    setPhase({ kind: "planning", waitingForProject: false });

    const ask = async (): Promise<void> => {
      try {
        const plan = await client.previewCodeRename({ cwd, path, line, column, newName });
        if (cancelled) {
          return;
        }

        if (plan.status === "indexing") {
          setPhase({ kind: "planning", waitingForProject: true });
          if (Date.now() - startedAt > SETTLE_CEILING_MS) {
            setPhase({
              kind: "failed",
              reason:
                "The project never finished loading, so a complete rename plan cannot be produced.",
              canRetry: true,
            });
            return;
          }
          timerRef.current = setTimeout(() => void ask(), attemptMs);
          attemptMs = Math.min(attemptMs * 2, MAX_RETRY_MS);
          return;
        }

        if (plan.status === "unavailable") {
          setPhase({
            kind: "failed",
            reason:
              plan.error ??
              "No language server on the host covers this file, so it cannot rename anything in it.",
            canRetry: false,
          });
          return;
        }

        planIdRef.current = plan.planId;
        setFiles(plan.files);
        setCounts({ fileCount: plan.fileCount, editCount: plan.editCount });

        if (plan.fileCount === 0) {
          setPhase({
            kind: "failed",
            reason: "The language server would not rename this symbol.",
            canRetry: true,
          });
          return;
        }
        setPhase({ kind: "ready" });
      } catch (caught) {
        if (!cancelled) {
          setPhase({
            kind: "failed",
            reason: caught instanceof Error ? caught.message : String(caught),
            canRetry: true,
          });
        }
      }
    };

    void ask();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [client, column, cwd, enabled, line, newName, path, replanToken]);

  const apply = useCallback(() => {
    if (client === null || phase.kind !== "ready" || planIdRef.current.length === 0) {
      return;
    }
    setPhase({ kind: "applying" });

    void client
      .applyCodeRename({ cwd, path, line, column, newName, planId: planIdRef.current })
      .then((outcome) => {
        // `ok` means the run took place, not that every edit landed. A run where two of
        // fourteen edits no longer fit still wrote twelve, and calling that a failure would
        // hide them — and hide the fact that there is now something to undo.
        if (outcome.status === "ok") {
          setPhase({ kind: "ran", outcome });
          return undefined;
        }
        setPhase({ kind: "failed", reason: describeFailure(outcome), canRetry: true });
        return undefined;
      })
      .catch((caught: unknown) => {
        setPhase({
          kind: "failed",
          reason: caught instanceof Error ? caught.message : String(caught),
          canRetry: true,
        });
      });
  }, [client, column, cwd, line, newName, path, phase.kind]);

  const undo = useCallback(() => {
    const ran = phase.kind === "ran" ? phase.outcome : null;
    if (client === null || ran === null || ran.runId === null) {
      return;
    }
    setPhase({ kind: "undoing", outcome: ran });

    void client
      .undoCodeRename(cwd, ran.runId)
      .then((result) => {
        if (result.status === "ok") {
          setPhase({ kind: "undone", undo: result });
          return undefined;
        }
        // The run is gone from the host, so the tab can no longer offer to take it back.
        // Saying so beats leaving an Undo button that does nothing.
        setPhase({
          kind: "failed",
          reason:
            result.error ?? "The host no longer holds this run, so it cannot be undone from here.",
          canRetry: true,
        });
        return undefined;
      })
      .catch((caught: unknown) => {
        setPhase({
          kind: "failed",
          reason: caught instanceof Error ? caught.message : String(caught),
          canRetry: true,
        });
      });
  }, [client, cwd, phase]);

  return { phase, files, ...counts, replan, apply, undo };
}

/**
 * Each refusal says what actually happened. "Nothing was written" with no reason is the
 * worst possible outcome for an action whose whole promise is that you know what it will do.
 */
function describeFailure(outcome: { status: string; error: string | null }): string {
  if (outcome.status === "stale") {
    return "The rename changed since you reviewed it — nothing was written. Re-plan to see the new impact.";
  }
  if (outcome.status === "indexing") {
    return "The project started loading again, so the plan could no longer be trusted. Nothing was written.";
  }
  if (outcome.status === "escaped") {
    return (
      outcome.error ??
      "The language server named a file outside this workspace, so nothing was written."
    );
  }
  return outcome.error ?? "The rename could not be applied.";
}
