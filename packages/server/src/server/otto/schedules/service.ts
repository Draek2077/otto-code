import { z } from "zod";
import type { PluginRpcContract } from "@getpaseo/plugin";
import * as rpc from "@getpaseo/plugin/otto/schedules";
import { ScheduleError } from "./files.js";
import { scheduleCreationId, type ScheduleRegistry } from "./registry.js";
import { computeNextRunAt, validateScheduleCadence } from "../../schedule/cron.js";
import { scheduleDocument, scheduleListItem } from "./projection.js";
import { ScheduleHistory } from "./history.js";
import { ScheduleNotFoundError, ScheduleStateConflictError } from "../../schedule/service.js";
import { awaitScheduleEffect } from "./runtime.js";
import type { ScheduleChanges } from "./changes.js";
import { ScheduleTransfers } from "./transfers.js";

export interface ScheduleActionPort {
  create(input: z.infer<typeof rpc.createSchedule.input>): Promise<rpc.ScheduleDocument>;
  update(input: z.infer<typeof rpc.updateSchedule.input>): Promise<rpc.ScheduleDocument>;
  control(
    input: z.infer<typeof rpc.controlSchedule.input>,
  ): Promise<z.infer<(typeof rpc.controlSchedule.output.options)[0]>["value"]>;
  review(
    input: z.infer<typeof rpc.reviewScheduleTarget.input>,
  ): Promise<z.infer<(typeof rpc.reviewScheduleTarget.output.options)[0]>["value"]>;
  close(): Promise<void>;
}
const contracts = new Map<string, PluginRpcContract>(
  rpc.scheduleOperations.map((contract) => [contract.name, contract]),
);
const mutations = new Set(rpc.scheduleMutationNames);
const RESPONSE_BUDGET = 768 * 1024;

/** One authenticated, bounded API for UI/CLI/MCP. It owns no cadence, provider,
 * project registry or parallel cache; every write reaches the same scheduler/store. */
export class ScheduleDaemonService {
  readonly transfers: ScheduleTransfers;
  private closed = false;
  private readonly stopping = new AbortController();
  private readonly writes = new Set<Promise<unknown>>();
  constructor(
    readonly registry: ScheduleRegistry,
    readonly actions: ScheduleActionPort,
    readonly changes: ScheduleChanges,
  ) {
    this.transfers = new ScheduleTransfers(registry);
  }
  invoke(method: string, value: unknown): Promise<unknown> | undefined {
    const contract = contracts.get(method);
    if (!contract) return undefined;
    const pending = this.guard(contract, () => this.dispatch(method, value));
    if (mutations.has(method)) {
      this.writes.add(pending);
      const release = () => {
        this.writes.delete(pending);
      };
      void pending.then(release, release);
    }
    return pending;
  }
  private host(hostId: string) {
    if (hostId !== this.registry.ports.stores.ports.hostId)
      throw new ScheduleError("invalid", "Select the owning Schedules host.");
  }
  private async scope(scope: rpc.ScheduleScope) {
    this.host(scope.hostId);
    if (scope.projectId) await this.registry.ports.stores.project(scope);
  }
  private async entry(ref: rpc.ScheduleRef) {
    this.host(ref.scope.hostId);
    const found = await this.registry.inspectOrigin(ref);
    if (!found)
      throw new ScheduleError(
        "invalid",
        "This Schedule is unavailable at its recorded origin. Refresh storage diagnostics.",
      );
    return found;
  }
  private dispatch(method: string, value: unknown): Promise<unknown> {
    switch (method) {
      case rpc.listSchedules.name:
        return this.list(rpc.listSchedules.input.parse(value));
      case rpc.watchSchedules.name:
        return this.watch(rpc.watchSchedules.input.parse(value));
      case rpc.readSchedule.name:
        return this.entry(rpc.readSchedule.input.parse(value)).then(scheduleDocument);
      case rpc.readCreatedSchedule.name:
        return this.created(rpc.readCreatedSchedule.input.parse(value));
      case rpc.previewScheduleCadence.name:
        return this.preview(rpc.previewScheduleCadence.input.parse(value));
      case rpc.readScheduleHistory.name:
        return this.history(rpc.readScheduleHistory.input.parse(value));
      case rpc.readScheduleRun.name:
        return this.run(rpc.readScheduleRun.input.parse(value));
      case rpc.readScheduleRunPart.name:
        return this.part(rpc.readScheduleRunPart.input.parse(value));
      case rpc.createSchedule.name:
        return this.actions.create(rpc.createSchedule.input.parse(value));
      case rpc.updateSchedule.name:
        return this.actions.update(rpc.updateSchedule.input.parse(value));
      case rpc.controlSchedule.name:
        return this.actions.control(rpc.controlSchedule.input.parse(value));
      case rpc.reviewScheduleTarget.name:
        return this.actions.review(rpc.reviewScheduleTarget.input.parse(value));
      default:
        return this.dispatchStorage(method, value);
    }
  }
  private dispatchStorage(method: string, value: unknown): Promise<unknown> {
    switch (method) {
      case rpc.readScheduleStorage.name:
        return this.readStorage(rpc.readScheduleStorage.input.parse(value));
      case rpc.saveScheduleStorage.name:
        return this.saveStorage(rpc.saveScheduleStorage.input.parse(value));
      case rpc.readScheduleDefaults.name:
        return this.defaults(rpc.readScheduleDefaults.input.parse(value));
      case rpc.saveScheduleDefaults.name:
        return this.saveDefaults(rpc.saveScheduleDefaults.input.parse(value));
      case rpc.transferSchedule.name:
        return this.transfers.transfer(rpc.transferSchedule.input.parse(value));
      case rpc.readScheduleTransfer.name: {
        const input = rpc.readScheduleTransfer.input.parse(value);
        return this.transfers.lookup(input.scope, input.operationId);
      }
      case rpc.reconcileScheduleTransfer.name:
        return this.transfers.reconcile(rpc.reconcileScheduleTransfer.input.parse(value));
      case rpc.recoverScheduleTransferLock.name:
        return this.transfers.recoverLock(rpc.recoverScheduleTransferLock.input.parse(value));
      default:
        throw new ScheduleError("unsupported", "Unknown Schedule operation.");
    }
  }
  private async list(input: z.infer<typeof rpc.listSchedules.input>) {
    await this.scope(input.scope);
    if (input.refresh) await this.registry.refresh(true);
    // Capture before reading data: a concurrent write must cause another watch/refetch,
    // never give an older page the newer version and lose that notification.
    const version = this.changes.version(input.scope);
    const query = input.query?.trim().toLowerCase() ?? "";
    const entries = (await this.registry.catalog()).filter((entry) => {
      if (
        input.scope.projectId &&
        entry.ref.scope.projectId !== input.scope.projectId &&
        !(input.includeLegacy && entry.ref.location === "legacy")
      )
        return false;
      if (input.status && entry.schedule.status !== input.status) return false;
      return (
        !query ||
        `${entry.schedule.name ?? ""}\n${entry.schedule.prompt}`.toLowerCase().includes(query)
      );
    });
    const diagnostics = (await this.registry.problems()).filter(
      (diagnostic) =>
        !input.scope.projectId ||
        !diagnostic.ref ||
        diagnostic.ref.scope.projectId === input.scope.projectId ||
        (input.includeLegacy && diagnostic.ref.location === "legacy"),
    );
    const offset = input.offset ?? 0,
      diagnosticOffset = input.diagnosticOffset ?? 0;
    return {
      items: await Promise.all(
        entries.slice(offset, offset + 50).map(async (entry) => {
          let archivedLast: rpc.ScheduleRunSummary | undefined;
          if (!entry.schedule.runs.length && entry.schedule.otto?.history) {
            const history = await this.historyFor(entry.ref);
            archivedLast = await history.last(entry);
          }
          return scheduleListItem(entry, archivedLast);
        }),
      ),
      total: entries.length,
      diagnostics: diagnostics.slice(diagnosticOffset, diagnosticOffset + 50),
      diagnosticTotal: diagnostics.length,
      version,
    };
  }
  private async watch(input: z.infer<typeof rpc.watchSchedules.input>) {
    await this.scope(input.scope);
    return this.changes.watch(input.scope, input.version);
  }
  private async created(input: z.infer<typeof rpc.readCreatedSchedule.input>) {
    await this.scope(input.scope);
    const id = scheduleCreationId(input.scope, input.operationId);
    await this.registry.refresh(true);
    const found = (await this.registry.catalog()).filter((row) => row.ref.id === id);
    const problems = await this.registry.problems();
    if (found.length > 1 || problems.some((problem) => !problem.ref || problem.ref.id === id))
      throw new ScheduleError(
        "unavailable",
        "Schedule creation could not be inspected safely. Review storage diagnostics; do not create a replacement.",
      );
    if (!found.length) return null;
    const entry = await this.entry(found[0].ref);
    if (
      entry.ref.scope.hostId !== input.scope.hostId ||
      entry.ref.scope.projectId !== input.scope.projectId ||
      entry.schedule.otto?.creation?.operationId !== input.operationId
    )
      throw new ScheduleError(
        "conflict",
        "This creation identity belongs to a different Schedule. Inspect storage before another write.",
      );
    return scheduleDocument(entry);
  }
  private async preview(input: z.infer<typeof rpc.previewScheduleCadence.input>) {
    await this.scope(input.scope);
    try {
      validateScheduleCadence(input.cadence);
      const from = input.from ?? new Date().toISOString();
      let cursor = new Date(from);
      const next: string[] = [];
      for (let i = 0; i < 3; i++) {
        cursor = computeNextRunAt(input.cadence, cursor);
        next.push(cursor.toISOString());
      }
      return {
        from,
        next,
        timezone: input.cadence.type === "cron" ? (input.cadence.timezone ?? "UTC") : "UTC",
      };
    } catch (cause) {
      throw new ScheduleError(
        "invalid",
        "Choose a valid cadence and IANA time zone with a next occurrence within one year.",
        { cause },
      );
    }
  }
  private async history(input: z.infer<typeof rpc.readScheduleHistory.input>) {
    const entry = await this.entry(input.ref);
    return (await this.historyFor(input.ref)).page(entry, input.offset ?? 0);
  }
  private async historyFor(ref: rpc.ScheduleRef) {
    return new ScheduleHistory(await this.registry.transferOrigin(ref), ref.id);
  }
  private async run(input: z.infer<typeof rpc.readScheduleRun.input>) {
    const entry = await this.entry(input.ref);
    return (await this.historyFor(input.ref)).run(entry, input.runId);
  }
  private async part(input: z.infer<typeof rpc.readScheduleRunPart.input>) {
    const entry = await this.entry(input.ref);
    return (await this.historyFor(input.ref)).part(
      entry,
      input.runId,
      input.contentRevision,
      input.part,
    );
  }
  private async readStorage(scope: z.infer<typeof rpc.readScheduleStorage.input>) {
    await this.scope(scope);
    return this.registry.ports.stores.storage(scope);
  }
  private async saveStorage(input: z.infer<typeof rpc.saveScheduleStorage.input>) {
    await this.scope(input.scope);
    return this.registry.ports.stores.saveStorage(
      input.scope,
      input.expectedRevision,
      input.location,
    );
  }
  private async defaults(input: z.infer<typeof rpc.readScheduleDefaults.input>) {
    this.host(input.hostId);
    const { location, revision } = await this.registry.ports.stores.defaults();
    return { location, revision };
  }
  private async saveDefaults(input: z.infer<typeof rpc.saveScheduleDefaults.input>) {
    this.host(input.hostId);
    return this.registry.ports.stores.saveDefaults(input.expectedRevision, input.location);
  }
  private async guard(contract: PluginRpcContract, operation: () => Promise<unknown>) {
    try {
      if (this.closed) throw new ScheduleError("unavailable", "Schedules host is stopping.");
      const response = contract.output.parse({
        ok: true,
        value: await awaitScheduleEffect(operation(), this.stopping.signal),
      });
      if (Buffer.byteLength(JSON.stringify(response)) > RESPONSE_BUDGET)
        throw new ScheduleError(
          "unavailable",
          "This Schedule response exceeds the transport budget. Inspect a smaller history page or the retained host file.",
        );
      return response;
    } catch (error) {
      if (error instanceof ScheduleError)
        return { ok: false, error: { code: error.kind, message: error.message.slice(0, 2000) } };
      if (error instanceof ScheduleStateConflictError)
        return { ok: false, error: { code: "busy", message: error.message.slice(0, 2000) } };
      if (error instanceof ScheduleNotFoundError)
        return {
          ok: false,
          error: { code: "invalid", message: "Schedule is no longer available at this origin." },
        };
      return {
        ok: false,
        error: {
          code: error instanceof z.ZodError ? "invalid" : "unavailable",
          message:
            "Schedule request or storage could not be validated. Original records are retained; refresh and inspect before another action.",
        },
      };
    }
  }
  /** The owning composition stops scheduler admission before draining these writes. */
  async close() {
    this.closed = true;
    this.transfers.close();
    this.changes.close();
    this.stopping.abort(
      new ScheduleError(
        "unavailable",
        "Schedules host stopped before this response was confirmed. Inspect the saved record before another action.",
      ),
    );
    await this.actions.close();
    await Promise.allSettled(this.writes);
  }
}
