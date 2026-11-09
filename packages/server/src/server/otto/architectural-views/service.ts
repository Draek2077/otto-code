import path from "node:path";
import { z } from "zod";
import * as rpc from "@getpaseo/plugin/otto/architectural-views";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type { KnowledgeDaemonService } from "../project-knowledge/host.js";
import { knowledgeRoots } from "../project-knowledge/knowledge-service.js";
import type { OttoProjectMetadata } from "../project-metadata.js";
import { OttoProjectMetadataError } from "../project-metadata.js";
import {
  KnowledgeBusyError,
  KnowledgeConflictError,
} from "../project-knowledge/knowledge-files.js";
import { ArtifactError, readBounded } from "../artifacts/files.js";
import { ViewLibrary } from "./library.js";
import { createViewStores } from "./stores.js";
import { ViewDrafts } from "./drafts.js";
import { ViewPublication } from "./publication.js";
import { ArchitecturalViewRenderer, archifyRuntimeDirectory } from "./renderer.js";
import { ViewContentCache } from "./content.js";
import { ViewObservations } from "./observation.js";
import { ViewWrites } from "./writes.js";
import { ViewOpenIntents } from "./open-intents.js";
import { ArchitecturalViewError } from "./specification.js";
import { readDraft, readPublished } from "./records.js";
import { viewRevisionRecords } from "./history.js";

export interface ViewAuthoringPort {
  start(
    input: z.infer<typeof rpc.startViewAuthoring.input>,
  ): Promise<{ draft: rpc.ViewDraft; agentId: string }>;
}
interface Ports {
  hostId: string;
  home: string;
  knowledge: KnowledgeDaemonService;
  metadata: Pick<OttoProjectMetadata, "read">;
  report(error: unknown): void;
}
/** One host owner for paired UI, CLI and provider-neutral tools. Construction is inert. */
export class ArchitecturalViewsService {
  readonly library: ViewLibrary;
  readonly drafts: ViewDrafts;
  readonly publication: ViewPublication;
  readonly renderer: ArchitecturalViewRenderer;
  readonly content: ViewContentCache;
  readonly observations: ViewObservations;
  private closed = false;
  private readonly writes = new ViewWrites();
  private authoring: ViewAuthoringPort | null = null;
  private readonly intents = new ViewOpenIntents();
  constructor(readonly ports: Ports) {
    const stores = createViewStores(ports);
    this.library = new ViewLibrary({
      ...stores,
      resolve: async (projectId) => {
        this.writes.assertOpen();
        const result = await stores.resolve(projectId);
        this.writes.assertOpen();
        return result;
      },
    });
    this.renderer = new ArchitecturalViewRenderer({
      boundary: ports.home,
      scratchRoot: path.join(ports.home, "cache", "architectural-view-renders"),
    });
    this.content = new ViewContentCache(this.library, this.renderer);
    this.drafts = new ViewDrafts(
      this.library,
      this.renderer,
      this.writes.run,
      (projectId, draft, html) => {
        try {
          this.content.prime(
            {
              projectId,
              identity: { viewId: draft.viewId, origin: draft.origin },
              selection: { kind: "draft", draftId: draft.draftId },
            },
            draft.revision,
            html,
          );
        } catch (error) {
          this.ports.report(error);
        }
      },
    );
    this.publication = new ViewPublication(this.library, this.renderer, this.writes.run);
    this.observations = new ViewObservations(this.library);
  }
  available() {
    return !this.closed && this.renderer.available();
  }
  setAuthoring(port: ViewAuthoringPort) {
    this.authoring = port;
  }
  workspaceScope(workspaceId: string) {
    return this.ports.knowledge.workspaceScope(workspaceId);
  }
  async project(scope: rpc.ViewScope): Promise<string> {
    if (this.closed) throw new ArchitecturalViewError("unavailable", "The host is shutting down.");
    if (scope.hostId !== this.ports.hostId)
      throw new ArchitecturalViewError("wrong_host", "Choose the owning host for this View.");
    return (await this.ports.knowledge.resolveProject(scope)).projectId;
  }
  notify(projectId: string): void {
    void this.observations.notify(projectId).catch(this.ports.report);
  }
  async contract(diagramType: rpc.ViewKind) {
    const runtime = archifyRuntimeDirectory();
    const schema = await readBounded(
      path.join(runtime, "schemas", `${diagramType}.schema.json`),
      30000,
    );
    const commonSchema = await readBounded(
      path.join(runtime, "schemas", "common.schema.json"),
      15000,
    );
    if (!schema || !commonSchema)
      throw new ArchitecturalViewError(
        "unavailable",
        "The host's View contracts are missing. Update this host.",
      );
    return {
      diagramType,
      schema,
      commonSchema,
      guidance:
        "Author only the selected draft, using its current specification and expectedRevision. Read the linked Knowledge through the existing Knowledge tools; do not invent repository facts. Drafts are not published by tools. Use semantic component kinds, not brand artwork or external URLs. Respect the schema's explicit geometry, node/edge identities and non-overlap rules; update_architectural_view_draft validates with the real pinned renderer and returns actionable diagnostics. Repair that same draft after validation rejection. On a conflict or unacknowledged write, read/inspect before a new action; never create replacement drafts or silently rebase. The human publishes or discards in Otto.",
    };
  }
  async inspect(input: z.infer<typeof rpc.inspectViewOperation.input>) {
    const projectId = await this.project(input.scope);
    const store = await this.library.store(projectId, input.identity);
    const current = await readPublished(store, input.identity.viewId);
    const records = current
      ? [current, ...(await viewRevisionRecords(store, input.identity.viewId))]
      : [];
    const published = records.find(
      (record) => record.value.ottoPublication?.operationId === input.operationId,
    );
    const removed = records.find((record) => {
      const lifecycle = record.value.ottoPublication?.lifecycle;
      return lifecycle?.state === "removed" && lifecycle.operationId === input.operationId;
    });
    const draft = input.draftId
      ? await readDraft(store, input.identity.viewId, input.draftId)
      : null;
    const discarded =
      draft?.value.ottoDraft?.state === "discarded" &&
      draft.value.ottoDraft.operationId === input.operationId;
    let outcome: "published" | "discarded" | "removed" | "not_observed" = "not_observed";
    if (removed) outcome = "removed";
    else if (published) outcome = "published";
    else if (discarded) outcome = "discarded";
    return {
      publication: current ? await this.library.summary(store, current) : null,
      draft: draft ? await this.library.draftSummary(store, draft) : null,
      outcome,
    };
  }
  async show(input: z.infer<typeof rpc.showView.input>) {
    const projectId = await this.project(input.scope);
    if ((await this.project(this.workspaceScope(input.workspaceId))) !== projectId)
      throw new ArchitecturalViewError("invalid", "Choose a workspace in this View's project.");
    const document = await this.library.read(projectId, input.identity, { kind: "published" });
    if (document.kind === "draft" || document.view.state !== "published")
      throw new ArchitecturalViewError(
        "not_found",
        "Only published Views can be shown in a workspace.",
      );
    this.intents.show(input.workspaceId, input.identity);
    return document.view;
  }
  invoke(method: string, value: unknown, clientId: string): Promise<unknown> | undefined {
    const read = this.readRoute(method, value, clientId);
    return read ?? this.writeRoute(method, value);
  }
  private readRoute(
    method: string,
    value: unknown,
    clientId: string,
  ): Promise<unknown> | undefined {
    switch (method) {
      case rpc.readViews.name:
        return this.handle(rpc.readViews, value, async (input) =>
          this.library.catalog(
            await this.project(input.scope),
            input.reference,
            input.offset,
            input.query,
          ),
        );
      case rpc.readView.name:
        return this.handle(rpc.readView, value, async (input) =>
          this.library.read(await this.project(input.scope), input.identity, input.selection),
        );
      case rpc.readViewContract.name:
        return this.handle(rpc.readViewContract, value, async (input) => {
          await this.project(input.scope);
          return this.contract(input.diagramType);
        });
      case rpc.readViewSources.name:
        return this.handle(rpc.readViewSources, value, async (input) => {
          const projectId = await this.project(input.scope);
          const records = await this.ports.knowledge.service.catalog(projectId, true);
          const sources = [
            ...knowledgeRoots.map((id) => ({
              reference: { kind: "root" as const, id },
              title: id,
              status: "root",
            })),
            ...records.map((record) => ({
              reference: { kind: "record" as const, id: record.id },
              title: record.title.slice(0, 512),
              status: record.status,
            })),
          ].filter((entry) =>
            `${entry.title} ${entry.reference.id}`
              .toLowerCase()
              .includes((input.query ?? "").toLowerCase()),
          );
          const offset = input.offset ?? 0;
          return {
            sources: sources.slice(offset, offset + 100),
            nextOffset: offset + 100 < sources.length ? offset + 100 : null,
          };
        });
      case rpc.inspectViewOperation.name:
        return this.handle(rpc.inspectViewOperation, value, (input) => this.inspect(input));
      case rpc.renderView.name:
        return this.handle(rpc.renderView, value, async (input) =>
          this.content.prepare({ ...input, projectId: await this.project(input.scope) }),
        );
      case rpc.readViewContentPart.name:
        return this.handle(rpc.readViewContentPart, value, async (input) =>
          this.content.part({ ...input, projectId: await this.project(input.scope) }),
        );
      case rpc.listViewRevisions.name:
        return this.handle(rpc.listViewRevisions, value, async (input) => {
          const projectId = await this.project(input.scope),
            store = await this.library.store(projectId, input.identity);
          const records = await viewRevisionRecords(store, input.identity.viewId),
            offset = input.offset ?? 0;
          const revisions: rpc.ViewSummary[] = [];
          for (const record of records.slice(offset, offset + 50))
            revisions.push(await this.library.summary(store, record));
          return {
            revisions,
            nextOffset:
              offset + revisions.length < records.length ? offset + revisions.length : null,
          };
        });
      case rpc.waitViewChanges.name:
        return this.handle(rpc.waitViewChanges, value, async (input) =>
          this.observations.wait(
            clientId,
            input.leaseId,
            await this.project(input.scope),
            input.origin,
            input.cursor,
          ),
        );
      case rpc.releaseViewChanges.name:
        return this.handle(rpc.releaseViewChanges, value, async (input) => {
          await this.observations.release(clientId, input.leaseId);
          this.intents.release(clientId, input.leaseId);
          return { released: true as const };
        });
      case rpc.readViewOpenIntent.name:
        return this.handle(rpc.readViewOpenIntent, value, async (input) => {
          const projectId = await this.project(input.scope);
          if ((await this.project(this.workspaceScope(input.workspaceId))) !== projectId)
            throw new ArchitecturalViewError(
              "invalid",
              "This workspace belongs to another project.",
            );
          return this.intents.read(input.workspaceId);
        });
      case rpc.waitViewOpenIntent.name:
        return this.handle(rpc.waitViewOpenIntent, value, async (input) => {
          const projectId = await this.project(input.scope);
          if ((await this.project(this.workspaceScope(input.workspaceId))) !== projectId)
            throw new ArchitecturalViewError(
              "invalid",
              "This workspace belongs to another project.",
            );
          return this.intents.wait(clientId, input.leaseId, input.workspaceId, input.cursor);
        });
    }
  }
  private writeRoute(method: string, value: unknown): Promise<unknown> | undefined {
    switch (method) {
      case rpc.createViewDraft.name:
        return this.change(rpc.createViewDraft, value, (projectId, input) =>
          this.drafts.create(projectId, input),
        );
      case rpc.updateViewDraft.name:
        return this.change(rpc.updateViewDraft, value, (projectId, input) =>
          this.drafts.update(projectId, input),
        );
      case rpc.publishViewDraft.name:
        return this.change(rpc.publishViewDraft, value, (projectId, input) =>
          this.publication.publish(projectId, input),
        );
      case rpc.rebaseViewDraft.name:
        return this.change(rpc.rebaseViewDraft, value, (projectId, input) =>
          this.publication.reviewBase(projectId, input),
        );
      case rpc.discardViewDraft.name:
        return this.change(rpc.discardViewDraft, value, (projectId, input) =>
          this.publication.discard(projectId, input),
        );
      case rpc.removeView.name:
        return this.change(rpc.removeView, value, (projectId, input) =>
          this.publication.remove(projectId, input),
        );
      case rpc.showView.name:
        return this.handle(rpc.showView, value, (input) => this.show(input));
      case rpc.startViewAuthoring.name:
        return this.change(rpc.startViewAuthoring, value, (_project, input) => {
          if (!this.authoring)
            throw new ArchitecturalViewError(
              "unavailable",
              "Authoring is unavailable on this host.",
            );
          return this.authoring.start(input);
        });
      case rpc.detachViewAuthoring.name:
        return this.change(rpc.detachViewAuthoring, value, (projectId, input) =>
          this.drafts.bindAuthor(
            projectId,
            input.identity,
            input.draftId,
            input.expectedRevision,
            null,
          ),
        );
    }
  }
  private change<I extends z.ZodType<{ scope: rpc.ViewScope }>, O extends z.ZodType>(
    contract: PluginRpcContract<I, O>,
    value: unknown,
    action: (projectId: string, input: z.output<I>) => Promise<unknown>,
  ) {
    return this.handle(contract, value, async (input) => {
      const projectId = await this.project(input.scope);
      const result = await action(projectId, input);
      this.notify(projectId);
      return result;
    });
  }
  private async handle<I extends z.ZodType, O extends z.ZodType>(
    contract: PluginRpcContract<I, O>,
    value: unknown,
    action: (input: z.output<I>) => Promise<unknown>,
  ) {
    try {
      if (
        value &&
        typeof value === "object" &&
        "specification" in value &&
        value.specification !== undefined
      ) {
        try {
          rpc.parseViewSpecification(value.specification);
        } catch (cause) {
          throw new ArchitecturalViewError(
            "invalid",
            "The View specification exceeds its contract or structural budget.",
            { cause },
          );
        }
      }
      const input = contract.input.parse(value);
      const result = await action(input);
      if (Buffer.byteLength(JSON.stringify(result)) > 750000)
        throw new ArchitecturalViewError(
          "invalid",
          "View response exceeds the transfer budget. Narrow the selection.",
        );
      try {
        return contract.output.parse({ ok: true, value: result });
      } catch (cause) {
        throw new ArchitecturalViewError(
          "unknown",
          "The View outcome could not be acknowledged. Inspect the saved operation before another write.",
          { cause },
        );
      }
    } catch (error) {
      this.ports.report(error);
      return { ok: false, error: operationError(error) };
    }
  }
  releaseClient(clientId: string) {
    this.intents.releaseClient(clientId);
    return this.observations.releaseClient(clientId);
  }
  async close() {
    this.closed = true;
    const drain = this.writes.close();
    this.intents.close();
    this.content.close();
    await this.observations.close();
    await this.renderer.close();
    await drain;
  }
}
function operationError(error: unknown): z.infer<typeof rpc.ViewError> {
  if (error instanceof ArchitecturalViewError)
    return { code: error.code, message: error.message.slice(0, 4000) };
  if (error instanceof ArtifactError)
    return {
      code: error.code,
      message:
        "The View store could not be read safely. Inspect its original files on the owning host.",
    };
  if (error instanceof KnowledgeConflictError || error instanceof OttoProjectMetadataError)
    return {
      code: "conflict",
      message: "The View or project changed. Read the current revision before another write.",
    };
  if (error instanceof KnowledgeBusyError)
    return {
      code: "busy",
      message:
        "The owning Knowledge store has an active or retained writer lock. Inspect it before recovery.",
    };
  if (error instanceof z.ZodError)
    return {
      code: "invalid",
      message:
        "The View request or saved record did not match its contract. Original files were retained; inspect before another write.",
    };
  return {
    code: "unknown",
    message:
      "The host could not acknowledge this View operation. Inspect the library and operation outcome before another write; do not retry automatically.",
  };
}
