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
import { removeWikiLinksTo, wikiLinks } from "./links.js";
import { inspectReviewSignals } from "./review-signals.js";

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
export interface KnowledgeLinkIssue {
  source:
    | { type: "page"; kind: KnowledgeKind; id: string; revision: string }
    | { type: "root"; slug: KnowledgeRoot; revision: string };
  target: string;
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

  /** Current confirmed truth and roots only. Historical evidence is not repaired
   * or reported as live links; Draft/History targets are not active conclusions. */
  async linkHealth(projectId: string): Promise<KnowledgeLinkIssue[]> {
    const store = await this.ports.resolver.resolve(projectId);
    const pages = (await this.documents(store)).filter(
      (page) => page.metadata.status === "confirmed",
    );
    const known = new Set(pages.map((page) => page.metadata.id));
    const issues: KnowledgeLinkIssue[] = [];
    const inspect = (source: KnowledgeLinkIssue["source"], body: string) => {
      for (const target of new Set(wikiLinks(body))) {
        if (target.length > 512)
          throw new Error("Knowledge link target exceeds the inspection limit");
        if (!known.has(target)) issues.push({ source, target });
      }
    };
    for (const page of pages)
      inspect(
        { type: "page", kind: page.metadata.kind, id: page.metadata.id, revision: page.revision },
        page.statement,
      );
    for (const slug of knowledgeRoots) {
      const body = await readKnowledgeFile(store, path.join(store.base, "knowledge", `${slug}.md`));
      if (body !== null) inspect({ type: "root", slug, revision: digest(body) }, body);
    }
    const name = (source: KnowledgeLinkIssue["source"]) =>
      source.type === "page" ? source.id : source.slug;
    return issues.sort(
      (a, b) => name(a.source).localeCompare(name(b.source)) || a.target.localeCompare(b.target),
    );
  }

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

  async reviewSignals(input: RecordTarget & { expectedRevision: string }) {
    const store = await this.ports.resolver.resolve(input.projectId);
    const pages = await this.documents(store);
    const source = pages.find(
      (page) => page.metadata.kind === input.kind && page.metadata.id === input.id,
    );
    if (!source) throw new KnowledgeNotFoundError();
    if (source.revision !== input.expectedRevision) throw new KnowledgeConflictError();
    return inspectReviewSignals({ source, pages, now: this.ports.now() });
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
    return this.withCurrentStoreWrite({
      store,
      write: async () => {
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
      },
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
    return this.withCurrentStoreWrite({
      store,
      write: async () => {
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
      },
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
    await this.withCurrentStoreWrite({
      store,
      write: () =>
        replaceKnowledgeFile({
          store,
          file: path.join(store.base, "knowledge", `${input.slug}.md`),
          expectedRevision: input.expectedRevision,
          body: input.body,
          replacement: this.ports.replacement,
        }),
    });
  }

  /** Explicit initialization marker, not an automatically rewritten user index. */
  async initializeIndex(projectId: string): Promise<void> {
    const store = await this.ports.resolver.resolve(projectId);
    await this.withCurrentStoreWrite({
      store,
      write: async () => {
        const file = path.join(store.base, "knowledge", "index.md");
        if ((await readKnowledgeFile(store, file)) !== null) return;
        const body = `# Project knowledge index\n\nGenerated by Otto. Discover current records through the project Knowledge tools.\n\n## Project map\n\n${knowledgeRoots.map((slug) => `- [${slug}](${slug}.md)`).join("\n")}\n`;
        await replaceKnowledgeFile({
          store,
          file,
          expectedRevision: null,
          body,
          replacement: this.ports.replacement,
        });
      },
    });
  }

  async purge(input: RecordEdit & { reason: string }): Promise<void> {
    const reason = requiredText(input.reason);
    const store = await this.ports.resolver.resolve(input.projectId);
    await this.withCurrentStoreWrite({
      store,
      write: async () => {
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
      },
    });
  }

  /** A queued writer must not publish into the recovery copy after a storage
   * switch. The migration holds the same store lock through registry CAS. */
  private withCurrentStoreWrite<T>({
    store,
    write,
  }: {
    store: KnowledgeStore;
    write: () => Promise<T>;
  }): Promise<T> {
    return withKnowledgeWrite(store, async () => {
      const current = await this.ports.resolver.resolve(store.projectId);
      const normalize = (value: string) =>
        process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
      if (normalize(current.base) !== normalize(store.base)) throw new KnowledgeConflictError();
      return write();
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
