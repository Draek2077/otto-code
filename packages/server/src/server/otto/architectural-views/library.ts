import path from "node:path";
import { ZodError } from "zod";
import type {
  ViewCatalog,
  ViewDocument,
  ViewDraft,
  ViewIdentity,
  ViewReference,
  ViewSelection,
  ViewSummary,
} from "@getpaseo/plugin/otto/architectural-views";
import {
  readDraft,
  readPublished,
  readSpecification,
  recordKind,
  safeViewId,
  viewDirectories,
  viewPublicationState,
  type SourceDigest,
  type Stored,
  type DraftRecord,
  type PublishedRecord,
  type ViewStore,
} from "./records.js";
import { ArtifactError } from "../artifacts/files.js";
import { ArchitecturalViewError } from "./specification.js";
import { viewSourceStatus } from "./sources.js";
import { findViewRevision } from "./history.js";

export interface ViewProjectStores {
  selected: ViewStore;
  stores: ViewStore[];
}
export interface ViewLibraryPorts {
  resolve(projectId: string): Promise<ViewProjectStores>;
  sources(projectId: string, references: ViewReference[]): Promise<SourceDigest[]>;
}
export type SelectedView =
  | { kind: "published" | "revision"; store: ViewStore; record: Stored<PublishedRecord> }
  | { kind: "draft"; store: ViewStore; record: Stored<DraftRecord> };
type CatalogRecord =
  | { kind: "published"; store: ViewStore; record: Stored<PublishedRecord> }
  | { kind: "draft"; store: ViewStore; record: Stored<DraftRecord> };
class ViewLibraryBudgetError extends ArchitecturalViewError {
  constructor() {
    super(
      "invalid",
      "The View library exceeds its inspection budget. Original files were retained.",
    );
  }
}
const fileFailures = new Set(["ENOENT", "EACCES", "EPERM", "EBUSY"]);
function discoveryFailure(error: unknown): boolean {
  if (error instanceof ViewLibraryBudgetError) return false;
  if (error instanceof ArchitecturalViewError) return error.code !== "busy";
  if (error instanceof ArtifactError || error instanceof ZodError || error instanceof SyntaxError)
    return true;
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    fileFailures.has(error.code)
  );
}
function matchesReference(entry: CatalogRecord, reference: ViewReference | undefined): boolean {
  return (
    !reference ||
    entry.record.value.knowledgeReferences.some(
      (ref) => ref.kind === reference.kind && ref.id === reference.id,
    )
  );
}
function compareRecords(a: CatalogRecord, b: CatalogRecord): number {
  const left = a.kind === "draft" ? a.record.value.updatedAt : a.record.value.renderedAt;
  const right = b.kind === "draft" ? b.record.value.updatedAt : b.record.value.renderedAt;
  return (
    right.localeCompare(left) || a.store.origin.storeKey.localeCompare(b.store.origin.storeKey)
  );
}

export class ViewLibrary {
  constructor(readonly ports: ViewLibraryPorts) {}

  async store(projectId: string, identity: ViewIdentity): Promise<ViewStore> {
    const project = await this.ports.resolve(projectId);
    const store = project.stores.find(
      (candidate) =>
        candidate.origin.storeKey === identity.origin.storeKey &&
        candidate.location === identity.origin.location,
    );
    if (!store)
      throw new ArchitecturalViewError(
        "conflict",
        "This View's original store is no longer bound to the selected project. Inspect its storage settings.",
      );
    return store;
  }
  async selected(
    projectId: string,
    identity: ViewIdentity,
    selection: ViewSelection,
  ): Promise<SelectedView> {
    safeViewId(identity.viewId);
    const store = await this.store(projectId, identity);
    if (selection.kind === "draft") {
      const record = await readDraft(store, identity.viewId, selection.draftId);
      if (
        !record ||
        (record.value.ottoDraft && record.value.ottoDraft.state !== "draft") ||
        (await this.consumed(store, record))
      )
        throw new ArchitecturalViewError(
          "not_found",
          "This View draft is no longer active. Read the library before another action.",
        );
      return { kind: "draft", store, record };
    }
    const record =
      selection.kind === "revision"
        ? await findViewRevision(store, identity.viewId, selection.revisionId)
        : await readPublished(store, identity.viewId);
    if (!record)
      throw new ArchitecturalViewError("not_found", "This published View is unavailable.");
    return { kind: selection.kind, store, record };
  }
  async consumed(store: ViewStore, draft: Stored<DraftRecord>): Promise<boolean> {
    const publication = (await readPublished(store, draft.value.viewId))?.value.ottoPublication;
    return publication?.draftId === draft.value.id && publication.draftRevision === draft.revision;
  }
  async activeDraft(store: ViewStore, draft: Stored<DraftRecord>): Promise<void> {
    if (await this.consumed(store, draft))
      throw new ArchitecturalViewError(
        "conflict",
        "This draft was already published. Inspect the publication outcome.",
      );
  }
  async summary(
    store: ViewStore,
    record: Stored<PublishedRecord>,
    sources?: SourceDigest[],
  ): Promise<ViewSummary> {
    const actual =
      sources ?? (await this.ports.sources(store.projectId, record.value.knowledgeReferences));
    return {
      viewId: record.value.id,
      title: record.value.title,
      diagramType: recordKind(record.value),
      origin: store.origin,
      revision: record.revision,
      knowledgeReferences: record.value.knowledgeReferences,
      renderedAt: record.value.renderedAt,
      sourceStatus: viewSourceStatus(record.value.sourceDigests, actual),
      state: viewPublicationState(record.value),
    };
  }
  async draftSummary(
    store: ViewStore,
    record: Stored<DraftRecord>,
    sources?: SourceDigest[],
  ): Promise<ViewDraft> {
    const value = record.value;
    const actual =
      sources ?? (await this.ports.sources(store.projectId, value.knowledgeReferences));
    return {
      viewId: value.viewId,
      title: value.title,
      diagramType: recordKind(value),
      origin: store.origin,
      revision: record.revision,
      knowledgeReferences: value.knowledgeReferences,
      sourceStatus: viewSourceStatus(value.ottoDraft?.sourceDigests, actual),
      draftId: value.id,
      // COMPAT(otto09DraftBase): added v0.10.0; remove after 2027-05-09 following explicit legacy base review.
      base: value.ottoDraft?.base ?? {
        status: "review_required",
        legacySpecificationSha256: value.baseSpecificationSha256,
      },
      authoringAgentId: value.authoringAgentId ?? null,
      // COMPAT(otto09ViewAuthoringWorkspace): added v0.10.0; remove after 2027-05-09 following explicit rebinding. Never infer a legacy chat's workspace.
      authoringWorkspaceId: value.authoringWorkspaceId ?? null,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      starter: value.ottoDraft?.starter ?? false,
    };
  }
  async read(
    projectId: string,
    identity: ViewIdentity,
    selection: ViewSelection,
  ): Promise<ViewDocument> {
    const selected = await this.selected(projectId, identity, selection);
    const specification = await readSpecification(selected.store, identity.viewId, selected.record);
    if (selected.kind === "draft")
      return {
        kind: "draft",
        draft: await this.draftSummary(selected.store, selected.record),
        specification,
      };
    return {
      kind: selected.kind,
      view: await this.summary(selected.store, selected.record),
      specification,
    };
  }
  private async records(project: ViewProjectStores) {
    const records: CatalogRecord[] = [];
    const diagnostics: ViewCatalog["diagnostics"] = [];
    let diagnosticsOmitted = 0;
    let bytes = 0;
    const keep = (entry: CatalogRecord) => {
      bytes += Buffer.byteLength(entry.record.raw);
      if (records.length >= 2000 || bytes > 16777216) throw new ViewLibraryBudgetError();
      records.push(entry);
    };
    for (const store of project.stores) {
      const root = path.join(store.base, "architectural-views");
      for (const viewId of await viewDirectories(store, root, 1000)) {
        try {
          await this.collectView(store, viewId, keep);
        } catch (cause) {
          if (!discoveryFailure(cause)) throw cause;
          if (diagnostics.length < 100)
            diagnostics.push({
              origin: store.origin,
              viewId: viewId.slice(0, 120),
              message: "The saved View could not be inspected. Its original files were retained.",
            });
          else diagnosticsOmitted++;
        }
      }
    }
    return { records, diagnostics, diagnosticsOmitted };
  }
  private async collectView(
    store: ViewStore,
    viewId: string,
    keep: (entry: CatalogRecord) => void,
  ) {
    safeViewId(viewId);
    const published = await readPublished(store, viewId);
    if (published && viewPublicationState(published.value) === "published")
      keep({ kind: "published", store, record: published });
    const root = path.join(store.base, "architectural-views", viewId, "drafts");
    for (const draftId of await viewDirectories(store, root, 100)) {
      const draft = await readDraft(store, viewId, draftId);
      if (!draft) continue;
      if (draft.value.ottoDraft && draft.value.ottoDraft.state !== "draft") continue;
      if (
        published?.value.ottoPublication?.draftId === draftId &&
        published.value.ottoPublication.draftRevision === draft.revision
      )
        continue;
      keep({ kind: "draft", store, record: draft });
    }
  }
  async catalog(
    projectId: string,
    reference?: ViewReference,
    offset = 0,
    query = "",
  ): Promise<ViewCatalog> {
    const project = await this.ports.resolve(projectId);
    const collected = await this.records(project);
    const matching = collected.records.filter(
      (entry) =>
        matchesReference(entry, reference) &&
        `${entry.record.value.title} ${recordKind(entry.record.value)} ${entry.store.origin.location}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    matching.sort(compareRecords);
    const page = matching.slice(offset, offset + 100);
    const views: ViewSummary[] = [];
    const drafts: ViewDraft[] = [];
    const references = new Map<string, ViewReference>();
    for (const entry of page)
      for (const linked of entry.record.value.knowledgeReferences)
        references.set(JSON.stringify(linked), linked);
    const sources = await this.ports.sources(projectId, [...references.values()]);
    for (const entry of page) {
      if (entry.kind === "draft")
        drafts.push(await this.draftSummary(entry.store, entry.record, sources));
      else views.push(await this.summary(entry.store, entry.record, sources));
    }
    return {
      projectId,
      views,
      drafts,
      diagnostics: collected.diagnostics,
      diagnosticsOmitted: collected.diagnosticsOmitted,
      origins: project.stores.map((store) => store.origin),
      nextOffset: offset + page.length < matching.length ? offset + page.length : null,
    };
  }
}
