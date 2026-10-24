import path from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  readKnowledgeCatalog,
  readKnowledgePage,
  readKnowledgeRoot,
  mutateKnowledge,
  setKnowledgeLocation,
  waitKnowledgeChanges,
  releaseKnowledgeChanges,
  type KnowledgeScope,
  type KnowledgeCommand,
} from "@getpaseo/plugin/otto/project-knowledge";
import type { OttoProjectMetadata } from "../project-metadata.js";
import { OttoProjectMetadataError } from "../project-metadata.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import {
  KnowledgeService,
  KnowledgeNotFoundError,
  KnowledgePurgeIncompleteError,
  knowledgeRoots,
  type KnowledgeDocument,
} from "./knowledge-service.js";
import { KnowledgeStoreResolver, hasCode } from "./store-resolver.js";
import { KnowledgeBusyError, KnowledgeConflictError } from "./knowledge-files.js";
import { KnowledgeRecordOperations, recordDetails } from "./record-operations.js";
import { initializeKnowledgeRoots } from "./bootstrap.js";
import { copyKnowledgeStore } from "./migration.js";
import { assertSafeSegment, type KnowledgeStore } from "./store-resolver.js";
import { KnowledgeObservations } from "./observation.js";

const location = z.enum(["repository", "host"]);
const projectFields = z.object({
  knowledgeLocation: location.nullish(),
  knowledgeDirectoryName: z.string().nullable().optional(),
});
const preservedConfig = z.object({
  projectKnowledge: z.object({ defaultStoreLocation: location.optional() }).optional(),
});
class KnowledgeHostError extends Error {
  constructor(
    readonly code: "wrong_host" | "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

function pageValue(page: KnowledgeDocument) {
  const { metadata, revision, statement, timeline } = page;
  return {
    id: metadata.id,
    kind: metadata.kind,
    title: metadata.title,
    status: metadata.status,
    tags: metadata.tags,
    updatedAt: metadata.updated_at,
    revision,
    statement,
    timeline,
    ...recordDetails(page),
  };
}

/** One daemon/project identity boundary for plugin UI and provider-neutral MCP tools. */
export class KnowledgeDaemonService {
  readonly service: KnowledgeService;
  readonly records: KnowledgeRecordOperations;
  readonly resolver: KnowledgeStoreResolver;
  readonly observations: KnowledgeObservations;
  constructor(
    private readonly ports: {
      hostId: string;
      home: string;
      metadata: Pick<OttoProjectMetadata, "read" | "update">;
      workspaces: Pick<WorkspaceRegistry, "get">;
      now?: () => Date;
    },
  ) {
    this.resolver = new KnowledgeStoreResolver({
      ottoHome: ports.home,
      resolveProject: async (projectId) => {
        const project = await ports.metadata.read(projectId);
        return { projectId, rootPath: project.rootPath, ...projectFields.parse(project.record) };
      },
      defaultLocation: async () => {
        try {
          const config = preservedConfig.parse(
            JSON.parse(await readFile(path.join(ports.home, "otto-config.json"), "utf8")),
          );
          return config.projectKnowledge?.defaultStoreLocation ?? "repository";
        } catch (error) {
          if (hasCode(error, "ENOENT")) return "repository";
          throw error;
        }
      },
    });
    this.service = new KnowledgeService({
      resolver: this.resolver,
      now: ports.now ?? (() => new Date()),
    });
    this.records = new KnowledgeRecordOperations(this.service);
    this.observations = new KnowledgeObservations({
      resolve: (projectId) => this.resolver.resolve(projectId),
    });
  }

  async resolveProject(scope: KnowledgeScope) {
    if (scope.hostId !== this.ports.hostId)
      throw new KnowledgeHostError("wrong_host", "Select the project's owning host.");
    let projectId = scope.target.id;
    if (scope.target.kind === "workspace") {
      const workspace = await this.ports.workspaces.get(scope.target.id);
      if (!workspace || workspace.archivedAt)
        throw new KnowledgeHostError("not_found", "This workspace is no longer available.");
      projectId = workspace.projectId;
    }
    return this.ports.metadata.read(projectId);
  }

  workspaceScope(workspaceId: string): KnowledgeScope {
    return { hostId: this.ports.hostId, target: { kind: "workspace", id: workspaceId } };
  }

  async setLocation(input: z.infer<typeof setKnowledgeLocation.input>) {
    const project = await this.resolveProject(input.scope);
    if (project.revision !== input.expectedRevision) throw new KnowledgeConflictError();
    const from = await this.resolver.resolve(project.projectId);
    const fields = projectFields.parse(project.record);
    const directoryName = fields.knowledgeDirectoryName ?? `project-${randomUUID()}`;
    assertSafeSegment(directoryName);
    let publication = project;
    if (input.location === "host" && !fields.knowledgeDirectoryName)
      publication = await this.ports.metadata.update({
        projectId: project.projectId,
        expectedRevision: project.revision,
        patch: { knowledgeDirectoryName: directoryName },
      });
    const to: KnowledgeStore =
      input.location === "repository"
        ? {
            ...from,
            location: "repository",
            boundary: project.rootPath,
            base: path.join(project.rootPath, ".otto"),
          }
        : {
            ...from,
            location: "host",
            boundary: this.ports.home,
            base: path.join(this.ports.home, "project-knowledge", directoryName),
          };
    const result = await copyKnowledgeStore({
      from,
      to,
      publish: async () => {
        await this.ports.metadata.update({
          projectId: project.projectId,
          expectedRevision: publication.revision,
          patch: { knowledgeLocation: input.location },
        });
      },
    });
    this.observations.notify(project.projectId);
    return result;
  }

  async catalog(input: z.infer<typeof readKnowledgeCatalog.input>) {
    const project = await this.resolveProject(input.scope);
    const store = await this.resolver.resolve(project.projectId);
    const fields = projectFields.parse(project.record);
    const query = input.query.trim().toLowerCase();
    const pages = (await this.service.catalog(project.projectId, input.includeInactive))
      .filter(
        (page) =>
          !query ||
          `${page.title}\n${page.id}\n${page.tags.join(" ")}`.toLowerCase().includes(query),
      )
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const roots = [];
    for (const slug of knowledgeRoots) {
      const root = await this.service.readRoot({ projectId: project.projectId, slug });
      roots.push({ slug, revision: root?.revision ?? null });
    }
    return {
      settings: {
        projectId: project.projectId,
        label: String(project.record.customName ?? project.record.displayName ?? project.projectId),
        revision: project.revision,
        location: store.location,
        override: fields.knowledgeLocation ?? null,
        directoryName: fields.knowledgeDirectoryName ?? null,
        path: store.base,
      },
      records: pages.slice(input.offset, input.offset + input.limit),
      total: pages.length,
      nextOffset: input.offset + input.limit < pages.length ? input.offset + input.limit : null,
      roots,
    };
  }

  async mutate(scope: KnowledgeScope, command: KnowledgeCommand) {
    const project = await this.resolveProject(scope);
    const input = { ...command, projectId: project.projectId };
    switch (input.action) {
      case "create":
        await this.service.createDraft(input);
        break;
      case "truth":
        await this.service.updateTruth(input);
        break;
      case "describe":
        await this.records.describe(input);
        break;
      case "evidence":
        await this.service.appendEvidence(input);
        break;
      case "review":
        await this.records.review(input);
        break;
      case "delivery":
        await this.records.delivery(input);
        break;
      case "reference":
        await this.records.reference(input);
        break;
      case "root":
        await this.service.writeRoot(input);
        break;
      case "initialize":
        await initializeKnowledgeRoots({
          service: this.service,
          projectId: project.projectId,
          projectRoot: project.rootPath,
        });
        break;
      case "purge":
        try {
          await this.service.purge(input);
        } finally {
          this.observations.notify(project.projectId);
        }
        return { changed: true as const };
    }
    this.observations.notify(project.projectId);
    return { changed: true as const };
  }

  invoke(method: string, value: unknown, clientId = ""): Promise<unknown> | undefined {
    switch (method) {
      case waitKnowledgeChanges.name:
        return this.guard(async () => {
          const input = waitKnowledgeChanges.input.parse(value);
          const project = await this.resolveProject(input.scope);
          return waitKnowledgeChanges.output.parse({
            ok: true,
            value: await this.observations.wait(
              clientId,
              input.leaseId,
              project.projectId,
              input.cursor,
            ),
          });
        });
      case releaseKnowledgeChanges.name:
        return this.guard(async () => {
          const input = releaseKnowledgeChanges.input.parse(value);
          await this.observations.release(clientId, input.leaseId);
          return releaseKnowledgeChanges.output.parse({ ok: true, value: { released: true } });
        });
      case readKnowledgeCatalog.name:
        return this.guard(async () => {
          const input = readKnowledgeCatalog.input.parse(value);
          return readKnowledgeCatalog.output.parse({ ok: true, value: await this.catalog(input) });
        });
      case readKnowledgePage.name:
        return this.guard(async () => {
          const input = readKnowledgePage.input.parse(value);
          const project = await this.resolveProject(input.scope);
          return readKnowledgePage.output.parse({
            ok: true,
            value: pageValue(await this.service.read({ ...input, projectId: project.projectId })),
          });
        });
      case readKnowledgeRoot.name:
        return this.guard(async () => {
          const input = readKnowledgeRoot.input.parse(value);
          const project = await this.resolveProject(input.scope);
          const root = await this.service.readRoot({ ...input, projectId: project.projectId });
          return readKnowledgeRoot.output.parse({
            ok: true,
            value: root && { body: root.body, revision: root.revision },
          });
        });
      case mutateKnowledge.name:
        return this.guard(async () => {
          const input = mutateKnowledge.input.parse(value);
          return mutateKnowledge.output.parse({
            ok: true,
            value: await this.mutate(input.scope, input.command),
          });
        });
      case setKnowledgeLocation.name:
        return this.guard(async () => {
          const input = setKnowledgeLocation.input.parse(value);
          return setKnowledgeLocation.output.parse({
            ok: true,
            value: await this.setLocation(input),
          });
        });
      default:
        return undefined;
    }
  }

  releaseClient(clientId: string): Promise<void> {
    return this.observations.releaseClient(clientId);
  }
  close(): Promise<void> {
    return this.observations.close();
  }

  private async guard(run: () => Promise<unknown>) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof KnowledgePurgeIncompleteError)
        return { ok: false, error: { code: "conflict", message: error.message } };
      if (error instanceof KnowledgeNotFoundError)
        return { ok: false, error: { code: "not_found", message: error.message } };
      if (error instanceof KnowledgeHostError)
        return { ok: false, error: { code: error.code, message: error.message } };
      if (
        error instanceof KnowledgeConflictError ||
        (error instanceof OttoProjectMetadataError && error.kind === "conflict")
      )
        return {
          ok: false,
          error: {
            code: "conflict",
            message: "Knowledge changed. Your draft is retained; reload before saving.",
          },
        };
      if (error instanceof KnowledgeBusyError)
        return {
          ok: false,
          error: {
            code: "busy",
            message:
              "The Knowledge store has an active or abandoned write lock. Inspect its writer before recovery.",
          },
        };
      if (error instanceof OttoProjectMetadataError && error.kind === "not_found")
        return {
          ok: false,
          error: { code: "not_found", message: "Select an active project on this host." },
        };
      if (error instanceof z.ZodError)
        return {
          ok: false,
          error: {
            code: "invalid",
            message:
              "The Knowledge request or preserved data is invalid. Existing files were left unchanged.",
          },
        };
      return {
        ok: false,
        error: {
          code: "unavailable",
          message:
            "The owning host could not complete this Knowledge operation. Its outcome is unknown; reload before another explicit attempt. No automatic retry was performed.",
        },
      };
    }
  }
}
