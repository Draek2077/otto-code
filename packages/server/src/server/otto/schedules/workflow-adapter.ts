import { randomUUID } from "node:crypto";
import { isTerminalRunStatus, type WorkflowEntry } from "@getpaseo/plugin/otto/workflows";
import { WorkflowScheduleAdapter } from "../workflows/schedule-adapter.js";
import { WorkflowError } from "../workflows/files.js";
import type { ScheduleTarget, ScheduleAudit } from "./types.js";
import type { ProjectScheduleScope } from "./stores.js";
import { workflowScheduleAuthority } from "./workflow-authority.js";
import { ScheduleError } from "./files.js";
import { ScheduleExecutionError, type PreparedScheduleTarget } from "./runtime.js";
type Target = Extract<ScheduleTarget, { type: "workflow" }>;
interface Identity {
  scheduleId: string;
  runId: string;
}
export class SavedWorkflowScheduleAdapter {
  constructor(readonly adapter: WorkflowScheduleAdapter) {}
  /** Resolve the current saved definition without starting it; callers explicitly approve this target. */
  async review(target: Target, scope: ProjectScheduleScope): Promise<Target> {
    return (await this.reviewDetails(target, scope)).target;
  }
  async reviewDetails(target: Target, scope: ProjectScheduleScope) {
    const loaded = await this.load(target, scope, { scheduleId: "review", runId: randomUUID() });
    try {
      const document = loaded.prepared.entry.document;
      let title = target.source.id;
      if (document.kind === "ai") title = document.value.title;
      if (document.kind === "graph") title = document.value.name;
      return {
        target: {
          ...loaded.canonical,
          approval: { ...target.approval, policyFingerprint: loaded.fingerprint },
        },
        title,
        autopilot:
          loaded.prepared.launch.kind === "ai" ? loaded.prepared.launch.definition.autopilot : null,
      };
    } finally {
      loaded.prepared.release();
    }
  }
  private async load(target: Target, scope: ProjectScheduleScope, identity: Identity) {
    if (
      target.source.scope.hostId !== scope.hostId ||
      target.source.scope.projectId !== scope.projectId
    )
      throw new ScheduleError(
        "invalid",
        "Select a saved Workflow on this Schedule's owning host and project.",
      );
    try {
      const entry = await this.adapter.host.library.read(target.source);
      const prepared = await this.adapter.prepare({
        source: entry.ref,
        expectedRevision: entry.revision,
        workspaceId: target.workspaceId,
        seats: target.seats,
        limits: target.limits,
        inputs: target.inputs,
        allowTemplateCode: target.approval.allowTemplateCode,
        allowQueryEffects: target.approval.allowQueryEffects,
        scheduleSource: { scheduleId: identity.scheduleId, scheduleRunId: identity.runId },
      });
      try {
        // Human gates remain ordinary Workflow gates. Host review enforces seats/caps,
        // and the saved authority fingerprint requires explicit review of autopilot changes.
        const kind = prepared.entry.document.kind;
        if ((kind !== "ai" && kind !== "graph") || kind !== target.source.kind)
          throw new ScheduleError(
            "conflict",
            "Saved Workflow kind changed. Review the Schedule target again.",
          );
        const canonical: Target = { ...target, source: { ...prepared.entry.ref, kind } };
        return {
          prepared,
          canonical,
          fingerprint: workflowScheduleAuthority(canonical, prepared.launch),
        };
      } catch (error) {
        prepared.release();
        throw error;
      }
    } catch (error) {
      if (error instanceof WorkflowError)
        throw new ScheduleError(error.kind, error.message, { cause: error });
      throw error;
    }
  }
  async prepare(
    target: Target,
    scope: ProjectScheduleScope,
    identity: Identity,
  ): Promise<PreparedScheduleTarget> {
    const loaded = await this.load(target, scope, identity);
    if (loaded.fingerprint !== target.approval.policyFingerprint) {
      loaded.prepared.release();
      throw new ScheduleError(
        "conflict",
        "Saved Workflow authority changed. Review its Schedule target again.",
      );
    }
    let started: Promise<WorkflowEntry> | null = null;
    const document = loaded.prepared.entry.document;
    let title = target.source.id;
    if (document.kind === "ai") title = document.value.title;
    else if (document.kind === "graph") title = document.value.name;
    return {
      audit: {
        resolved: {
          kind: "workflow",
          id: target.source.id,
          title,
          revision: loaded.prepared.entry.revision,
          workflowKind: target.source.kind,
        },
        executor: `workflow:${target.source.kind}`,
      },
      release: loaded.prepared.release,
      cancel: async () => {
        if (!started) return "not_started";
        const run = await started;
        const current = await this.adapter.host.library.read(run.ref);
        if (current.document.kind === "run" && isTerminalRunStatus(current.document.value.status))
          return "settled";
        try {
          await this.adapter.cancel(run.ref);
        } catch (error) {
          const final = await this.adapter.host.library.read(run.ref);
          if (final.document.kind !== "run" || !isTerminalRunStatus(final.document.value.status))
            throw error;
        }
        return "settled";
      },
      execute: async (signal, stamp) => {
        signal.throwIfAborted();
        started = loaded.prepared.start();
        const admitted = await started;
        signal.throwIfAborted();
        const audit: Partial<ScheduleAudit> = {
          result: { kind: "workflow", ref: admitted.ref },
          disposition: "running",
        };
        await stamp(audit);
        const final = await this.adapter.host.waitForSettlement(admitted.ref, signal);
        if (final.document.kind !== "run")
          throw new ScheduleExecutionError(
            "Workflow run identity is unavailable.",
            "unknown",
            audit,
            "Inspect the Schedule's linked Workflow before resuming.",
          );
        const status = final.document.value.status;
        if (status === "canceled")
          throw new ScheduleExecutionError(
            "Scheduled Workflow was canceled. Completed effects are retained.",
            "canceled",
            audit,
          );
        if (status !== "done")
          throw new ScheduleExecutionError(
            "Scheduled Workflow did not complete successfully. Open its run for details.",
            "failed",
            { ...audit, failureCode: "workflow_failed" },
          );
        return {
          agentId: final.document.value.conductorAgentId ?? null,
          output: `Completed ${final.document.value.title}.`,
          audit: { ...audit, disposition: "succeeded" },
        };
      },
    };
  }
}
