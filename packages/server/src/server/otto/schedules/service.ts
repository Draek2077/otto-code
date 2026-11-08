import { z } from "zod";
import type { PluginRpcContract } from "@getpaseo/plugin";
import * as rpc from "@getpaseo/plugin/otto/schedules";
import { ScheduleError } from "./files.js";
import type { ScheduleRegistry } from "./registry.js";
import { scheduleDocument, scheduleListItem, scheduleRunSummary } from "./projection.js";
import { ScheduleNotFoundError, ScheduleStateConflictError } from "../../schedule/service.js";

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
const mutations = new Set([
  rpc.createSchedule.name,
  rpc.updateSchedule.name,
  rpc.controlSchedule.name,
  rpc.saveScheduleStorage.name,
  rpc.saveScheduleDefaults.name,
]);
const RESPONSE_BUDGET = 768 * 1024;

/** One authenticated, bounded API for UI/CLI/MCP. It owns no cadence, provider,
 * project registry or parallel cache; every write reaches the same scheduler/store. */
export class ScheduleDaemonService {
  private closed = false;
  private readonly writes = new Set<Promise<unknown>>();
  constructor(
    readonly registry: ScheduleRegistry,
    readonly actions: ScheduleActionPort,
  ) {}
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
      case rpc.readSchedule.name:
        return this.entry(rpc.readSchedule.input.parse(value)).then(scheduleDocument);
      case rpc.readScheduleHistory.name:
        return this.history(rpc.readScheduleHistory.input.parse(value));
      case rpc.readScheduleRun.name:
        return this.run(rpc.readScheduleRun.input.parse(value));
      case rpc.createSchedule.name:
        return this.actions.create(rpc.createSchedule.input.parse(value));
      case rpc.updateSchedule.name:
        return this.actions.update(rpc.updateSchedule.input.parse(value));
      case rpc.controlSchedule.name:
        return this.actions.control(rpc.controlSchedule.input.parse(value));
      case rpc.reviewScheduleTarget.name:
        return this.actions.review(rpc.reviewScheduleTarget.input.parse(value));
      case rpc.readScheduleStorage.name:
        return this.readStorage(rpc.readScheduleStorage.input.parse(value));
      case rpc.saveScheduleStorage.name:
        return this.saveStorage(rpc.saveScheduleStorage.input.parse(value));
      case rpc.readScheduleDefaults.name:
        return this.defaults(rpc.readScheduleDefaults.input.parse(value));
      case rpc.saveScheduleDefaults.name:
        return this.saveDefaults(rpc.saveScheduleDefaults.input.parse(value));
      default:
        throw new ScheduleError("unsupported", "Unknown Schedule operation.");
    }
  }
  private async list(input: z.infer<typeof rpc.listSchedules.input>) {
    await this.scope(input.scope);
    if (input.refresh) await this.registry.refresh(true);
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
      items: entries.slice(offset, offset + 50).map(scheduleListItem),
      total: entries.length,
      diagnostics: diagnostics.slice(diagnosticOffset, diagnosticOffset + 50),
      diagnosticTotal: diagnostics.length,
    };
  }
  private async history(input: z.infer<typeof rpc.readScheduleHistory.input>) {
    const entry = await this.entry(input.ref);
    const runs = entry.schedule.runs.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
    const offset = input.offset ?? 0;
    return {
      runs: runs.slice(offset, offset + 50).map(scheduleRunSummary),
      total: runs.length,
      revision: entry.revision,
    };
  }
  private async run(input: z.infer<typeof rpc.readScheduleRun.input>) {
    const entry = await this.entry(input.ref);
    const run = entry.schedule.runs.find((item) => item.id === input.runId);
    if (!run)
      throw new ScheduleError(
        "invalid",
        "This exact Schedule run is unavailable in retained history.",
      );
    return { run, revision: entry.revision };
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
      const response = contract.output.parse({ ok: true, value: await operation() });
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
    await Promise.allSettled(this.writes);
    await this.actions.close();
  }
}
