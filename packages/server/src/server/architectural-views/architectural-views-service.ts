import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";
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
  quality?: ArchifyQualityProfile;
}

export interface DeliveredArchitecturalView {
  viewId: string;
  storeLocation: ProjectKnowledgeStore["location"];
  htmlPath: string;
}

export interface ArchitecturalViewSummary {
  id: string;
  title: string;
  knowledgeReferences: ArchitecturalViewKnowledgeReference[];
  storeLocation: ProjectKnowledgeStore["location"];
  htmlPath: string;
  renderedAt: string;
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
 * Stores one Architectural View beside the project Knowledge it explains.
 * Repository and host stores therefore preserve the same layout and lifecycle.
 */
export class ArchitecturalViewsService {
  private readonly resolveStore: ArchitecturalViewsServiceOptions["resolveStore"];
  private readonly renderer: ArchifyRenderer;

  constructor(options: ArchitecturalViewsServiceOptions) {
    this.resolveStore = options.resolveStore;
    this.renderer = options.renderer ?? new ArchifyRenderer();
  }

  async deliver(input: DeliverArchitecturalViewInput): Promise<DeliveredArchitecturalView> {
    assertViewId(input.viewId);
    const store = await this.resolveStore(input.cwd);
    const directory = join(store.base, "architectural-views", input.viewId);
    const specificationPath = join(directory, "view.architecture.json");
    const htmlPath = join(directory, "view.architecture.html");
    const manifestPath = join(directory, "view.json");
    const receiptPath = join(directory, "receipt.json");
    if (!isAbsolute(input.sourcePath)) {
      throw new Error("Architectural View source paths must be absolute.");
    }
    const sourcePath = resolve(input.sourcePath);
    const sourceText = await readFile(sourcePath, "utf8");
    let specification: unknown;
    try {
      specification = JSON.parse(sourceText) as unknown;
    } catch {
      throw new Error("Architectural View source must contain valid JSON.");
    }
    const serializedSpecification = JSON.stringify(specification, null, 2);

    await mkdir(directory, { recursive: true });
    await writeJsonFileAtomic(specificationPath, specification);
    const delivery = await this.renderer.deliverArchitectureFile({
      specificationPath,
      htmlPath,
      quality: input.quality,
    });
    const rendered = validateHtmlFile(htmlPath);
    if (!rendered.isValid) {
      throw new Error("Architectural View renderer returned invalid HTML.");
    }
    // The renderer is interactive JavaScript. Keep it interactive, but make the
    // daemon-owned stored document network-dark before any platform renders it.
    await writeFile(htmlPath, rendered.content, "utf8");
    const manifest: ArchitecturalViewManifest = {
      schemaVersion: 1,
      kind: "architectural-view",
      id: input.viewId,
      title: input.title,
      knowledgeReferences: input.knowledgeReferences,
      sourceDigests: await this.captureSourceDigests(store, input.knowledgeReferences),
      specificationSha256: createHash("sha256").update(serializedSpecification).digest("hex"),
      renderedAt: new Date().toISOString(),
    };
    await Promise.all([
      writeJsonFileAtomic(manifestPath, manifest),
      writeJsonFileAtomic(receiptPath, delivery.receipt),
    ]);

    return {
      viewId: input.viewId,
      storeLocation: store.location,
      htmlPath: relative(store.pathBase, htmlPath).split("\\").join("/"),
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
    const view = await this.readSummary(store, viewId);
    if (!view) return null;
    const htmlPath = join(store.base, "architectural-views", viewId, "view.architecture.html");
    const rendered = validateHtmlFile(htmlPath);
    if (!rendered.isValid) {
      throw new Error("Architectural View HTML is missing or invalid.");
    }
    return { view, html: rendered.content };
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
    quality?: ArchifyQualityProfile;
  }): Promise<ArchitecturalViewDraft> {
    assertViewId(input.viewId);
    assertDraftId(input.draftId);
    const store = await this.resolveStore(input.cwd);
    const current = await this.readManifest(store, input.viewId);
    const sourcePath = input.sourcePath
      ? resolveDraftSourcePath(input.sourcePath)
      : join(store.base, "architectural-views", input.viewId, "view.architecture.json");
    if (!current && !input.sourcePath) {
      throw new Error("A new Architectural View draft needs a JSON source.");
    }
    const title = current?.title ?? input.title;
    const knowledgeReferences = current?.knowledgeReferences ?? input.knowledgeReferences;
    if (!title.trim() || knowledgeReferences.length === 0) {
      throw new Error("Architectural View drafts need a title and at least one Knowledge link.");
    }
    const specification = await readJsonSpecification(sourcePath);
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
        authoringAgentId: null,
        createdAt: now,
        updatedAt: now,
      },
      specification,
      quality: input.quality,
    });
    return draft;
  }

  /** A failed render leaves the draft's existing JSON and last valid HTML intact. */
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
    if (!existing) throw new Error("Architectural View draft not found.");
    const specification = await readJsonSpecification(resolveDraftSourcePath(input.sourcePath));
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
    if (!existing) throw new Error("Architectural View draft not found.");
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
        join(draftDirectory(store, input.viewId, input.draftId), "view.architecture.json"),
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
    const rendered = validateHtmlFile(
      join(draftDirectory(store, viewId, draftId), "view.architecture.html"),
    );
    if (!rendered.isValid) throw new Error("Architectural View draft HTML is missing or invalid.");
    return { draft, html: rendered.content };
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
    if (!input.agentId.trim()) throw new Error("Architectural View authoring chat id is required.");
    const store = await this.resolveStore(input.cwd);
    const draft = await this.readDraft(store, input.viewId, input.draftId);
    if (!draft) throw new Error("Architectural View draft not found.");
    if (draft.authoringAgentId && draft.authoringAgentId !== input.agentId) {
      throw new Error("Architectural View draft is already linked to another authoring chat.");
    }
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
   * Promotes a fully rendered draft after a strict optimistic-concurrency
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
    if (!draft) throw new Error("Architectural View draft not found.");
    const current = await this.readManifest(store, input.viewId);
    if ((current?.specificationSha256 ?? null) !== draft.baseSpecificationSha256) {
      throw new Error(
        "Architectural View changed since this draft began. Rebase before publishing.",
      );
    }
    const draftPath = draftDirectory(store, input.viewId, input.draftId);
    const rendered = validateHtmlFile(join(draftPath, "view.architecture.html"));
    if (!rendered.isValid) throw new Error("Architectural View draft HTML is missing or invalid.");
    const specification = await readJsonSpecification(join(draftPath, "view.architecture.json"));
    const receipt = JSON.parse(await readFile(join(draftPath, "receipt.json"), "utf8")) as unknown;
    const directory = join(store.base, "architectural-views", input.viewId);
    const now = new Date().toISOString();
    if (current) {
      const revisionDirectory = join(directory, "revisions", revisionIdFor(current.renderedAt));
      await mkdir(revisionDirectory, { recursive: true });
      await Promise.all(
        ["view.architecture.json", "view.architecture.html", "view.json", "receipt.json"].map(
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
      specificationSha256: specificationHash(specification),
      renderedAt: now,
    };
    await Promise.all([
      writeJsonFileAtomic(join(directory, "view.architecture.json"), specification),
      writeFileAtomic(join(directory, "view.architecture.html"), rendered.content),
      writeJsonFileAtomic(join(directory, "view.json"), manifest),
      writeJsonFileAtomic(join(directory, "receipt.json"), receipt),
    ]);
    await rm(draftPath, { recursive: true, force: true });
    return this.summaryFromManifest(store, manifest);
  }

  async discardDraft(input: { cwd: string; viewId: string; draftId: string }): Promise<void> {
    assertViewId(input.viewId);
    assertDraftId(input.draftId);
    const store = await this.resolveStore(input.cwd);
    const directory = draftDirectory(store, input.viewId, input.draftId);
    const draft = await this.readDraft(store, input.viewId, input.draftId);
    if (!draft) throw new Error("Architectural View draft not found.");
    await rm(directory, { recursive: true, force: true });
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
        join(store.base, "architectural-views", manifest.id, "view.architecture.html"),
      )
        .split("\\")
        .join("/"),
      renderedAt: manifest.renderedAt,
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
      return { ...draft, authoringAgentId: draft.authoringAgentId ?? null };
    } catch {
      return null;
    }
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
    const candidateSpecificationPath = join(candidateDirectory, "view.architecture.json");
    const candidateHtmlPath = join(candidateDirectory, "view.architecture.html");
    try {
      await writeJsonFileAtomic(candidateSpecificationPath, input.specification);
      const delivery = await this.renderer.deliverArchitectureFile({
        specificationPath: candidateSpecificationPath,
        htmlPath: candidateHtmlPath,
        quality: input.quality,
      });
      const rendered = validateHtmlFile(candidateHtmlPath);
      if (!rendered.isValid) throw new Error("Architectural View renderer returned invalid HTML.");
      const manifest: ArchitecturalViewDraftManifest = {
        schemaVersion: 1,
        kind: "architectural-view-draft",
        ...input.draft,
        specificationSha256: specificationHash(input.specification),
        receipt: delivery.receipt,
      };
      await Promise.all([
        writeJsonFileAtomic(join(input.directory, "view.architecture.json"), input.specification),
        writeFileAtomic(join(input.directory, "view.architecture.html"), rendered.content),
        writeJsonFileAtomic(join(input.directory, "receipt.json"), delivery.receipt),
        writeJsonFileAtomic(join(input.directory, "draft.json"), manifest),
      ]);
      return input.draft;
    } finally {
      await rm(candidateDirectory, { recursive: true, force: true });
    }
  }
}

function isArchitecturalViewId(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

function assertViewId(value: string): void {
  if (!isArchitecturalViewId(value)) {
    throw new Error("Architectural View id must use lowercase letters, digits, and hyphens.");
  }
}

function assertDraftId(value: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error("Architectural View draft id must use lowercase letters, digits, and hyphens.");
  }
}

function draftDirectory(store: ProjectKnowledgeStore, viewId: string, draftId: string): string {
  return join(store.base, "architectural-views", viewId, "drafts", draftId);
}

function resolveDraftSourcePath(sourcePath: string): string {
  if (!isAbsolute(sourcePath)) throw new Error("Architectural View source paths must be absolute.");
  return resolve(sourcePath);
}

async function readJsonSpecification(sourcePath: string): Promise<unknown> {
  let sourceText: string;
  try {
    sourceText = await readFile(sourcePath, "utf8");
  } catch {
    throw new Error("Architectural View source could not be read.");
  }
  try {
    return JSON.parse(sourceText) as unknown;
  } catch {
    throw new Error("Architectural View source must contain valid JSON.");
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
    Array.isArray(manifest.knowledgeReferences) &&
    manifest.knowledgeReferences.every(
      (reference) =>
        typeof reference === "object" &&
        reference !== null &&
        (reference.kind === "root" || reference.kind === "record") &&
        typeof reference.id === "string" &&
        reference.id.length > 0,
    ) &&
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
    typeof manifest.renderedAt === "string"
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
    Array.isArray(manifest.knowledgeReferences) &&
    manifest.knowledgeReferences.every(
      (reference) =>
        typeof reference === "object" &&
        reference !== null &&
        (reference.kind === "root" || reference.kind === "record") &&
        typeof reference.id === "string" &&
        reference.id.length > 0,
    ) &&
    (typeof manifest.baseSpecificationSha256 === "string" ||
      manifest.baseSpecificationSha256 === null) &&
    typeof manifest.createdAt === "string" &&
    typeof manifest.updatedAt === "string" &&
    isOptionalAuthoringAgentId(manifest.authoringAgentId) &&
    typeof manifest.specificationSha256 === "string" &&
    typeof manifest.receipt === "object" &&
    manifest.receipt !== null
  );
}

function isOptionalAuthoringAgentId(value: unknown): value is string | null | undefined {
  return typeof value === "string" || value === null || value === undefined;
}

function revisionIdFor(renderedAt: string): string {
  return `published-${renderedAt.replace(/[:.]/g, "-")}`;
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
