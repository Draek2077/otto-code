import path from "node:path";
import type {
  ViewDraft,
  ViewIdentity,
  ViewSummary,
} from "@getpaseo/plugin/otto/architectural-views";
import { withKnowledgeWrite } from "../project-knowledge/knowledge-files.js";
import { ViewWrites } from "./writes.js";
import { ViewLibrary } from "./library.js";
import { draftObjects, requireDraft, type ViewRendering } from "./drafts.js";
import {
  draftDirectory,
  readDraft,
  readPublished,
  readSpecification,
  recordKind,
  viewDirectory,
  viewPublicationState,
  writeViewObject,
  writeViewPointer,
  type DraftRecord,
  type PublishedRecord,
  type Stored,
  type ViewStore,
} from "./records.js";
import { ArchitecturalViewError, specificationText, viewDigest } from "./specification.js";
import { retainViewRevision } from "./history.js";

interface DraftEdit {
  identity: ViewIdentity;
  draftId: string;
  expectedRevision: string;
}
interface DraftOperation extends DraftEdit {
  operationId: string;
}
function assertBase(draft: DraftRecord, current: Stored<PublishedRecord> | null): void {
  const base = draft.ottoDraft?.base;
  if (!base || base.status !== "reviewed")
    throw new ArchitecturalViewError(
      "conflict",
      "This legacy draft needs an explicit review of the current published base before publication.",
    );
  if ((current?.revision ?? null) !== base.revision)
    throw new ArchitecturalViewError(
      "conflict",
      "The published View changed. Review the current base before publishing this draft.",
    );
}
export class ViewPublication {
  constructor(
    readonly library: ViewLibrary,
    readonly renderer: ViewRendering,
    readonly write: ViewWrites["run"] = withKnowledgeWrite,
  ) {}

  async reviewBase(
    projectId: string,
    input: DraftEdit & { expectedPublishedRevision: string | null },
  ): Promise<ViewDraft> {
    const store = await this.library.store(projectId, input.identity);
    return this.write(store, async () => {
      await this.library.store(projectId, input.identity);
      const current = requireDraft(
        await readDraft(store, input.identity.viewId, input.draftId),
        input.expectedRevision,
      );
      await this.library.activeDraft(store, current);
      const published = await readPublished(store, input.identity.viewId);
      if ((published?.revision ?? null) !== input.expectedPublishedRevision)
        throw new ArchitecturalViewError(
          "conflict",
          "The published base changed during review. Inspect it again.",
        );
      const specification = await readSpecification(store, input.identity.viewId, current);
      const objects = await draftObjects(
        store,
        input.identity.viewId,
        specificationText(recordKind(current.value), specification),
        current.value.receipt ?? {},
      );
      const metadata = current.value.ottoDraft;
      const sources = await this.library.ports.sources(
        projectId,
        current.value.knowledgeReferences,
      );
      const value: DraftRecord = {
        ...current.value,
        baseSpecificationSha256: published?.value.specificationSha256 ?? null,
        updatedAt: new Date().toISOString(),
        ottoDraft: {
          ...metadata,
          ...objects,
          format: 1,
          creationOperationId: metadata?.creationOperationId ?? `legacy-${current.value.id}`,
          creationFingerprint: metadata?.creationFingerprint ?? viewDigest(current.raw),
          base: { status: "reviewed", revision: input.expectedPublishedRevision },
          sourceDigests:
            metadata?.sourceDigests ??
            current.value.knowledgeReferences.map((reference) => ({ reference, sha256: null })),
          state: "draft",
          starter: metadata?.starter ?? false,
          operationId: null,
        },
      };
      const directory = draftDirectory(store, input.identity.viewId, input.draftId);
      const revision = await writeViewPointer(
        store,
        path.join(directory, "draft.json"),
        value,
        current.revision,
      );
      return this.library.draftSummary(
        store,
        { value, revision, raw: JSON.stringify(value), directory },
        sources,
      );
    });
  }
  async publish(projectId: string, input: DraftOperation): Promise<ViewSummary> {
    const store = await this.library.store(projectId, input.identity);
    const existing = await readPublished(store, input.identity.viewId);
    if (existing && this.isOwnPublication(existing, input))
      return this.library.summary(store, existing);
    const draft = requireDraft(
      await readDraft(store, input.identity.viewId, input.draftId),
      input.expectedRevision,
    );
    assertBase(draft.value, existing);
    if (draft.value.ottoDraft?.starter)
      throw new ArchitecturalViewError(
        "invalid",
        "Author or edit the staged starter before publishing a View.",
      );
    const specification = await readSpecification(store, input.identity.viewId, draft);
    const rendered = await this.renderer.render({
      diagramType: recordKind(draft.value),
      specification,
      projectRoot: store.projectRoot,
    });
    const sources = await this.library.ports.sources(projectId, draft.value.knowledgeReferences);
    return this.write(store, async () => {
      await this.library.store(projectId, input.identity);
      const published = await readPublished(store, input.identity.viewId);
      if (published && this.isOwnPublication(published, input))
        return this.library.summary(store, published, sources);
      const current = requireDraft(
        await readDraft(store, input.identity.viewId, input.draftId),
        input.expectedRevision,
      );
      assertBase(current.value, published);
      if (published) await retainViewRevision(store, input.identity.viewId, published);
      const objects = await draftObjects(
        store,
        input.identity.viewId,
        specificationText(recordKind(current.value), specification),
        rendered.receipt,
      );
      const value: PublishedRecord = {
        ...published?.value,
        schemaVersion: 1,
        kind: "architectural-view",
        id: input.identity.viewId,
        title: current.value.title,
        diagramType: recordKind(current.value),
        knowledgeReferences: current.value.knowledgeReferences,
        sourceDigests:
          current.value.ottoDraft?.sourceDigests ??
          current.value.knowledgeReferences.map((reference) => ({ reference, sha256: null })),
        specificationSha256: rendered.specificationSha256,
        renderedAt: new Date().toISOString(),
        ottoPublication: {
          ...objects,
          format: 1,
          operationId: input.operationId,
          draftId: input.draftId,
          draftRevision: input.expectedRevision,
          baseRevision: published?.revision ?? null,
          lifecycle: { state: "published" },
        },
      };
      const directory = viewDirectory(store, input.identity.viewId);
      const revision = await writeViewPointer(
        store,
        path.join(directory, "view.json"),
        value,
        published?.revision ?? null,
      );
      // The publication pointer is the durable outcome. A failed draft marker is an
      // uncertain acknowledgment, never grounds for replaying the publication.
      await this.markDraft(store, current, "published", input.operationId);
      return this.library.summary(
        store,
        { value, revision, directory, raw: JSON.stringify(value) },
        sources,
      );
    });
  }
  private isOwnPublication(record: Stored<PublishedRecord> | null, input: DraftOperation): boolean {
    const publication = record?.value.ottoPublication;
    return (
      !!publication &&
      publication.operationId === input.operationId &&
      publication.draftId === input.draftId &&
      publication.draftRevision === input.expectedRevision &&
      publication.lifecycle.state === "published"
    );
  }
  private async markDraft(
    store: ViewStore,
    current: Stored<DraftRecord>,
    state: "published" | "discarded",
    operationId: string,
  ): Promise<void> {
    if (!current.value.ottoDraft)
      throw new ArchitecturalViewError(
        "conflict",
        "Review this legacy draft before changing its lifecycle.",
      );
    const value = {
      ...current.value,
      updatedAt: new Date().toISOString(),
      ottoDraft: {
        ...current.value.ottoDraft,
        state,
        operationId,
        operationBaseRevision: current.revision,
      },
    };
    await writeViewPointer(
      store,
      path.join(current.directory, "draft.json"),
      value,
      current.revision,
    );
  }
  async discard(projectId: string, input: DraftOperation): Promise<{ discarded: true }> {
    const store = await this.library.store(projectId, input.identity);
    return this.write(store, async () => {
      await this.library.store(projectId, input.identity);
      const existing = await readDraft(store, input.identity.viewId, input.draftId);
      if (
        existing?.value.ottoDraft?.state === "discarded" &&
        existing.value.ottoDraft.operationId === input.operationId &&
        existing.value.ottoDraft.operationBaseRevision === input.expectedRevision
      )
        return { discarded: true };
      const current = requireDraft(existing, input.expectedRevision);
      await this.library.activeDraft(store, current);
      if (!current.value.ottoDraft)
        throw new ArchitecturalViewError(
          "conflict",
          "Review this legacy draft before discarding it.",
        );
      await this.markDraft(store, current, "discarded", input.operationId);
      return { discarded: true };
    });
  }
  async remove(
    projectId: string,
    input: { identity: ViewIdentity; expectedRevision: string; operationId: string },
  ): Promise<{ removed: true }> {
    const store = await this.library.store(projectId, input.identity);
    return this.write(store, async () => {
      await this.library.store(projectId, input.identity);
      const current = await readPublished(store, input.identity.viewId);
      const lifecycle = current?.value.ottoPublication?.lifecycle;
      if (
        lifecycle?.state === "removed" &&
        lifecycle.operationId === input.operationId &&
        lifecycle.baseRevision === input.expectedRevision
      )
        return { removed: true };
      if (
        !current ||
        current.revision !== input.expectedRevision ||
        viewPublicationState(current.value) !== "published"
      )
        throw new ArchitecturalViewError(
          "conflict",
          "The published View changed. Inspect it before removing it.",
        );
      await retainViewRevision(store, input.identity.viewId, current);
      const publication = await this.publicationPointers(store, input.identity.viewId, current);
      const value: PublishedRecord = {
        ...current.value,
        ottoPublication: {
          ...publication,
          lifecycle: {
            state: "removed",
            operationId: input.operationId,
            baseRevision: current.revision,
            removedAt: new Date().toISOString(),
          },
        },
      };
      await writeViewPointer(
        store,
        path.join(current.directory, "view.json"),
        value,
        current.revision,
      );
      return { removed: true };
    });
  }
  private async publicationPointers(
    store: ViewStore,
    viewId: string,
    current: Stored<PublishedRecord>,
  ): Promise<NonNullable<PublishedRecord["ottoPublication"]>> {
    if (current.value.ottoPublication) return current.value.ottoPublication;
    // COMPAT(otto09ViewRemoval): added v0.10.0; remove after 2027-05-09 following explicit legacy conversion.
    const specification = await readSpecification(store, viewId, current);
    return {
      format: 1,
      specification: await writeViewObject(
        store,
        viewId,
        specificationText(recordKind(current.value), specification),
      ),
      receipt: await writeViewObject(store, viewId, "{}"),
      operationId: "legacy-publication",
      draftId: viewId,
      draftRevision: current.revision,
      baseRevision: null,
      lifecycle: { state: "published" },
    };
  }
}
