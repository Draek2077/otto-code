import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
// OTTO(schedules): internal extended records never change the legacy wire target union.
import { OttoStoredSchedule as StoredScheduleSchema } from "@getpaseo/plugin/otto/schedules";
import type { ScheduleTarget, StoredSchedule, ScheduleMutation } from "../otto/schedules/types.js";
import { assertScheduleMutation } from "../otto/schedules/legacy.js";
// OTTO(store-continuity): preserve dormant schedule fields and skip unsupported saved targets.
import { parseOttoStoredSchedule, writeOttoStoredSchedule } from "../otto/schedule-continuity.js";

function generateScheduleId(): string {
  return randomBytes(4).toString("hex");
}

type ScheduleUpdater = (schedule: StoredSchedule) => StoredSchedule | Promise<StoredSchedule>;

interface ScheduleNameTargetUpsert {
  create: () => Omit<StoredSchedule, "id"> | Promise<Omit<StoredSchedule, "id">>;
  update: ScheduleUpdater;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonicalize(source[key])]),
    );
  }
  return value;
}

function normalizeScheduleName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Schedule name is required");
  }
  return trimmed;
}

function normalizeOptionalScheduleName(name: string | null): string | null {
  if (name === null) {
    return null;
  }
  const trimmed = name.trim();
  return trimmed ? trimmed : null;
}

function targetIdentity(target: ScheduleTarget): unknown {
  if (target.type === "agent") {
    return {
      type: target.type,
      agentId: target.agentId,
    };
  }

  // OTTO(schedules): keep each explicit non-agent target's complete identity.
  if (target.type !== "new-agent") return target;

  return {
    type: target.type,
    config: target.config,
  };
}

export function nameTargetIdentityKey(name: string, target: ScheduleTarget): string {
  // OTTO(schedules): share Paseo's existing upsert identity with the project registry.
  return JSON.stringify(
    canonicalize({
      name: normalizeScheduleName(name),
      target: targetIdentity(target),
    }),
  );
}

function matchesNameAndTarget(
  schedule: StoredSchedule,
  name: string,
  target: ScheduleTarget,
): boolean {
  const scheduleName = normalizeOptionalScheduleName(schedule.name);
  return (
    schedule.status !== "completed" &&
    scheduleName !== null &&
    scheduleName === normalizeScheduleName(name) &&
    nameTargetIdentityKey(scheduleName, schedule.target) === nameTargetIdentityKey(name, target)
  );
}

function parseStoredSchedule(
  content: string,
): { success: true; data: StoredSchedule } | { success: false; error: unknown } {
  let json: unknown;
  try {
    json = JSON.parse(content);
    return { success: true, data: parseOttoStoredSchedule(json) };
  } catch (error) {
    return { success: false, error };
  }
}

export class ScheduleStore {
  private readonly scheduleMutations = new Map<string, Promise<unknown>>();
  private readonly identityMutations = new Map<string, Promise<unknown>>();
  private reportedInvalidFiles = new Set<string>();

  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
  ) {}

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  // The service lists schedules on every tick, so a file that is not a valid schedule is
  // reported when it first appears rather than once per second.
  async list(): Promise<StoredSchedule[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = join(this.dir, entry.name);
          return { filePath, parsed: parseStoredSchedule(await readFile(filePath, "utf-8")) };
        }),
    );
    const schedules: StoredSchedule[] = [];
    const invalidFiles = new Set<string>();
    for (const { filePath, parsed } of files) {
      if (parsed.success) {
        schedules.push(parsed.data);
        continue;
      }
      invalidFiles.add(filePath);
      if (!this.reportedInvalidFiles.has(filePath)) {
        this.logger.error({ err: parsed.error, filePath }, "Skipping invalid schedule file");
      }
    }
    this.reportedInvalidFiles = invalidFiles;
    return schedules.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async get(id: string): Promise<StoredSchedule | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(id), "utf-8");
      return parseOttoStoredSchedule(JSON.parse(content)); // OTTO(store-continuity)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async create(schedule: Omit<StoredSchedule, "id">): Promise<StoredSchedule> {
    const created = StoredScheduleSchema.parse({ ...schedule, id: generateScheduleId() });
    await this.write(created);
    return created;
  }

  async update(
    id: string,
    updater: ScheduleUpdater,
    mutation?: ScheduleMutation,
  ): Promise<StoredSchedule | null> {
    // OTTO(schedules): optional revision/legacy-bound mutation.
    return this.serializeScheduleMutation(id, async () => {
      const current = await this.get(id);
      if (!current) {
        return null;
      }
      assertScheduleMutation(current, mutation); // OTTO(schedules)
      const next = await updater(current);
      if (next === current) {
        return current;
      }
      if (next.id !== id) {
        throw new Error(`Schedule update cannot change id: ${id}`);
      }
      const updated = StoredScheduleSchema.parse(next);
      await this.write(updated);
      return updated;
    });
  }

  async upsertByNameAndTarget(
    name: string,
    target: ScheduleTarget,
    options: ScheduleNameTargetUpsert,
  ): Promise<StoredSchedule> {
    const identity = nameTargetIdentityKey(name, target);
    return this.serializeIdentityMutation(identity, async () => {
      while (true) {
        const existing = (await this.list()).find((schedule) =>
          matchesNameAndTarget(schedule, name, target),
        );
        if (!existing) {
          const created = StoredScheduleSchema.parse({
            ...(await options.create()),
            id: generateScheduleId(),
          });
          if (!matchesNameAndTarget(created, name, target)) {
            throw new Error("Created schedule does not match requested identity");
          }
          await this.write(created);
          return created;
        }

        const updated = await this.updateMatchedSchedule(existing.id, name, target, options.update);
        if (updated) {
          return updated;
        }
      }
    });
  }

  private async write(schedule: StoredSchedule): Promise<void> {
    await this.ensureDir();
    await writeOttoStoredSchedule(this.filePath(schedule.id), schedule); // OTTO(store-continuity)
  }

  async delete(id: string, mutation?: ScheduleMutation): Promise<void> {
    // OTTO(schedules)
    await this.serializeScheduleMutation(id, async () => {
      if (mutation) {
        // OTTO(schedules): guard before deleting; no extra read on the original path.
        const current = await this.get(id);
        if (!current) throw new Error("Schedule no longer exists.");
        assertScheduleMutation(current, mutation);
      }
      await this.ensureDir();
      await rm(this.filePath(id), { force: true });
    });
  }

  private async serializeScheduleMutation<T>(
    scheduleId: string,
    mutation: () => Promise<T>,
  ): Promise<T> {
    return this.serializeMutation(this.scheduleMutations, scheduleId, mutation);
  }

  private async serializeIdentityMutation<T>(
    identity: string,
    mutation: () => Promise<T>,
  ): Promise<T> {
    return this.serializeMutation(this.identityMutations, identity, mutation);
  }

  private async serializeMutation<T>(
    promises: Map<string, Promise<unknown>>,
    key: string,
    mutation: () => Promise<T>,
  ): Promise<T> {
    const previous = promises.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(mutation);
    promises.set(key, next);
    try {
      return await next;
    } finally {
      if (promises.get(key) === next) {
        promises.delete(key);
      }
    }
  }

  private async updateMatchedSchedule(
    id: string,
    name: string,
    target: ScheduleTarget,
    updater: ScheduleUpdater,
  ): Promise<StoredSchedule | null> {
    return this.serializeScheduleMutation(id, async () => {
      const current = await this.get(id);
      if (!current || !matchesNameAndTarget(current, name, target)) {
        return null;
      }
      const next = await updater(current);
      if (next.id !== id) {
        throw new Error(`Schedule update cannot change id: ${id}`);
      }
      const updated = StoredScheduleSchema.parse(next);
      if (!matchesNameAndTarget(updated, name, target)) {
        throw new Error("Updated schedule does not match requested identity");
      }
      await this.write(updated);
      return updated;
    });
  }
}
