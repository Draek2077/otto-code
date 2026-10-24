import path from "node:path";
import {
  appendPageEvent,
  createDraftPage,
  digest,
  knowledgeKinds,
  parseKnowledgePage,
  repairPurgedPageLinks,
  type KnowledgeKind,
  type KnowledgePage,
} from "./markdown-page.js";
import {
  KnowledgeConflictError,
  listKnowledgeFiles,
  readKnowledgeFile,
  replaceKnowledgeFile,
  removeKnowledgeFile,
  withKnowledgeWrite,
  type KnowledgeReplacementPorts,
} from "./knowledge-files.js";
import {
  assertSafeSegment,
  type KnowledgeStore,
  type KnowledgeStoreResolver,
} from "./store-resolver.js";
import { removeWikiLinksTo } from "./links.js";

export const knowledgeRoots = [
  "background",
  "architecture",
  "flow",
  "mindmap",
  "stack",
  "roadmap",
] as const;
export type KnowledgeRoot = (typeof knowledgeRoots)[number];

export interface KnowledgeSummary {
  id: string;
  kind: KnowledgeKind;
  title: string;
  status: KnowledgePage["metadata"]["status"];
  tags: string[];
  updatedAt: string;
  revision: string;
}

export interface KnowledgeDocument extends KnowledgePage {
  /** Host path, never a path on the connected mobile/desktop client. */
  absolutePath: string;
}

export interface KnowledgeServicePorts {
  resolver: Pick<KnowledgeStoreResolver, "resolve">;
  now: () => Date;
  replacement?: KnowledgeReplacementPorts;
}

export interface RecordTarget {
  projectId: string;
  kind: KnowledgeKind;
  id: string;
}

export interface RecordEdit extends RecordTarget {
  expectedRevision: string;
}
export class KnowledgeNotFoundError extends Error {
  constructor() {
    super("This Knowledge page was removed. Choose another page.");
  }
}
export class KnowledgePurgeIncompleteError extends Error {
  constructor(cause: unknown) {
    super(
      "Purge did not finish cleanly. Link repairs or deletion may have been applied. Reload the catalog and inspect the selected page before another explicit attempt.",
      { cause },
    );
  }
}

/** Canonical daemon library; adapters own caller scope and human review authority. */
export class KnowledgeService {
  constructor(private readonly ports: KnowledgeServicePorts) {}

  async catalog(projectId: string, includeInactive = false): Promise<KnowledgeSummary[]> {
    const store = await this.ports.resolver.resolve(projectId);
    const documents = await this.documents(store);
    return documents
      .filter((page) => includeInactive || page.metadata.status === "confirmed")
      .map(({ metadata, revision }) => ({
        id: metadata.id,
        kind: metadata.kind,
        title: metadata.title,
        status: metadata.status,
        tags: metadata.tags,
        updatedAt: metadata.updated_at,
        revision,
      }));
  }

  async read(input: RecordTarget): Promise<KnowledgeDocument> {
    const store = await this.ports.resolver.resolve(input.projectId);
    return this.readFromStore(store, input);
  }

  async readRoot(input: { projectId: string; slug: KnowledgeRoot }): Promise<{
    body: string;
    revision: string;
    absolutePath: string;
  } | null> {
    if (!knowledgeRoots.includes(input.slug)) throw new Error("Unknown Knowledge root");
    const store = await this.ports.resolver.resolve(input.projectId);
    const absolutePath = path.join(store.base, "knowledge", `${input.slug}.md`);
    const body = await readKnowledgeFile(store, absolutePath);
    return body === null ? null : { body, revision: digest(body), absolutePath };
  }

  async createDraft(
    input: RecordTarget & {
      title: string;
      statement: string;
      tags?: string[];
    },
  ): Promise<KnowledgeDocument> {
    const store = await this.ports.resolver.resolve(input.projectId);
    const file = pagePath(store, input);
    const title = requiredText(input.title);
    if (/[\r\n]/.test(title)) throw new Error("Knowledge titles must use one line");
    const body = createDraftPage({
      id: input.id,
      kind: input.kind,
      title,
      statement: requiredText(input.statement),
      tags: input.tags ?? [],
      now: this.ports.now().toISOString(),
    });
    parseKnowledgePage(body);
    return withKnowledgeWrite(store, async () => {
      if ((await this.documents(store)).some((page) => page.metadata.id === input.id)) {
        throw new KnowledgeConflictError();
      }
      await replaceKnowledgeFile({
        store,
        file,
        expectedRevision: null,
        body,
        replacement: this.ports.replacement,
      });
      return this.readFromStore(store, input);
    });
  }

  async updateTruth(
    input: RecordEdit & { statement: string; reason: string },
  ): Promise<KnowledgeDocument> {
    return this.editPage(input, (raw, now) =>
      appendPageEvent({
        raw,
        statement: requiredText(input.statement),
        event: { kind: "decision", text: requiredText(input.reason), recordedAt: now },
      }),
    );
  }

  async appendEvidence(
    input: RecordEdit & { text: string; source?: string },
  ): Promise<KnowledgeDocument> {
    return this.editPage(input, (raw, now) =>
      appendPageEvent({
        raw,
        event: {
          kind: "evidence",
          text: requiredText(input.text),
          recordedAt: now,
          ...(input.source ? { source: input.source } : {}),
        },
      }),
    );
  }

  /** Internal composition seam. Never accepts a renderer/function from the wire. */
  async editPage(
    input: RecordEdit,
    render: (raw: string, now: string) => string,
  ): Promise<KnowledgeDocument> {
    const store = await this.ports.resolver.resolve(input.projectId);
    const file = pagePath(store, input);
    return withKnowledgeWrite(store, async () => {
      const current = await this.readFromStore(store, input);
      if (current.revision !== input.expectedRevision) throw new KnowledgeConflictError();
      const raw = await readKnowledgeFile(store, file);
      if (raw === null || digest(raw) !== input.expectedRevision)
        throw new KnowledgeConflictError();
      const body = render(raw, this.ports.now().toISOString());
      parseKnowledgePage(body);
      await replaceKnowledgeFile({
        store,
        file,
        expectedRevision: input.expectedRevision,
        body,
        replacement: this.ports.replacement,
      });
      return this.readFromStore(store, input);
    });
  }

  async writeRoot(input: {
    projectId: string;
    slug: KnowledgeRoot;
    expectedRevision: string | null;
    body: string;
  }): Promise<void> {
    if (!knowledgeRoots.includes(input.slug)) throw new Error("Unknown Knowledge root");
    const store = await this.ports.resolver.resolve(input.projectId);
    await withKnowledgeWrite(store, () =>
      replaceKnowledgeFile({
        store,
        file: path.join(store.base, "knowledge", `${input.slug}.md`),
        expectedRevision: input.expectedRevision,
        body: input.body,
        replacement: this.ports.replacement,
      }),
    );
  }

  async purge(input: RecordEdit & { reason: string }): Promise<void> {
    const reason = requiredText(input.reason);
    const store = await this.ports.resolver.resolve(input.projectId);
    await withKnowledgeWrite(store, async () => {
      const target = await this.readFromStore(store, input);
      if (target.revision !== input.expectedRevision) throw new KnowledgeConflictError();
      // Plan and validate ALL current articles/roots before the first write.
      const repairs: { file: string; expectedRevision: string; body: string }[] = [];
      const now = this.ports.now().toISOString();
      for (const page of await this.documents(store)) {
        if (page.metadata.id === input.id) continue;
        const raw = await readKnowledgeFile(store, page.absolutePath);
        if (raw === null || digest(raw) !== page.revision) throw new KnowledgeConflictError();
        const body = repairPurgedPageLinks({ raw, id: input.id, reason, now });
        if (body !== raw)
          repairs.push({ file: page.absolutePath, expectedRevision: page.revision, body });
      }
      for (const slug of [...knowledgeRoots, "index"]) {
        const file = path.join(store.base, "knowledge", `${slug}.md`);
        const raw = await readKnowledgeFile(store, file);
        if (raw === null) continue;
        const body = removeWikiLinksTo(raw, input.id);
        if (body !== raw) repairs.push({ file, expectedRevision: digest(raw), body });
      }
      try {
        for (const repair of repairs)
          await replaceKnowledgeFile({ store, ...repair, replacement: this.ports.replacement });
        // Delete last. A failed repair retains the canonical target and its
        // history. Partial repairs are not rolled back over newer editor writes.
        await removeKnowledgeFile(store, target.absolutePath, input.expectedRevision);
      } catch (error) {
        throw new KnowledgePurgeIncompleteError(error);
      }
    });
  }

  private async readFromStore(
    store: KnowledgeStore,
    target: RecordTarget,
  ): Promise<KnowledgeDocument> {
    const absolutePath = pagePath(store, target);
    const raw = await readKnowledgeFile(store, absolutePath);
    if (raw === null) throw new KnowledgeNotFoundError();
    const page = parseKnowledgePage(raw);
    if (page.metadata.id !== target.id || page.metadata.kind !== target.kind) {
      throw new Error("Knowledge metadata does not match its canonical path");
    }
    return { ...page, absolutePath };
  }

  private async documents(store: KnowledgeStore): Promise<KnowledgeDocument[]> {
    const pages: KnowledgeDocument[] = [];
    const ids = new Set<string>();
    for (const kind of Object.keys(knowledgeKinds) as KnowledgeKind[]) {
      const files = await listKnowledgeFiles(
        store,
        path.join(store.base, "knowledge", knowledgeKinds[kind]),
      );
      for (const file of files) {
        const id = path.basename(file, ".md");
        const page = await this.readFromStore(store, { projectId: store.projectId, kind, id });
        if (ids.has(id)) throw new Error("Duplicate Knowledge page identity");
        ids.add(id);
        pages.push(page);
      }
    }
    return pages;
  }
}

function pagePath(store: KnowledgeStore, target: RecordTarget): string {
  assertSafeSegment(target.id);
  if (!Object.hasOwn(knowledgeKinds, target.kind)) throw new Error("Unknown Knowledge page kind");
  const directory = knowledgeKinds[target.kind];
  return path.join(store.base, "knowledge", directory, `${target.id}.md`);
}

function requiredText(value: string): string {
  const result = value.trim();
  if (!result) throw new Error("Knowledge content and reasons must not be empty");
  return result;
}
