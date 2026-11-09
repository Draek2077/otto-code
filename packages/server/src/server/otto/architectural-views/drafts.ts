import path from "node:path";
import type { z } from "zod";
import type {
  createViewDraft,
  ViewDraft,
  ViewIdentity,
  ViewSpecification,
} from "@getpaseo/plugin/otto/architectural-views";
import { withKnowledgeWrite } from "../project-knowledge/knowledge-files.js";
import { ViewWrites } from "./writes.js";
import { ViewLibrary } from "./library.js";
import { ArchitecturalViewError, specificationText, viewDigest } from "./specification.js";
import { viewStarter } from "./starter.js";
import {
  draftDirectory,
  readDraft,
  readPublished,
  readSpecification,
  recordKind,
  safeViewId,
  writeViewObject,
  writeViewPointer,
  type DraftRecord,
  type SourceDigest,
  type Stored,
  type ViewStore,
} from "./records.js";
import type { ViewRenderInput, ViewRenderOutput } from "./renderer.js";

type CreateInput = z.infer<typeof createViewDraft.input>;
export interface ViewRendering {
  render(input: ViewRenderInput): Promise<ViewRenderOutput>;
}
export function requireDraft(
  record: Stored<DraftRecord> | null,
  expectedRevision: string,
): Stored<DraftRecord> {
  if (!record || record.revision !== expectedRevision)
    throw new ArchitecturalViewError(
      "conflict",
      "The View draft changed. Inspect it before another save.",
    );
  if (record.value.ottoDraft && record.value.ottoDraft.state !== "draft")
    throw new ArchitecturalViewError(
      "conflict",
      "This draft is no longer active. Inspect its publication or discard outcome.",
    );
  return record;
}
export async function draftObjects(
  store: ViewStore,
  viewId: string,
  specification: string,
  receipt: unknown,
) {
  return {
    specification: await writeViewObject(store, viewId, specification),
    receipt: await writeViewObject(store, viewId, JSON.stringify(receipt)),
  };
}
export class ViewDrafts {
  constructor(
    readonly library: ViewLibrary,
    readonly renderer: ViewRendering,
    readonly write: ViewWrites["run"] = withKnowledgeWrite,
    readonly rendered?: (projectId: string, draft: ViewDraft, html: string) => void,
  ) {}

  private async creation(projectId: string, input: CreateInput) {
    safeViewId(input.viewId);
    safeViewId(input.draftId);
    const store = input.published
      ? await this.library.store(projectId, input.published)
      : (await this.library.ports.resolve(projectId)).selected;
    if (input.published && input.published.viewId !== input.viewId)
      throw new ArchitecturalViewError("invalid", "The selected View does not match this draft.");
    const title = input.title.trim();
    if (!title) throw new ArchitecturalViewError("invalid", "Give the View a title.");
    const current = await readPublished(store, input.viewId);
    const baseRevision = input.published?.revision ?? null;
    if ((current?.revision ?? null) !== baseRevision)
      throw new ArchitecturalViewError(
        "conflict",
        "The published View changed. Read its current revision before creating a draft.",
      );
    if (current && recordKind(current.value) !== input.diagramType)
      throw new ArchitecturalViewError(
        "invalid",
        "A View's diagram kind cannot change during an update.",
      );
    const specification =
      input.specification ??
      (current
        ? await readSpecification(store, input.viewId, current)
        : viewStarter(input.diagramType, title));
    const text = specificationText(input.diagramType, specification);
    const fingerprint = viewDigest(
      JSON.stringify({
        title,
        diagramType: input.diagramType,
        references: input.knowledgeReferences,
        baseRevision,
        text,
      }),
    );
    return {
      store,
      title,
      current,
      baseRevision,
      specification,
      text,
      fingerprint,
      starter: !input.specification && !current,
    };
  }
  private async existing(
    store: ViewStore,
    input: CreateInput,
    fingerprint: string,
  ): Promise<Stored<DraftRecord> | null> {
    const previous = await readDraft(store, input.viewId, input.draftId);
    if (!previous) return null;
    const metadata = previous.value.ottoDraft;
    if (
      !metadata ||
      metadata.creationOperationId !== input.operationId ||
      metadata.creationFingerprint !== fingerprint ||
      metadata.state !== "draft"
    )
      throw new ArchitecturalViewError(
        "conflict",
        "That draft identity already has a different outcome. Inspect it instead of recreating it.",
      );
    return previous;
  }
  async create(projectId: string, input: CreateInput): Promise<ViewDraft> {
    const prepared = await this.creation(projectId, input);
    const previous = await this.existing(prepared.store, input, prepared.fingerprint);
    if (previous) return this.library.draftSummary(prepared.store, previous);
    const sources = await this.library.ports.sources(projectId, input.knowledgeReferences);
    const rendered = await this.renderer.render({
      diagramType: input.diagramType,
      specification: prepared.specification,
      projectRoot: prepared.store.projectRoot,
    });
    const result = await this.write(prepared.store, async () => {
      const current = await this.creation(projectId, input);
      if (
        current.store.origin.storeKey !== prepared.store.origin.storeKey ||
        current.fingerprint !== prepared.fingerprint
      )
        throw new ArchitecturalViewError(
          "conflict",
          "The View's owning store or base changed while rendering.",
        );
      const existing = await this.existing(current.store, input, current.fingerprint);
      if (existing) return this.library.draftSummary(current.store, existing, sources);
      const objects = await draftObjects(
        current.store,
        input.viewId,
        current.text,
        rendered.receipt,
      );
      const now = new Date().toISOString();
      const value: DraftRecord = {
        schemaVersion: 1,
        kind: "architectural-view-draft",
        id: input.draftId,
        viewId: input.viewId,
        title: current.title,
        diagramType: input.diagramType,
        knowledgeReferences: input.knowledgeReferences,
        baseSpecificationSha256: current.current?.value.specificationSha256 ?? null,
        specificationSha256: rendered.specificationSha256,
        authoringAgentId: null,
        createdAt: now,
        updatedAt: now,
        ottoDraft: {
          ...objects,
          format: 1,
          creationOperationId: input.operationId,
          creationFingerprint: current.fingerprint,
          base: { status: "reviewed", revision: current.baseRevision },
          sourceDigests: sources,
          state: "draft",
          starter: current.starter,
          operationId: null,
        },
      };
      return this.persist(current.store, value, null, sources);
    });
    this.rendered?.(projectId, result, rendered.html);
    return result;
  }
  private async persist(
    store: ViewStore,
    value: DraftRecord,
    expected: string | null,
    sources: SourceDigest[],
  ): Promise<ViewDraft> {
    const directory = draftDirectory(store, value.viewId, value.id);
    const revision = await writeViewPointer(
      store,
      path.join(directory, "draft.json"),
      value,
      expected,
    );
    return this.library.draftSummary(
      store,
      { value, revision, directory, raw: JSON.stringify(value) },
      sources,
    );
  }
  async update(
    projectId: string,
    input: {
      identity: ViewIdentity;
      draftId: string;
      expectedRevision: string;
      specification: ViewSpecification;
      title?: string;
    },
  ): Promise<ViewDraft> {
    const store = await this.library.store(projectId, input.identity);
    const previous = requireDraft(
      await readDraft(store, input.identity.viewId, input.draftId),
      input.expectedRevision,
    );
    const text = specificationText(recordKind(previous.value), input.specification);
    const sources = await this.library.ports.sources(projectId, previous.value.knowledgeReferences);
    const rendered = await this.renderer.render({
      diagramType: recordKind(previous.value),
      specification: input.specification,
      projectRoot: store.projectRoot,
    });
    const result = await this.write(store, async () => {
      await this.library.store(projectId, input.identity);
      const current = requireDraft(
        await readDraft(store, input.identity.viewId, input.draftId),
        input.expectedRevision,
      );
      await this.library.activeDraft(store, current);
      const title = input.title?.trim() ?? current.value.title;
      if (!title) throw new ArchitecturalViewError("invalid", "Give the View a title.");
      const objects = await draftObjects(store, input.identity.viewId, text, rendered.receipt);
      const metadata = current.value.ottoDraft;
      return this.persist(
        store,
        {
          ...current.value,
          title,
          specificationSha256: rendered.specificationSha256,
          updatedAt: new Date().toISOString(),
          ottoDraft: {
            ...objects,
            format: 1,
            creationOperationId: metadata?.creationOperationId ?? `legacy-${current.value.id}`,
            creationFingerprint: metadata?.creationFingerprint ?? viewDigest(current.raw),
            base: metadata?.base ?? {
              status: "review_required",
              legacySpecificationSha256: current.value.baseSpecificationSha256,
            },
            sourceDigests: sources,
            state: "draft",
            starter: false,
            operationId: null,
          },
        },
        current.revision,
        sources,
      );
    });
    this.rendered?.(projectId, result, rendered.html);
    return result;
  }
  async bindAuthor(
    projectId: string,
    identity: ViewIdentity,
    draftId: string,
    expectedRevision: string,
    agentId: string | null,
    workspaceId: string | null = null,
  ): Promise<ViewDraft> {
    const store = await this.library.store(projectId, identity);
    return this.write(store, async () => {
      await this.library.store(projectId, identity);
      const current = requireDraft(
        await readDraft(store, identity.viewId, draftId),
        expectedRevision,
      );
      await this.library.activeDraft(store, current);
      if (agentId && current.value.authoringAgentId && current.value.authoringAgentId !== agentId)
        throw new ArchitecturalViewError(
          "conflict",
          "This draft is already bound to another authoring chat.",
        );
      const sources = await this.library.ports.sources(
        projectId,
        current.value.knowledgeReferences,
      );
      return this.persist(
        store,
        {
          ...current.value,
          authoringAgentId: agentId,
          authoringWorkspaceId: agentId ? workspaceId : null,
        },
        current.revision,
        sources,
      );
    });
  }
}
