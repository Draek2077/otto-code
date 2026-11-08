import path from "node:path";
import { readdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import {
  OttoStoredSchedule,
  type ScheduleEntry,
  type ScheduleRef,
} from "@getpaseo/plugin/otto/schedules";
import { parseOttoStoredSchedule } from "../schedule-continuity.js";
import type {
  ScheduleStorePort,
  StoredSchedule,
  ScheduleMutation,
  ScheduleUpdater,
  ScheduleUpsert,
  ScheduleTarget,
} from "./types.js";
import { ScheduleStores, type ScheduleOrigin } from "./stores.js";
import {
  assertScheduleId,
  publishScheduleFile,
  readScheduleFile,
  retireScheduleFile,
  scheduleDigest,
  scheduleDirectory,
  ScheduleError,
} from "./files.js";
import { assertScheduleMutation, scheduleRevision } from "./legacy.js";
import { normalizePathForIdentity } from "../../../utils/path.js";
import { nameTargetIdentityKey } from "../../schedule/store.js";
import { preserveScheduleDiskRecord } from "./persistence.js";
import { reviewScheduleRepair } from "./lifecycle.js";

interface Located {
  origin: ScheduleOrigin;
  schedule: StoredSchedule;
  revision: string;
}
export interface ScheduleRegistryPorts {
  stores: ScheduleStores;
  /** Canonical registry only, including archived projects with retained schedules. */
  projects(): Promise<{ projectId: string }[]>;
  now?(): number;
}
export interface ScheduleStorageDiagnostic {
  ref: ScheduleRef | null;
  code: string;
  message: string;
}
function refFor(origin: ScheduleOrigin, id: string): ScheduleRef {
  return { scope: origin.scope, location: origin.location, storeKey: origin.storeKey, id };
}
function inputTargetNeedsProject(target: ScheduleTarget) {
  return target.type !== "agent" && target.type !== "new-agent";
}
function sameOrigin(ref: ScheduleRef, origin: ScheduleOrigin) {
  return (
    ref.scope.hostId === origin.scope.hostId &&
    ref.scope.projectId === origin.scope.projectId &&
    ref.location === origin.location &&
    ref.storeKey === origin.storeKey
  );
}
function storageMessage(error: unknown): string {
  if (error instanceof ScheduleError) return error.message.slice(0, 2000);
  if (
    error instanceof Error &&
    (error.message.startsWith("Review this legacy Workflow schedule") ||
      error.message.startsWith("This saved Otto schedule uses "))
  )
    return error.message.slice(0, 2000);
  // Parser/OS errors can contain document excerpts or unrelated host paths.
  return "Schedule storage is unreadable, invalid, or needs explicit repair. Original files are retained.";
}
export function scheduleCreationId(scope: ScheduleRef["scope"], operationId: string) {
  return `schedule-${scheduleDigest(JSON.stringify([scope, operationId]))}`;
}
/** One storage port for Paseo's existing scheduler. No clock, provider, or second execution loop. */
export class ScheduleRegistry implements ScheduleStorePort {
  private index = new Map<string, Located[]>();
  private diagnostics: ScheduleStorageDiagnostic[] = [];
  private refreshedAt = -Infinity;
  private refreshing: Promise<void> | null = null;
  private queues = new Map<string, Promise<unknown>>();
  constructor(readonly ports: ScheduleRegistryPorts) {}
  private async serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const before = this.queues.get(key) ?? Promise.resolve();
    const next = before.catch(() => {}).then(operation);
    this.queues.set(key, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(key) === next) this.queues.delete(key);
    }
  }
  private file(origin: ScheduleOrigin, id: string) {
    assertScheduleId(id);
    return path.join(origin.directory, `${id}.json`);
  }
  private validate(schedule: StoredSchedule, origin: ScheduleOrigin, id: string) {
    if (schedule.id !== id || (schedule.otto && !sameOrigin({ id, ...schedule.otto }, origin)))
      throw new ScheduleError(
        "invalid",
        "Schedule file identity or storage origin does not match its owning store.",
      );
    if (origin.location !== "legacy" && !schedule.otto)
      throw new ScheduleError(
        "invalid",
        "This project Schedule needs an explicit storage assignment before execution.",
      );
  }
  private async read(origin: ScheduleOrigin, id: string) {
    if (!(await scheduleDirectory(origin.boundary, origin.directory))) return null;
    const bytes = await readScheduleFile(this.file(origin, id));
    if (bytes === null) return null;
    const schedule = parseOttoStoredSchedule(JSON.parse(bytes));
    this.validate(schedule, origin, id);
    return { schedule, bytes };
  }
  private async scan(
    origin: ScheduleOrigin,
    index: Map<string, Located[]>,
    diagnostics: ScheduleStorageDiagnostic[],
  ) {
    if (!(await scheduleDirectory(origin.boundary, origin.directory))) return;
    const files = (await readdir(origin.directory, { withFileTypes: true })).filter((entry) =>
      entry.name.endsWith(".json"),
    );
    if (files.length > 1000)
      throw new ScheduleError(
        "unavailable",
        "This Schedule store exceeds the bounded discovery limit. Archive records before refreshing.",
      );
    for (const file of files) {
      const id = file.name.slice(0, -5);
      let ref: ScheduleRef | null = null;
      try {
        assertScheduleId(id);
        ref = refFor(origin, id);
        const found = await this.read(origin, id);
        if (!found) continue;
        const rows = index.get(id) ?? [];
        rows.push({ origin, schedule: found.schedule, revision: scheduleRevision(found.schedule) });
        index.set(id, rows);
      } catch (error) {
        diagnostics.push({
          ref,
          code: "record_unavailable",
          message: storageMessage(error),
        });
      }
    }
  }
  /** Called by the existing scheduler's list and explicit library refresh. No per-project timer or idle polling. */
  async refresh(force = false): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (!force && (this.ports.now?.() ?? Date.now()) - this.refreshedAt < 30000) return;
    const pending = this.discover();
    this.refreshing = pending;
    try {
      await pending;
    } finally {
      if (this.refreshing === pending) this.refreshing = null;
    }
  }
  private async discover() {
    const index = new Map<string, Located[]>();
    const diagnostics: ScheduleStorageDiagnostic[] = [];
    const origins = [this.ports.stores.legacy()];
    const projects = await this.ports.projects();
    if (projects.length > 1000)
      throw new ScheduleError(
        "unavailable",
        "Schedule project discovery exceeds its bounded limit.",
      );
    for (const project of projects) {
      try {
        origins.push(
          ...(await this.ports.stores.locations({
            hostId: this.ports.stores.ports.hostId,
            projectId: project.projectId,
          })),
        );
      } catch (error) {
        diagnostics.push({
          ref: null,
          code: "project_unavailable",
          message: `Project ${project.projectId}: ${storageMessage(error)}`.slice(0, 2000),
        });
      }
    }
    const counts = new Map<string, number>();
    for (const origin of origins) {
      const key = normalizePathForIdentity(origin.directory);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const origin of origins) {
      const identity = normalizePathForIdentity(origin.directory);
      if (counts.get(identity) !== 1) {
        diagnostics.push({
          ref: null,
          code: "store_collision",
          message:
            "Two projects resolve to the same Schedule directory. Review their storage bindings.",
        });
        continue;
      }
      try {
        await this.scan(origin, index, diagnostics);
      } catch (error) {
        diagnostics.push({
          ref: null,
          code: "store_unavailable",
          message: storageMessage(error),
        });
      }
    }
    for (const [id, rows] of index)
      if (rows.length > 1)
        diagnostics.push({
          ref: null,
          code: "duplicate_id",
          message: `Schedule ${id} exists in multiple stores. Execution is blocked until an explicit repair.`,
        });
    this.index = index;
    this.diagnostics = diagnostics;
    this.refreshedAt = this.ports.now?.() ?? Date.now();
  }
  async problems() {
    await this.refresh();
    return this.diagnostics.slice();
  }
  async list(): Promise<StoredSchedule[]> {
    await this.refresh();
    return [...this.index.values()]
      .flatMap((rows) =>
        rows.length === 1 &&
        !(rows[0].schedule.status === "active" && rows[0].schedule.otto?.repairReason)
          ? [rows[0].schedule]
          : [],
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  /** Cached display catalog includes both exact origins of a duplicate. It grants
   * no execution or mutation authority; those paths reread and reject ambiguity. */
  async catalog(): Promise<(ScheduleEntry & { ambiguous: boolean })[]> {
    await this.refresh();
    return [...this.index.values()]
      .flatMap((rows) =>
        rows.map((row) => ({
          ref: refFor(row.origin, row.schedule.id),
          revision: row.revision,
          schedule: row.schedule,
          ambiguous: rows.length !== 1,
        })),
      )
      .sort((left, right) => left.schedule.createdAt.localeCompare(right.schedule.createdAt));
  }
  private async verifyOrigin(found: Located) {
    if (found.origin.location === "legacy") return;
    const scope = found.origin.scope;
    if (!scope.projectId)
      throw new ScheduleError("invalid", "Project Schedule has no owning project.");
    const current = (
      await this.ports.stores.locations({ hostId: scope.hostId, projectId: scope.projectId })
    ).find((origin) => sameOrigin(refFor(found.origin, found.schedule.id), origin));
    if (
      !current ||
      normalizePathForIdentity(current.directory) !==
        normalizePathForIdentity(found.origin.directory)
    )
      throw new ScheduleError(
        "conflict",
        "Schedule storage binding changed. Refresh and review its origin before execution.",
      );
  }
  private async locate(id: string, mutation?: ScheduleMutation): Promise<Located | null> {
    assertScheduleId(id);
    await this.refresh();
    const rows = this.index.get(id) ?? [];
    if (rows.length > 1)
      throw new ScheduleError(
        "conflict",
        "Duplicate Schedule identity. Repair its storage before execution.",
      );
    const found = rows[0];
    if (!found) return null;
    if (mutation && "ref" in mutation && !sameOrigin(mutation.ref, found.origin))
      throw new ScheduleError(
        "conflict",
        "Schedule storage origin changed. Reload before applying this action.",
      );
    await this.verifyOrigin(found);
    return found;
  }
  /** Read-only repair inspection is pinned to an exact ref even when execution is blocked. */
  async inspectOrigin(ref: ScheduleRef): Promise<ScheduleEntry | null> {
    assertScheduleId(ref.id);
    await this.refresh();
    const rows = (this.index.get(ref.id) ?? []).filter((row) => sameOrigin(ref, row.origin));
    if (rows.length !== 1)
      throw new ScheduleError(
        "conflict",
        "This exact Schedule origin is unavailable or ambiguous. Refresh its storage diagnostics.",
      );
    const found = rows[0];
    await this.verifyOrigin(found);
    const current = await this.read(found.origin, ref.id);
    return current
      ? {
          ref: refFor(found.origin, ref.id),
          revision: scheduleRevision(current.schedule),
          schedule: current.schedule,
        }
      : null;
  }
  async entry(id: string, ref?: ScheduleRef): Promise<ScheduleEntry | null> {
    const found = await this.locate(id);
    if (!found) return null;
    if (ref && !sameOrigin(ref, found.origin))
      throw new ScheduleError("conflict", "Select this Schedule's exact owning store.");
    const current = await this.read(found.origin, id);
    if (!current) return null;
    return {
      ref: refFor(found.origin, id),
      revision: scheduleRevision(current.schedule),
      schedule: current.schedule,
    };
  }
  async get(id: string) {
    return (await this.entry(id))?.schedule ?? null;
  }
  private remember(origin: ScheduleOrigin, schedule: StoredSchedule) {
    const rows = (this.index.get(schedule.id) ?? []).filter(
      (row) => row.origin.storeKey !== origin.storeKey,
    );
    this.index.set(schedule.id, [
      ...rows,
      { origin, schedule, revision: scheduleRevision(schedule) },
    ]);
  }
  private async originFor(schedule: Omit<StoredSchedule, "id">) {
    const meta = schedule.otto;
    if (!meta) {
      if (inputTargetNeedsProject(schedule.target))
        throw new ScheduleError(
          "invalid",
          "Extended Schedule targets require their owning project store.",
        );
      return this.ports.stores.legacy();
    }
    if (!meta.scope.projectId || meta.location === "legacy")
      throw new ScheduleError("invalid", "New extended Schedules require an owning project store.");
    const origins = await this.ports.stores.locations({
      ...meta.scope,
      projectId: meta.scope.projectId,
    });
    const origin = origins.find((item) => sameOrigin({ id: "new", ...meta }, item));
    if (!origin)
      throw new ScheduleError(
        "conflict",
        "Schedule storage selection changed. Reload before creating.",
      );
    return this.ports.stores.pin(origin);
  }
  async create(input: Omit<StoredSchedule, "id">): Promise<StoredSchedule> {
    const creation = input.otto?.creation;
    if (creation) {
      if (!input.otto)
        throw new ScheduleError("invalid", "Create operation needs an owning project.");
      const id = scheduleCreationId(input.otto.scope, creation.operationId);
      return this.serial(id, async () => {
        // A lost response may be retried after settings changed or the host restarted.
        // Resolve the operation identity across all stores before selecting/pinning a new one.
        await this.refresh(true);
        const existing = await this.get(id);
        if (existing) {
          if (existing.otto?.creation?.fingerprint !== creation.fingerprint)
            throw new ScheduleError(
              "conflict",
              "This create operation already saved different Schedule settings. Reload the saved Schedule.",
            );
          return existing;
        }
        return this.publishNew(input, id);
      });
    }
    await this.refresh();
    return this.publishNew(input);
  }
  private async publishNew(input: Omit<StoredSchedule, "id">, requestedId?: string) {
    const origin = await this.originFor(input);
    await scheduleDirectory(origin.boundary, origin.directory, true);
    const schedule = OttoStoredSchedule.parse({
      ...input,
      id:
        requestedId ??
        (origin.location === "legacy" ? randomBytes(4).toString("hex") : randomUUID()),
    });
    this.validate(schedule, origin, schedule.id);
    await publishScheduleFile(
      this.file(origin, schedule.id),
      JSON.stringify(schedule, null, 2) + "\n",
      null,
    );
    this.remember(origin, schedule);
    return schedule;
  }
  async update(
    id: string,
    updater: ScheduleUpdater,
    mutation?: ScheduleMutation,
  ): Promise<StoredSchedule | null> {
    return this.serial(id, async () => {
      const found = await this.locate(id, mutation);
      if (!found) return null;
      const current = await this.read(found.origin, id);
      if (!current) {
        this.index.delete(id);
        return null;
      }
      assertScheduleMutation(current.schedule, mutation);
      const next = reviewScheduleRepair(
        current.schedule,
        await updater(current.schedule),
        mutation,
        new Date(this.ports.now?.() ?? Date.now()).toISOString(),
      );
      if (next === current.schedule) {
        this.remember(found.origin, next);
        return next;
      }
      const schedule = OttoStoredSchedule.parse(next);
      this.validate(schedule, found.origin, id);
      const saved = preserveScheduleDiskRecord(
        JSON.parse(current.bytes),
        current.schedule,
        schedule,
      );
      await publishScheduleFile(
        this.file(found.origin, id),
        JSON.stringify(saved, null, 2) + "\n",
        scheduleDigest(current.bytes),
      );
      this.remember(found.origin, schedule);
      return schedule;
    });
  }
  async upsertByNameAndTarget(name: string, target: ScheduleTarget, options: ScheduleUpsert) {
    // Legacy native tools keep their global name/target identity; project-aware creates use explicit refs.
    const identity = nameTargetIdentityKey(name, target);
    return this.serial(`identity:${identity}`, async () => {
      while (true) {
        const found = (await this.list()).find((record) => this.matchesLegacy(record, identity));
        if (!found) return this.create(await options.create());
        let matched = false;
        const updated = await this.update(
          found.id,
          (current) => {
            if (!this.matchesLegacy(current, identity)) return current;
            matched = true;
            return options.update(current);
          },
          { legacyOnly: true },
        );
        if (matched && updated) return updated;
      }
    });
  }
  private matchesLegacy(record: StoredSchedule, identity: string) {
    return (
      !record.otto &&
      record.status !== "completed" &&
      !!record.name?.trim() &&
      nameTargetIdentityKey(record.name, record.target) === identity
    );
  }
  async delete(id: string, mutation?: ScheduleMutation): Promise<void> {
    await this.serial(id, async () => {
      const found = await this.locate(id, mutation);
      if (!found) return;
      const current = await this.read(found.origin, id);
      if (!current) return;
      assertScheduleMutation(current.schedule, mutation);
      if (current.schedule.runs.some((run) => run.status === "running"))
        throw new ScheduleError(
          "busy",
          "Cancel and settle the active Schedule run before deleting.",
        );
      await retireScheduleFile(this.file(found.origin, id), scheduleDigest(current.bytes));
      this.index.delete(id);
    });
  }
}
