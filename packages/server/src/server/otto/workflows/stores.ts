import path from "node:path";
import { z } from "zod";
import type {
  WorkflowKind,
  WorkflowLocation,
  WorkflowScope,
  WorkflowRef,
  WorkflowStorage,
} from "@getpaseo/plugin/otto/workflows";
import type { OttoProjectMetadata, OttoProjectSnapshot } from "../project-metadata.js";
import { OTTO_CONFIG_FILENAME } from "../config-migration.js";
import { normalizePathForIdentity } from "../../../utils/path.js";
import {
  WorkflowError,
  assertWorkflowId,
  readWorkflowFile,
  publishWorkflowFile,
  workflowDigest,
  workflowDirectory,
} from "./files.js";

export interface WorkflowStorePorts {
  home: string;
  hostId: string;
  hostLabel: string;
  metadata: Pick<OttoProjectMetadata, "read" | "update">;
}
export interface WorkflowStore {
  scope: WorkflowScope;
  location: WorkflowLocation;
  storeKey: string;
  directory: string;
  boundary: string;
  project: OttoProjectSnapshot;
}
const hostSettings = z
  .object({ location: z.enum(["repository", "host"]).optional() })
  .passthrough();
const retainedSettings = z
  .object({
    projectWorkflows: z
      .object({ defaultStoreLocation: z.enum(["repository", "host"]).optional() })
      .optional(),
  })
  .passthrough();

/** Workflow-specific policy uses the canonical project registry; it never consults Knowledge/Artifact location choices. */
export class WorkflowStores {
  constructor(readonly ports: WorkflowStorePorts) {
    if (!path.isAbsolute(ports.home))
      throw new WorkflowError("invalid", "Workflow storage needs its owning daemon home.");
  }
  async project(scope: WorkflowScope): Promise<OttoProjectSnapshot> {
    if (scope.hostId !== this.ports.hostId)
      throw new WorkflowError("invalid", "Select this Workflow's owning host.");
    return this.ports.metadata.read(scope.projectId);
  }
  async defaults() {
    await workflowDirectory(this.ports.home, this.ports.home);
    const file = path.join(this.ports.home, "workflow-settings.json");
    const bytes = await readWorkflowFile(file, 100000);
    const config = hostSettings.parse(bytes === null ? {} : JSON.parse(bytes));
    // COMPAT(otto09WorkflowDefault): added v0.10.0; remove after 2027-05-05 following explicit host-preference saves.
    const legacy =
      bytes === null
        ? await readWorkflowFile(path.join(this.ports.home, OTTO_CONFIG_FILENAME))
        : null;
    const retained = retainedSettings.parse(legacy === null ? {} : JSON.parse(legacy));
    return {
      file,
      bytes,
      legacy,
      config,
      location:
        config.location ??
        retained.projectWorkflows?.defaultStoreLocation ??
        ("repository" as const),
      revision: workflowDigest(JSON.stringify([bytes, legacy])),
    };
  }
  async saveDefaults(expectedRevision: string, location: "repository" | "host") {
    const state = await this.defaults();
    if (state.revision !== expectedRevision)
      throw new WorkflowError("conflict", "Workflow host settings changed. Reload before saving.");
    const next = JSON.stringify({ ...state.config, location }, null, 2) + "\n";
    await publishWorkflowFile(
      state.file,
      next,
      state.bytes === null ? null : workflowDigest(state.bytes),
    );
    return { revision: workflowDigest(JSON.stringify([next, null])), location };
  }
  private store(
    scope: WorkflowScope,
    project: OttoProjectSnapshot,
    location: "repository" | "host",
    name?: string,
  ): WorkflowStore {
    if (location === "repository")
      return {
        scope,
        project,
        location,
        boundary: project.rootPath,
        directory: path.join(project.rootPath, ".otto", "workflows"),
        storeKey: `workflows:repository:${scope.projectId}`,
      };
    const directoryName = name ?? this.newDirectory(project);
    assertWorkflowId(directoryName);
    if (directoryName.endsWith("."))
      throw new WorkflowError("invalid", "Workflow directory identity cannot end in a dot.");
    return {
      scope,
      project,
      location,
      boundary: this.ports.home,
      directory: path.join(this.ports.home, "project-workflows", directoryName),
      storeKey: `workflows:host:${this.ports.hostId}:${scope.projectId}:${workflowDigest(directoryName).slice(0, 24)}`,
    };
  }
  private newDirectory(project: OttoProjectSnapshot) {
    return `project-${workflowDigest(project.projectId).slice(0, 32)}`;
  }
  private legacyDirectory(project: OttoProjectSnapshot): string {
    const label =
      project.record.customName ?? project.record.displayName ?? path.basename(project.rootPath);
    const slug =
      String(label)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48)
        .replace(/-+$/g, "") || "project";
    const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug) ? `${slug}-project` : slug;
    const identity =
      typeof project.record.projectKey === "string"
        ? project.record.projectKey
        : normalizePathForIdentity(project.rootPath);
    return `${safe}-${workflowDigest(identity).slice(0, 8)}`;
  }
  async locations(scope: WorkflowScope, snapshot?: OttoProjectSnapshot): Promise<WorkflowStore[]> {
    const project = snapshot ?? (await this.project(scope));
    if (project.projectId !== scope.projectId || scope.hostId !== this.ports.hostId)
      throw new WorkflowError("invalid", "Workflow project belongs to another scope.");
    const bound = project.record.workflowDirectoryName;
    if (bound !== undefined && bound !== null && typeof bound !== "string")
      throw new WorkflowError("invalid", "The preserved Workflow directory identity is invalid.");
    const names = new Set<string>();
    if (typeof bound === "string") {
      assertWorkflowId(bound);
      names.add(bound);
    }
    // COMPAT(otto09WorkflowDirectory): added v0.10.0; remove after 2027-05-05 after verified explicit store assignment/transfer.
    const retained = [project.record.knowledgeDirectoryName, this.legacyDirectory(project)];
    for (const name of retained) {
      if (typeof name !== "string") continue;
      if (
        !/^[A-Za-z0-9_-]{1,120}$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)
      )
        continue;
      if (
        await workflowDirectory(
          this.ports.home,
          path.join(this.ports.home, "project-workflows", name),
        )
      )
        names.add(name);
    }
    names.add(this.newDirectory(project));
    return [
      this.store(scope, project, "repository"),
      ...[...names].map((name) => this.store(scope, project, "host", name)),
    ];
  }
  private override(project: OttoProjectSnapshot): "repository" | "host" | null {
    const result = z
      .enum(["repository", "host"])
      .nullable()
      .safeParse(project.record.workflowLocation ?? null);
    if (!result.success)
      throw new WorkflowError("invalid", "The preserved Workflow storage choice is invalid.");
    return result.data;
  }
  async selected(scope: WorkflowScope, snapshot?: OttoProjectSnapshot): Promise<WorkflowStore> {
    const stores = await this.locations(scope, snapshot);
    const repository = stores[0];
    const defaults = await this.defaults();
    const override = this.override(repository.project);
    const location =
      override ??
      ((await workflowDirectory(repository.boundary, repository.directory))
        ? "repository"
        : defaults.location);
    return location === "repository" ? repository : stores.find((s) => s.location === "host")!;
  }
  async at(scope: WorkflowScope, location: "repository" | "host"): Promise<WorkflowStore> {
    const stores = await this.locations(scope);
    return stores.find((s) => s.location === location)!;
  }
  async pin(store: WorkflowStore): Promise<WorkflowStore> {
    if (store.location !== "host" || typeof store.project.record.workflowDirectoryName === "string")
      return store;
    const saved = await this.ports.metadata.update({
      projectId: store.scope.projectId,
      expectedRevision: store.project.revision,
      patch: { workflowDirectoryName: path.basename(store.directory) },
    });
    return { ...store, project: saved };
  }
  // COMPAT(otto09WorkflowLibrary): added v0.10.0; remove after 2027-05-05 only after explicit assignment/transfer of retained global libraries.
  legacy(
    scope: WorkflowScope,
    project: OttoProjectSnapshot,
    kind: WorkflowKind,
  ): WorkflowStore | null {
    if (kind === "ai") return null;
    const directory = { graph: "orchestration-graphs", template: "prompt-templates", run: "runs" }[
      kind
    ];
    return {
      scope,
      project,
      location: "legacy",
      boundary: this.ports.home,
      directory: path.join(this.ports.home, directory),
      storeKey: `workflows:legacy:${kind}:${this.ports.hostId}`,
    };
  }
  async resolve(ref: WorkflowRef): Promise<WorkflowStore[]> {
    const stores = await this.locations(ref.scope);
    if (ref.location === "legacy") {
      const legacy = this.legacy(ref.scope, stores[0].project, ref.kind);
      return legacy && (!ref.storeKey || legacy.storeKey === ref.storeKey) ? [legacy] : [];
    }
    return stores.filter(
      (store) =>
        store.location === ref.location && (!ref.storeKey || store.storeKey === ref.storeKey),
    );
  }
  directory(store: WorkflowStore, kind: WorkflowKind): string {
    if (store.location === "legacy") return store.directory;
    return path.join(
      store.directory,
      { run: "runs", template: "templates", graph: "definitions", ai: "definitions" }[kind],
    );
  }
  file(store: WorkflowStore, kind: WorkflowKind, id: string): string {
    assertWorkflowId(id);
    return path.join(this.directory(store, kind), `${id}.json`);
  }
  async storage(scope: WorkflowScope, snapshot?: OttoProjectSnapshot): Promise<WorkflowStorage> {
    const selected = await this.selected(scope, snapshot);
    const defaults = await this.defaults();
    return {
      scope,
      projectLabel: String(
        selected.project.record.customName ??
          selected.project.record.displayName ??
          path.basename(selected.project.rootPath),
      ),
      hostLabel: this.ports.hostLabel,
      location: selected.location === "host" ? "host" : "repository",
      override: this.override(selected.project),
      revision: selected.project.revision,
      hostDefault: defaults.location,
    };
  }
  async saveStorage(
    scope: WorkflowScope,
    expectedRevision: string,
    location: "repository" | "host" | null,
  ) {
    await this.project(scope);
    const saved = await this.ports.metadata.update({
      projectId: scope.projectId,
      expectedRevision,
      patch: { workflowLocation: location },
    });
    return this.storage(scope, saved);
  }
}
