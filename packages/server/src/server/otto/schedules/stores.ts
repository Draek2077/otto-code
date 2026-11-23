import path from "node:path";
import { z } from "zod";
import type { ScheduleScope } from "@getpaseo/plugin/otto/schedules";
import type { OttoProjectMetadata, OttoProjectSnapshot } from "../project-metadata.js";
import { OTTO_CONFIG_FILENAME } from "../config-migration.js";
import {
  assertScheduleId,
  publishScheduleFile,
  readScheduleFile,
  scheduleDigest,
  scheduleDirectory,
  scheduleExclusive,
  ScheduleError,
} from "./files.js";

export type ProjectScheduleScope = ScheduleScope & { projectId: string };
export interface ScheduleStorePorts {
  home: string;
  hostId: string;
  hostLabel: string;
  metadata: Pick<OttoProjectMetadata, "read" | "update">;
}
export interface ScheduleOrigin {
  scope: ScheduleScope;
  location: "repository" | "host" | "legacy";
  storeKey: string;
  boundary: string;
  directory: string;
  project: OttoProjectSnapshot | null;
}
const hostSettings = z
  .object({ location: z.enum(["repository", "host"]).optional() })
  .passthrough();
const retainedSettings = z
  .object({
    projectSchedules: z
      .object({ defaultStoreLocation: z.enum(["repository", "host"]).optional() })
      .optional(),
  })
  .passthrough();

/** Schedules select their own category location. Existing records keep their exact origin. */
export class ScheduleStores {
  constructor(readonly ports: ScheduleStorePorts) {
    if (!path.isAbsolute(ports.home))
      throw new ScheduleError("invalid", "Schedules need the owning daemon home.");
  }
  async project(scope: ScheduleScope) {
    if (scope.hostId !== this.ports.hostId || !scope.projectId)
      throw new ScheduleError("invalid", "Select the Schedule's owning host and project.");
    return this.ports.metadata.read(scope.projectId);
  }
  async defaults() {
    await scheduleDirectory(this.ports.home, this.ports.home);
    const file = path.join(this.ports.home, "schedule-settings.json");
    const bytes = await readScheduleFile(file, 100000);
    const config = hostSettings.parse(bytes === null ? {} : JSON.parse(bytes));
    // COMPAT(otto09ScheduleDefault): added v0.10.0; remove after 2027-05-08 after explicit host-preference saves.
    const legacy =
      bytes === null
        ? await readScheduleFile(path.join(this.ports.home, OTTO_CONFIG_FILENAME))
        : null;
    const retained = retainedSettings.parse(legacy === null ? {} : JSON.parse(legacy));
    return {
      file,
      bytes,
      legacy,
      config,
      location: config.location ?? retained.projectSchedules?.defaultStoreLocation ?? "repository",
      revision: scheduleDigest(JSON.stringify([bytes, legacy])),
    };
  }
  async saveDefaults(expectedRevision: string, location: "repository" | "host") {
    const file = path.join(this.ports.home, "schedule-settings.json");
    return scheduleExclusive(`${file}.policy`, async () => {
      const current = await this.defaults();
      if (current.revision !== expectedRevision)
        throw new ScheduleError(
          "conflict",
          "Schedule host settings changed. Reload before saving.",
        );
      const next = JSON.stringify({ ...current.config, location }, null, 2) + "\n";
      await publishScheduleFile(
        file,
        next,
        current.bytes === null ? null : scheduleDigest(current.bytes),
      );
      return { location, revision: scheduleDigest(JSON.stringify([next, null])) };
    });
  }
  legacy(): ScheduleOrigin {
    return {
      scope: { hostId: this.ports.hostId, projectId: null },
      location: "legacy",
      storeKey: `schedules:legacy:${this.ports.hostId}`,
      boundary: this.ports.home,
      directory: path.join(this.ports.home, "schedules"),
      project: null,
    };
  }
  private store(
    scope: ProjectScheduleScope,
    project: OttoProjectSnapshot,
    location: "repository" | "host",
    name?: string,
  ): ScheduleOrigin {
    const directoryName = name ?? `project-${scheduleDigest(project.projectId).slice(0, 32)}`;
    assertScheduleId(directoryName);
    return {
      scope,
      project,
      location,
      boundary: location === "repository" ? project.rootPath : this.ports.home,
      directory:
        location === "repository"
          ? path.join(project.rootPath, ".otto", "schedules")
          : path.join(this.ports.home, "project-schedules", directoryName),
      storeKey:
        location === "repository"
          ? `schedules:repository:${scope.projectId}`
          : `schedules:host:${scope.hostId}:${scope.projectId}:${scheduleDigest(directoryName).slice(0, 24)}`,
    };
  }
  async locations(
    scope: ProjectScheduleScope,
    snapshot?: OttoProjectSnapshot,
  ): Promise<ScheduleOrigin[]> {
    const project = snapshot ?? (await this.project(scope));
    if (project.projectId !== scope.projectId || scope.hostId !== this.ports.hostId)
      throw new ScheduleError("invalid", "Schedule project belongs to another host or project.");
    const bound = project.record.scheduleDirectoryName;
    if (bound !== null && bound !== undefined && typeof bound !== "string")
      throw new ScheduleError("invalid", "The preserved Schedule directory binding is invalid.");
    const names = new Set<string>();
    if (typeof bound === "string") {
      assertScheduleId(bound);
      names.add(bound);
    }
    // COMPAT(otto09ScheduleDirectory): added v0.10.0; remove after 2027-05-08 following explicit assignment/transfer.
    // A recorded directory identity is evidence only when that Schedule directory exists.
    // Knowledge's location choice is never consulted.
    const old = project.record.knowledgeDirectoryName;
    if (
      typeof old === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(old) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(old) &&
      (await scheduleDirectory(
        this.ports.home,
        path.join(this.ports.home, "project-schedules", old),
      ))
    )
      names.add(old);
    names.add(`project-${scheduleDigest(project.projectId).slice(0, 32)}`);
    return [
      this.store(scope, project, "repository"),
      ...[...names].map((name) => this.store(scope, project, "host", name)),
    ];
  }
  private override(project: OttoProjectSnapshot) {
    const value = z
      .enum(["repository", "host"])
      .nullable()
      .safeParse(project.record.scheduleLocation ?? null);
    if (!value.success)
      throw new ScheduleError("invalid", "The preserved Schedule location is invalid.");
    return value.data;
  }
  async selected(
    scope: ProjectScheduleScope,
    snapshot?: OttoProjectSnapshot,
  ): Promise<ScheduleOrigin> {
    const project = snapshot ?? (await this.project(scope));
    const location = this.override(project) ?? (await this.defaults()).location;
    const origin = (await this.locations(scope, project)).find(
      (store) => store.location === location,
    );
    if (!origin) throw new ScheduleError("invalid", "Schedule storage could not be resolved.");
    return origin;
  }
  async pin(origin: ScheduleOrigin): Promise<ScheduleOrigin> {
    if (
      origin.location !== "host" ||
      !origin.project ||
      typeof origin.project.record.scheduleDirectoryName === "string"
    )
      return origin;
    const project = await this.ports.metadata.update({
      projectId: origin.project.projectId,
      expectedRevision: origin.project.revision,
      patch: { scheduleDirectoryName: path.basename(origin.directory) },
    });
    return { ...origin, project };
  }
  async storage(scope: ProjectScheduleScope, snapshot?: OttoProjectSnapshot) {
    const selected = await this.selected(scope, snapshot);
    const project = selected.project;
    if (!project) throw new ScheduleError("invalid", "Select a project for Schedule settings.");
    const defaults = await this.defaults();
    return {
      scope,
      hostLabel: this.ports.hostLabel,
      projectLabel: String(
        project.record.customName ?? project.record.displayName ?? path.basename(project.rootPath),
      ),
      location: selected.location,
      override: this.override(project),
      revision: project.revision,
      hostDefault: defaults.location,
    };
  }
  async saveStorage(
    scope: ProjectScheduleScope,
    expectedRevision: string,
    location: "repository" | "host" | null,
  ) {
    await this.project(scope);
    const saved = await this.ports.metadata.update({
      projectId: scope.projectId,
      expectedRevision,
      patch: { scheduleLocation: location },
    });
    return this.storage(scope, saved);
  }
}
