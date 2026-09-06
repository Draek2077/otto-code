import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { writeJsonFileAtomic } from "../atomic-file.js";
import type { ArchitecturalViewDiagramType } from "@otto-code/protocol/architectural-views/rpc-schemas";
import type { ProjectKnowledgeStore } from "../agent/project-knowledge/project-knowledge-store.js";
import { ArchifyRenderer, type ArchifyQualityProfile } from "../archify/archify-renderer.js";
import { validateHtmlFile } from "../artifact/html-validator.js";

export interface ArchitecturalViewKnowledgeReference {
  kind: "root" | "record";
  id: string;
}

export interface DeliverArchitecturalViewInput {
  cwd: string;
  viewId: string;
  title: string;
  knowledgeReferences: ArchitecturalViewKnowledgeReference[];
  sourcePath: string;
  diagramType?: ArchitecturalViewDiagramType;
  quality?: ArchifyQualityProfile;
}

export interface DeliveredArchitecturalView {
  viewId: string;
  storeLocation: ProjectKnowledgeStore["location"];
  /**
   * COMPAT(architecturalViewHtmlPath): retained wire field name until the
   * protocol floor can rename it. It identifies the durable view source.
   */
  htmlPath: string;
}

export interface ArchitecturalViewSummary {
  id: string;
  title: string;
  knowledgeReferences: ArchitecturalViewKnowledgeReference[];
  storeLocation: ProjectKnowledgeStore["location"];
  /**
   * COMPAT(architecturalViewHtmlPath): retained wire field name until the
   * protocol floor can rename it. It identifies the durable view source.
   */
  htmlPath: string;
  renderedAt: string;
  diagramType: ArchitecturalViewDiagramType;
  /** Whether the cited Knowledge pages still match their delivery provenance. */
  sourceStatus: "current" | "stale" | "unknown";
}

export interface ArchitecturalViewContent {
  view: ArchitecturalViewSummary;
  html: string;
}

export interface ArchitecturalViewDraft {
  id: string;
  viewId: string;
  title: string;
  knowledgeReferences: ArchitecturalViewKnowledgeReference[];
  baseSpecificationSha256: string | null;
  diagramType: ArchitecturalViewDiagramType;
  authoringAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArchitecturalViewDraftContent {
  draft: ArchitecturalViewDraft;
  html: string;
}

interface ArchitecturalViewManifest {
  schemaVersion: 1;
  kind: "architectural-view";
  id: string;
  title: string;
  knowledgeReferences: ArchitecturalViewKnowledgeReference[];
  /** Optional so pre-provenance views remain readable and report unknown. */
  sourceDigests?: ArchitecturalViewSourceDigest[];
  specificationSha256: string;
  renderedAt: string;
  /** Optional while Architecture-only manifests remain readable. */
  diagramType?: ArchitecturalViewDiagramType;
}

interface ArchitecturalViewSourceDigest {
  reference: ArchitecturalViewKnowledgeReference;
  sha256: string | null;
}

interface ArchitecturalViewDraftManifest extends ArchitecturalViewDraft {
  schemaVersion: 1;
  kind: "architectural-view-draft";
  specificationSha256: string;
  receipt: Record<string, unknown>;
}

export interface ArchitecturalViewsServiceOptions {
  resolveStore: (cwd: string) => Promise<ProjectKnowledgeStore>;
  renderer?: ArchifyRenderer;
}

/**
 * Stores one Interactive View beside the project Knowledge it explains.
 * Repository and host stores therefore preserve the same layout and lifecycle.
 */
export class ArchitecturalViewsService {
  private readonly resolveStore: ArchitecturalViewsServiceOptions["resolveStore"];
  private readonly renderer: ArchifyRenderer;
  private readonly renderedHtmlCache = new Map<string, string>();

  constructor(options: ArchitecturalViewsServiceOptions) {
    this.resolveStore = options.resolveStore;
    this.renderer = options.renderer ?? new ArchifyRenderer();
  }

  async deliver(input: DeliverArchitecturalViewInput): Promise<DeliveredArchitecturalView> {
    assertViewId(input.viewId);
    const diagramType = input.diagramType ?? "architecture";
    const store = await this.resolveStore(input.cwd);
    const directory = join(store.base, "architectural-views", input.viewId);
    const specificationPath = join(directory, specificationFilename(diagramType));
    const htmlPath = join(directory, renderedHtmlFilename(diagramType));
    const manifestPath = join(directory, "view.json");
    const receiptPath = join(directory, "receipt.json");
    if (!isAbsolute(input.sourcePath)) {
      throw new Error("Interactive View source paths must be absolute.");
    }
    const sourcePath = resolve(input.sourcePath);
    const sourceText = await readFile(sourcePath, "utf8");
    let specification: unknown;
    try {
      specification = JSON.parse(sourceText) as unknown;
    } catch {
      throw new Error("Interactive View source must contain valid JSON.");
    }
    assertSpecificationDiagramType(specification, diagramType);
    await mkdir(directory, { recursive: true });
    await writeJsonFileAtomic(specificationPath, specification);
    const specificationSha256 = specificationHash(specification);
    const rendered = await this.renderSpecification({
      specificationPath,
      specificationSha256,
      diagramType,
      quality: input.quality,
    });
    const manifest: ArchitecturalViewManifest = {
      schemaVersion: 1,
      kind: "architectural-view",
      id: input.viewId,
      title: input.title,
      knowledgeReferences: input.knowledgeReferences,
      sourceDigests: await this.captureSourceDigests(store, input.knowledgeReferences),
      specificationSha256,
      renderedAt: new Date().toISOString(),
      diagramType,
    };
    await Promise.all([
      writeJsonFileAtomic(manifestPath, manifest),
      writeJsonFileAtomic(receiptPath, rendered.receipt),
    ]);
    // Pre-compact views carried a full standalone Archify runtime per
    // document. The specification is now the durable source; runtime HTML
    // is rendered into the daemon cache only when someone opens the view.
    await rm(htmlPath, { force: true });

    return {
      viewId: input.viewId,
      storeLocation: store.location,
      htmlPath: relative(store.pathBase, specificationPath).split("\\").join("/"),
    };
  }

  async list(
    cwd: string,
    knowledgeReference?: ArchitecturalViewKnowledgeReference,
  ): Promise<ArchitecturalViewSummary[]> {
    const store = await this.resolveStore(cwd);
    const viewsRoot = join(store.base, "architectural-views");
    const entries = await readdir(viewsRoot, { withFileTypes: true }).catch((error: unknown) => {
      if (isMissingPath(error)) return null;
      throw error;
    });
    if (!entries) return [];
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readSummary(store, entry.name)),
    );
    return summaries
      .filter((summary): summary is ArchitecturalViewSummary => summary !== null)
      .filter(
        (summary) =>
          !knowledgeReference ||
          summary.knowledgeReferences.some(
            (reference) =>
              reference.kind === knowledgeReference.kind && reference.id === knowledgeReference.id,
          ),
      )
      .sort((left, right) => right.renderedAt.localeCompare(left.renderedAt));
  }

  async getContent(cwd: string, viewId: string): Promise<ArchitecturalViewContent | null> {
    assertViewId(viewId);
    const store = await this.resolveStore(cwd);
    const manifest = await this.readManifest(store, viewId);
    if (!manifest) return null;
    const view = await this.summaryFromManifest(store, manifest);
    const html = await this.getRenderedHtml({
      specificationPath: join(
        store.base,
        "architectural-views",
        viewId,
        specificationFilename(view.diagramType),
      ),
      specificationSha256: manifest.specificationSha256,
      diagramType: view.diagramType,
    });
    return { view, html };
  }

  /**
   * Forks a published document, or creates a first draft from caller-owned
   * JSON. Draft output never mutates the reader's current published files.
   */
  async createDraft(input: {
    cwd: string;
    viewId: string;
    draftId: string;
    title: string;
    knowledgeReferences: ArchitecturalViewKnowledgeReference[];
    sourcePath?: string;
    diagramType?: ArchitecturalViewDiagramType;
    quality?: ArchifyQualityProfile;
  }): Promise<ArchitecturalViewDraft> {
    assertViewId(input.viewId);
    assertDraftId(input.draftId);
    const store = await this.resolveStore(input.cwd);
    const existingDraft = (await this.readDraftsForView(store, input.viewId))[0] ?? null;
    if (existingDraft) {
      return existingDraft;
    }
    const current = await this.readManifest(store, input.viewId);
    const diagramType = input.diagramType ?? diagramTypeForManifest(current);
    const sourcePath = input.sourcePath
      ? resolveDraftSourcePath(input.sourcePath)
      : join(store.base, "architectural-views", input.viewId, specificationFilename(diagramType));
    const title = current?.title ?? input.title;
    const knowledgeReferences = current?.knowledgeReferences ?? input.knowledgeReferences;
    if (!title.trim() || knowledgeReferences.length === 0) {
      throw new Error("Interactive Views need a title and at least one Knowledge link.");
    }
    const specification =
      input.sourcePath || current
        ? await readJsonSpecification(sourcePath)
        : starterSpecification(diagramType, title);
    assertSpecificationDiagramType(specification, diagramType);
    const directory = draftDirectory(store, input.viewId, input.draftId);
    const now = new Date().toISOString();
    const draft = await this.renderDraft({
      directory,
      draft: {
        id: input.draftId,
        viewId: input.viewId,
        title,
        knowledgeReferences,
        baseSpecificationSha256: current?.specificationSha256 ?? null,
        diagramType,
        authoringAgentId: null,
        createdAt: now,
        updatedAt: now,
      },
      specification,
      quality: input.quality,
    });
    return draft;
  }

  /** A failed render leaves the draft's existing durable JSON intact. */
  async updateDraft(input: {
    cwd: string;
    viewId: string;
    draftId: string;
    sourcePath: string;
    quality?: ArchifyQualityProfile;
  }): Promise<ArchitecturalViewDraft> {
    assertViewId(input.viewId);
    assertDraftId(input.draftId);
    const store = await this.resolveStore(input.cwd);
    const existing = await this.readDraft(store, input.viewId, input.draftId);
    if (!existing) throw new Error("Interactive View not found.");
    const specification = await readJsonSpecification(resolveDraftSourcePath(input.sourcePath));
    assertSpecificationDiagramType(specification, existing.diagramType);
    return this.renderDraft({
      directory: draftDirectory(store, input.viewId, input.draftId),
      draft: { ...existing, updatedAt: new Date().toISOString() },
      specification,
      quality: input.quality,
    });
  }

  /** Re-render a caller-supplied typed specification without a workspace file hop. */
  async updateDraftSpecification(input: {
    cwd: string;
    viewId: string;
    draftId: string;
    specification: unknown;
    quality?: ArchifyQualityProfile;
  }): Promise<ArchitecturalViewDraft> {
    assertViewId(input.viewId);
    assertDraftId(input.draftId);
    const store = await this.resolveStore(input.cwd);
    const existing = await this.readDraft(store, input.viewId, input.draftId);
    if (!existing) throw new Error("Interactive View not found.");
    assertSpecificationDiagramType(input.specification, existing.diagramType);
    return this.renderDraft({
      directory: draftDirectory(store, input.viewId, input.draftId),
      draft: { ...existing, updatedAt: new Date().toISOString() },
      specification: input.specification,
      quality: input.quality,
    });
  }

  async getDraftSpecification(input: {
    cwd: string;
    viewId: string;
    draftId: string;
  }): Promise<{ draft: ArchitecturalViewDraft; specification: unknown } | null> {
    assertViewId(input.viewId);
    assertDraftId(input.draftId);
    const store = await this.resolveStore(input.cwd);
    const draft = await this.readDraft(store, input.viewId, input.draftId);
    if (!draft) return null;
    return {
      draft,
      specification: await readJsonSpecification(
        join(
          draftDirectory(store, input.viewId, input.draftId),
          specificationFilename(draft.diagramType),
        ),
      ),
    };
  }

  async getDraftContent(
    cwd: string,
    viewId: string,
    draftId: string,
  ): Promise<ArchitecturalViewDraftContent | null> {
    assertViewId(viewId);
    assertDraftId(draftId);
    const store = await this.resolveStore(cwd);
    const draft = await this.readDraft(store, viewId, draftId);
    if (!draft) return null;
    const specificationPath = join(
      draftDirectory(store, viewId, draftId),
      specificationFilename(draft.diagramType),
    );
    const specification = await readJsonSpecification(specificationPath);
    const html = await this.getRenderedHtml({
      specificationPath,
      specificationSha256: specificationHash(specification),
      diagramType: draft.diagramType,
    });
    return { draft, html };
  }

  /** Lists durable staged work so a Knowledge article can offer Resume after a restart. */
  async listDrafts(
    cwd: string,
    knowledgeReference?: ArchitecturalViewKnowledgeReference,
  ): Promise<ArchitecturalViewDraft[]> {
    const store = await this.resolveStore(cwd);
    const viewsRoot = join(store.base, "architectural-views");
    const viewEntries = await readdir(viewsRoot, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (isMissingPath(error)) return [];
        throw error;
      },
    );
    const drafts = await Promise.all(
      viewEntries
        .filter((entry) => entry.isDirectory() && isArchitecturalViewId(entry.name))
        .map((entry) => this.readDraftsForView(store, entry.name)),
    );
    return drafts
      .flat()
      .filter(
        (draft) =>
          !knowledgeReference ||
          draft.knowledgeReferences.some(
            (reference) =>
              reference.kind === knowledgeReference.kind && reference.id === knowledgeReference.id,
          ),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /** Bind a normal provider-neutral chat to this durable staged document. */
  async bindDraftAuthoringAgent(input: {
    cwd: string;
    viewId: string;
    draftId: string;
    agentId: string;
  }): Promise<ArchitecturalViewDraft> {
    assertViewId(input.viewId);
    assertDraftId(input.draftId);
    if (!input.agentId.trim()) throw new Error("Interactive View authoring chat id is required.");
    const store = await this.resolveStore(input.cwd);
    const draft = await this.readDraft(store, input.viewId, input.draftId);
    if (!draft) throw new Error("Interactive View not found.");
    // Create and Update each begin a new chat. A stored id is provenance for
    // cleanup, never a resume key, so the latest authoring chat takes ownership.
    const updated = {
      ...draft,
      authoringAgentId: input.agentId,
      updatedAt: new Date().toISOString(),
    };
    const manifestPath = join(draftDirectory(store, input.viewId, input.draftId), "draft.json");
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as ArchitecturalViewDraftManifest;
    await writeJsonFileAtomic(manifestPath, { ...manifest, ...updated });
    return updated;
  }

  /**
   * Promotes a render-validated draft after a strict optimistic-concurrency
   * check. The previous published files are retained as a named revision.
   */
  async publishDraft(input: {
    cwd: string;
    viewId: string;
    draftId: string;
  }): Promise<ArchitecturalViewSummary> {
    assertViewId(input.viewId);
    assertDraftId(input.draftId);
    const store = await this.resolveStore(input.cwd);
    const draft = await this.readDraft(store, input.viewId, input.draftId);
    if (!draft) throw new Error("Interactive View not found.");
    const current = await this.readManifest(store, input.viewId);
    if ((current?.specificationSha256 ?? null) !== draft.baseSpecificationSha256) {
      throw new Error(
        "Interactive View changed since this work began. Update it before publishing.",
      );
    }
    const draftPath = draftDirectory(store, input.viewId, input.draftId);
    const specificationPath = join(draftPath, specificationFilename(draft.diagramType));
    const specification = await readJsonSpecification(specificationPath);
    const specificationSha256 = specificationHash(specification);
    const rendered = await this.renderSpecification({
      specificationPath,
      specificationSha256,
      diagramType: draft.diagramType,
    });
    const directory = join(store.base, "architectural-views", input.viewId);
    const now = new Date().toISOString();
    if (current) {
      const revisionDirectory = join(directory, "revisions", revisionIdFor(current.renderedAt));
      await mkdir(revisionDirectory, { recursive: true });
      await Promise.all(
        [specificationFilename(diagramTypeForManifest(current)), "view.json", "receipt.json"].map(
          (file) => copyFile(join(directory, file), join(revisionDirectory, file)),
        ),
      );
    }
    const manifest: ArchitecturalViewManifest = {
      schemaVersion: 1,
      kind: "architectural-view",
      id: input.viewId,
      title: draft.title,
      knowledgeReferences: draft.knowledgeReferences,
      sourceDigests: await this.captureSourceDigests(store, draft.knowledgeReferences),
      specificationSha256,
      renderedAt: now,
      diagramType: draft.diagramType,
    };
    await Promise.all([
      writeJsonFileAtomic(join(directory, specificationFilename(draft.diagramType)), specification),
      writeJsonFileAtomic(join(directory, "view.json"), manifest),
      writeJsonFileAtomic(join(directory, "receipt.json"), rendered.receipt),
    ]);
    await rm(join(directory, renderedHtmlFilename(draft.diagramType)), { force: true });
    await rm(draftPath, { recursive: true, force: true });
    return this.summaryFromManifest(store, manifest);
  }

  async discardDraft(input: { cwd: string; viewId: string; draftId: string }): Promise<void> {
    assertViewId(input.viewId);
    assertDraftId(input.draftId);
    const store = await this.resolveStore(input.cwd);
    const directory = draftDirectory(store, input.viewId, input.draftId);
    const draft = await this.readDraft(store, input.viewId, input.draftId);
    if (!draft) throw new Error("Interactive View not found.");
    await rm(directory, { recursive: true, force: true });
  }

  /** An unpublished draft ends when its bound authoring chat is archived or deleted. */
  async discardDraftForAuthoringAgent(input: {
    cwd: string;
    viewId: string;
    draftId: string;
    agentId: string;
  }): Promise<void> {
    const store = await this.resolveStore(input.cwd);
    const draft = await this.readDraft(store, input.viewId, input.draftId);
    if (!draft || draft.authoringAgentId !== input.agentId) return;
    await rm(draftDirectory(store, input.viewId, input.draftId), { recursive: true, force: true });
  }

  /** Retains unfinished visual work when its authoring chat moves elsewhere. */
  async releaseDraftAuthoringAgent(input: {
    cwd: string;
    viewId: string;
    draftId: string;
    agentId: string;
  }): Promise<void> {
    const store = await this.resolveStore(input.cwd);
    const draft = await this.readDraft(store, input.viewId, input.draftId);
    if (!draft || draft.authoringAgentId !== input.agentId) return;
    const manifestPath = join(draftDirectory(store, input.viewId, input.draftId), "draft.json");
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as ArchitecturalViewDraftManifest;
    await writeJsonFileAtomic(manifestPath, {
      ...manifest,
      authoringAgentId: null,
      updatedAt: new Date().toISOString(),
    });
  }

  private async readSummary(
    store: ProjectKnowledgeStore,
    viewId: string,
  ): Promise<ArchitecturalViewSummary | null> {
    if (!isArchitecturalViewId(viewId)) return null;
    try {
      const manifest = JSON.parse(
        await readFile(join(store.base, "architectural-views", viewId, "view.json"), "utf8"),
      ) as unknown;
      if (!isArchitecturalViewManifest(manifest) || manifest.id !== viewId) return null;
      return this.summaryFromManifest(store, manifest);
    } catch {
      return null;
    }
  }

  private async summaryFromManifest(
    store: ProjectKnowledgeStore,
    manifest: ArchitecturalViewManifest,
  ): Promise<ArchitecturalViewSummary> {
    return {
      id: manifest.id,
      title: manifest.title,
      knowledgeReferences: manifest.knowledgeReferences,
      storeLocation: store.location,
      htmlPath: relative(
        store.pathBase,
        join(
          store.base,
          "architectural-views",
          manifest.id,
          specificationFilename(diagramTypeForManifest(manifest)),
        ),
      )
        .split("\\")
        .join("/"),
      renderedAt: manifest.renderedAt,
      diagramType: diagramTypeForManifest(manifest),
      sourceStatus: await this.sourceStatus(store, manifest),
    };
  }

  private async captureSourceDigests(
    store: ProjectKnowledgeStore,
    references: readonly ArchitecturalViewKnowledgeReference[],
  ): Promise<ArchitecturalViewSourceDigest[]> {
    return Promise.all(
      references.map(async (reference) => ({
        reference,
        sha256: await this.sourceDigest(store, reference),
      })),
    );
  }

  private async sourceStatus(
    store: ProjectKnowledgeStore,
    manifest: ArchitecturalViewManifest,
  ): Promise<ArchitecturalViewSummary["sourceStatus"]> {
    if (!manifest.sourceDigests) return "unknown";
    const current = await this.captureSourceDigests(store, manifest.knowledgeReferences);
    return current.every((entry, index) => {
      const delivered = manifest.sourceDigests?.[index];
      return (
        delivered?.reference.kind === entry.reference.kind &&
        delivered.reference.id === entry.reference.id &&
        delivered.sha256 === entry.sha256
      );
    })
      ? "current"
      : "stale";
  }

  private async sourceDigest(
    store: ProjectKnowledgeStore,
    reference: ArchitecturalViewKnowledgeReference,
  ): Promise<string | null> {
    const source = await this.findKnowledgeSourcePath(store, reference);
    if (!source) return null;
    try {
      return createHash("sha256")
        .update(await readFile(source, "utf8"))
        .digest("hex");
    } catch {
      return null;
    }
  }

  private async findKnowledgeSourcePath(
    store: ProjectKnowledgeStore,
    reference: ArchitecturalViewKnowledgeReference,
  ): Promise<string | null> {
    const knowledgeRoot = join(store.base, "knowledge");
    if (reference.kind === "root") return join(knowledgeRoot, `${reference.id}.md`);
    return findKnowledgeRecordPath(knowledgeRoot, reference.id);
  }

  private async readManifest(
    store: ProjectKnowledgeStore,
    viewId: string,
  ): Promise<ArchitecturalViewManifest | null> {
    try {
      const manifest = JSON.parse(
        await readFile(join(store.base, "architectural-views", viewId, "view.json"), "utf8"),
      ) as unknown;
      return isArchitecturalViewManifest(manifest) && manifest.id === viewId ? manifest : null;
    } catch {
      return null;
    }
  }

  private async readDraft(
    store: ProjectKnowledgeStore,
    viewId: string,
    draftId: string,
  ): Promise<ArchitecturalViewDraft | null> {
    try {
      const manifest = JSON.parse(
        await readFile(join(draftDirectory(store, viewId, draftId), "draft.json"), "utf8"),
      ) as unknown;
      if (!isArchitecturalViewDraftManifest(manifest)) return null;
      const {
        schemaVersion: _schemaVersion,
        kind: _kind,
        specificationSha256: _hash,
        receipt: _receipt,
        ...draft
      } = manifest;
      return {
        ...draft,
        diagramType: draft.diagramType ?? "architecture",
        authoringAgentId: draft.authoringAgentId ?? null,
      };
    } catch {
      return null;
    }
  }

  private async readDraftsForView(
    store: ProjectKnowledgeStore,
    viewId: string,
  ): Promise<ArchitecturalViewDraft[]> {
    const entries = await readdir(join(store.base, "architectural-views", viewId, "drafts"), {
      withFileTypes: true,
    }).catch((error: unknown) => {
      if (isMissingPath(error)) return [];
      throw error;
    });
    const drafts = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && isArchitecturalViewId(entry.name))
        .map((entry) => this.readDraft(store, viewId, entry.name)),
    );
    return drafts
      .filter((draft): draft is ArchitecturalViewDraft => draft !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async renderDraft(input: {
    directory: string;
    draft: ArchitecturalViewDraft;
    specification: unknown;
    quality?: ArchifyQualityProfile;
  }): Promise<ArchitecturalViewDraft> {
    await mkdir(input.directory, { recursive: true });
    const candidateDirectory = join(input.directory, ".candidate");
    await mkdir(candidateDirectory, { recursive: true });
    const candidateSpecificationPath = join(
      candidateDirectory,
      specificationFilename(input.draft.diagramType),
    );
    try {
      await writeJsonFileAtomic(candidateSpecificationPath, input.specification);
      const specificationSha256 = specificationHash(input.specification);
      const rendered = await this.renderSpecification({
        specificationPath: candidateSpecificationPath,
        specificationSha256,
        diagramType: input.draft.diagramType,
        quality: input.quality,
      });
      const manifest: ArchitecturalViewDraftManifest = {
        schemaVersion: 1,
        kind: "architectural-view-draft",
        ...input.draft,
        specificationSha256,
        receipt: rendered.receipt,
      };
      await Promise.all([
        writeJsonFileAtomic(
          join(input.directory, specificationFilename(input.draft.diagramType)),
          input.specification,
        ),
        writeJsonFileAtomic(join(input.directory, "receipt.json"), rendered.receipt),
        writeJsonFileAtomic(join(input.directory, "draft.json"), manifest),
      ]);
      await rm(join(input.directory, renderedHtmlFilename(input.draft.diagramType)), {
        force: true,
      });
      return input.draft;
    } finally {
      await rm(candidateDirectory, { recursive: true, force: true });
    }
  }

  private async getRenderedHtml(input: {
    specificationPath: string;
    specificationSha256: string;
    diagramType: ArchitecturalViewDiagramType;
  }): Promise<string> {
    const cached = this.renderedHtmlCache.get(input.specificationSha256);
    if (cached) return cached;
    return (
      await this.renderSpecification({
        specificationPath: input.specificationPath,
        specificationSha256: input.specificationSha256,
        diagramType: input.diagramType,
      })
    ).html;
  }

  private async renderSpecification(input: {
    specificationPath: string;
    specificationSha256: string;
    diagramType: ArchitecturalViewDiagramType;
    quality?: ArchifyQualityProfile;
  }): Promise<{ html: string; receipt: Record<string, unknown> }> {
    const renderDirectory = await mkdtemp(join(tmpdir(), "otto-architectural-view-render-"));
    const htmlPath = join(renderDirectory, renderedHtmlFilename(input.diagramType));
    try {
      const delivery = await this.renderer.deliverFile({
        diagramType: input.diagramType,
        specificationPath: input.specificationPath,
        htmlPath,
        quality: input.quality,
      });
      const rendered = validateHtmlFile(htmlPath);
      if (!rendered.isValid) {
        throw new Error("Interactive View renderer returned invalid HTML.");
      }
      this.rememberRenderedHtml(input.specificationSha256, rendered.content);
      return { html: rendered.content, receipt: delivery.receipt };
    } finally {
      await rm(renderDirectory, { recursive: true, force: true });
    }
  }

  private rememberRenderedHtml(specificationSha256: string, html: string): void {
    this.renderedHtmlCache.delete(specificationSha256);
    this.renderedHtmlCache.set(specificationSha256, html);
    const oldest = this.renderedHtmlCache.keys().next().value;
    if (this.renderedHtmlCache.size > 8 && oldest) {
      this.renderedHtmlCache.delete(oldest);
    }
  }
}

function isArchitecturalViewId(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

function assertViewId(value: string): void {
  if (!isArchitecturalViewId(value)) {
    throw new Error("Interactive View id must use lowercase letters, digits, and hyphens.");
  }
}

function assertDraftId(value: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error("Interactive View session id must use lowercase letters, digits, and hyphens.");
  }
}

function draftDirectory(store: ProjectKnowledgeStore, viewId: string, draftId: string): string {
  return join(store.base, "architectural-views", viewId, "drafts", draftId);
}

function resolveDraftSourcePath(sourcePath: string): string {
  if (!isAbsolute(sourcePath)) throw new Error("Interactive View source paths must be absolute.");
  return resolve(sourcePath);
}

async function readJsonSpecification(sourcePath: string): Promise<unknown> {
  let sourceText: string;
  try {
    sourceText = await readFile(sourcePath, "utf8");
  } catch {
    throw new Error("Interactive View source could not be read.");
  }
  try {
    return JSON.parse(sourceText) as unknown;
  } catch {
    throw new Error("Interactive View source must contain valid JSON.");
  }
}

function specificationHash(specification: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(specification, null, 2))
    .digest("hex");
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isArchitecturalViewManifest(value: unknown): value is ArchitecturalViewManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<ArchitecturalViewManifest>;
  return (
    manifest.schemaVersion === 1 &&
    manifest.kind === "architectural-view" &&
    typeof manifest.id === "string" &&
    isArchitecturalViewId(manifest.id) &&
    typeof manifest.title === "string" &&
    hasValidKnowledgeReferences(manifest.knowledgeReferences) &&
    (manifest.sourceDigests === undefined ||
      (Array.isArray(manifest.sourceDigests) &&
        manifest.sourceDigests.every(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            "reference" in entry &&
            typeof entry.reference === "object" &&
            entry.reference !== null &&
            (entry.reference.kind === "root" || entry.reference.kind === "record") &&
            typeof entry.reference.id === "string" &&
            (typeof entry.sha256 === "string" || entry.sha256 === null),
        ))) &&
    typeof manifest.specificationSha256 === "string" &&
    typeof manifest.renderedAt === "string" &&
    (manifest.diagramType === undefined || isArchitecturalViewDiagramType(manifest.diagramType))
  );
}

function isArchitecturalViewDraftManifest(value: unknown): value is ArchitecturalViewDraftManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<ArchitecturalViewDraftManifest>;
  return (
    manifest.schemaVersion === 1 &&
    manifest.kind === "architectural-view-draft" &&
    typeof manifest.id === "string" &&
    /^[a-z][a-z0-9-]*$/.test(manifest.id) &&
    typeof manifest.viewId === "string" &&
    isArchitecturalViewId(manifest.viewId) &&
    typeof manifest.title === "string" &&
    hasValidKnowledgeReferences(manifest.knowledgeReferences) &&
    (typeof manifest.baseSpecificationSha256 === "string" ||
      manifest.baseSpecificationSha256 === null) &&
    typeof manifest.createdAt === "string" &&
    typeof manifest.updatedAt === "string" &&
    (manifest.diagramType === undefined || isArchitecturalViewDiagramType(manifest.diagramType)) &&
    isOptionalAuthoringAgentId(manifest.authoringAgentId) &&
    typeof manifest.specificationSha256 === "string" &&
    typeof manifest.receipt === "object" &&
    manifest.receipt !== null
  );
}

function isOptionalAuthoringAgentId(value: unknown): value is string | null | undefined {
  return typeof value === "string" || value === null || value === undefined;
}

function hasValidKnowledgeReferences(
  value: unknown,
): value is ArchitecturalViewKnowledgeReference[] {
  return (
    Array.isArray(value) &&
    value.every(
      (reference) =>
        typeof reference === "object" &&
        reference !== null &&
        (reference.kind === "root" || reference.kind === "record") &&
        typeof reference.id === "string" &&
        reference.id.length > 0,
    )
  );
}

function revisionIdFor(renderedAt: string): string {
  return `published-${renderedAt.replace(/[:.]/g, "-")}`;
}

/**
 * A deliberately small, valid first frame. It makes the authoring session
 * usable before a model has inspected the linked Knowledge, without inventing
 * architecture facts or coupling creation to a workspace-side JSON file.
 */
function specificationFilename(diagramType: ArchitecturalViewDiagramType): string {
  return `view.${diagramType}.json`;
}

function renderedHtmlFilename(diagramType: ArchitecturalViewDiagramType): string {
  return `view.${diagramType}.html`;
}

function diagramTypeForManifest(
  manifest: Pick<ArchitecturalViewManifest, "diagramType"> | null,
): ArchitecturalViewDiagramType {
  return manifest?.diagramType ?? "architecture";
}

function isArchitecturalViewDiagramType(value: unknown): value is ArchitecturalViewDiagramType {
  return (
    value === "architecture" ||
    value === "workflow" ||
    value === "sequence" ||
    value === "dataflow" ||
    value === "lifecycle"
  );
}

function assertSpecificationDiagramType(
  specification: unknown,
  expected: ArchitecturalViewDiagramType,
): void {
  if (
    typeof specification !== "object" ||
    specification === null ||
    (specification as { diagram_type?: unknown }).diagram_type !== expected
  ) {
    throw new Error(`Interactive View specification must be a ${expected} document.`);
  }
}

function starterSpecification(
  diagramType: ArchitecturalViewDiagramType,
  title: string,
): Record<string, unknown> {
  switch (diagramType) {
    case "architecture":
      return starterArchitectureSpecification(title);
    case "workflow":
      return starterWorkflowSpecification(title);
    case "sequence":
      return starterSequenceSpecification(title);
    case "dataflow":
      return starterDataflowSpecification(title);
    case "lifecycle":
      return starterLifecycleSpecification(title);
  }
}

function starterArchitectureSpecification(title: string): Record<string, unknown> {
  return {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title,
      views: [
        {
          id: "overview",
          label: "Architecture overview",
          focus: ["knowledge-source"],
          note: "A staged starting point linked to the selected Knowledge document.",
        },
      ],
    },
    components: [
      {
        id: "knowledge-source",
        type: "backend",
        label: title,
        sublabel: "Knowledge source",
        pos: [300, 260],
        size: [220, 72],
      },
    ],
    boundaries: [],
    connections: [],
    cards: [
      {
        dot: "violet",
        title: "Staged draft",
        items: [
          "Use the authoring chat to replace this starting point with supported architecture.",
        ],
      },
    ],
  };
}

function starterWorkflowSpecification(title: string): Record<string, unknown> {
  return {
    schema_version: 1,
    diagram_type: "workflow",
    meta: { title },
    lanes: [{ id: "knowledge", label: "Knowledge" }],
    mainPath: ["source", "outcome"],
    nodes: [
      {
        id: "source",
        lane: "knowledge",
        col: 0,
        type: "backend",
        label: "Source",
        sublabel: "Knowledge",
      },
      {
        id: "outcome",
        lane: "knowledge",
        col: 1,
        type: "external",
        label: "Outcome",
        sublabel: "To author",
      },
    ],
    edges: [{ id: "source-outcome", from: "source", to: "outcome", variant: "default" }],
  };
}

function starterSequenceSpecification(title: string): Record<string, unknown> {
  return {
    schema_version: 1,
    diagram_type: "sequence",
    meta: { title },
    participants: [
      { id: "source", type: "backend", label: "Source", sublabel: "Knowledge" },
      { id: "outcome", type: "external", label: "Outcome", sublabel: "To author" },
    ],
    messages: [
      {
        id: "source-outcome",
        from: "source",
        to: "outcome",
        y: 180,
        label: "describe interaction",
        variant: "default",
      },
    ],
  };
}

function starterDataflowSpecification(title: string): Record<string, unknown> {
  return {
    schema_version: 1,
    diagram_type: "dataflow",
    meta: { title },
    stages: [{ label: "Source" }, { label: "Outcome" }],
    nodes: [
      {
        id: "source",
        type: "backend",
        label: title,
        sublabel: "Knowledge source",
        stage: 0,
        row: 0,
      },
      {
        id: "outcome",
        type: "external",
        label: "Outcome",
        sublabel: "To be authored",
        stage: 1,
        row: 0,
      },
    ],
    flows: [
      {
        id: "source-outcome",
        from: "source",
        to: "outcome",
        label: "describe data",
        classification: "to be authored",
        variant: "default",
      },
    ],
  };
}

function starterLifecycleSpecification(title: string): Record<string, unknown> {
  return {
    schema_version: 1,
    diagram_type: "lifecycle",
    meta: { title },
    lanes: [{ id: "main", label: "Lifecycle" }],
    states: [
      {
        id: "source",
        type: "start",
        label: "Source",
        sublabel: "Knowledge",
        lane: "main",
        col: 0,
      },
      {
        id: "outcome",
        type: "active",
        label: "Outcome",
        sublabel: "To author",
        lane: "main",
        col: 2,
      },
    ],
    transitions: [{ id: "source-outcome", from: "source", to: "outcome", variant: "default" }],
  };
}

/** Knowledge records are grouped by kind, while root pages sit at the tree root. */
async function findKnowledgeRecordPath(knowledgeRoot: string, id: string): Promise<string | null> {
  const candidateName = `${id}.md`;
  async function walk(directory: string): Promise<string | null> {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if (isMissingPath(error)) return [];
      throw error;
    });
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isFile() && entry.name === candidateName) return entryPath;
      if (entry.isDirectory()) {
        const found = await walk(entryPath);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(knowledgeRoot);
}
