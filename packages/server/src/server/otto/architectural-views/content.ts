import { randomBytes } from "node:crypto";
import type {
  ViewContent,
  ViewIdentity,
  ViewSelection,
} from "@getpaseo/plugin/otto/architectural-views";
import type { ViewLibrary } from "./library.js";
import type { ViewRendering } from "./drafts.js";
import { readSpecification, recordKind } from "./records.js";
import { ArchitecturalViewError, viewDigest } from "./specification.js";

interface ContentInput {
  projectId: string;
  identity: ViewIdentity;
  selection: ViewSelection;
}
interface Entry {
  key: string;
  descriptor: ViewContent;
  html: string;
  bytes: number;
}
const PART_CHARACTERS = 64000;
const CACHE_BYTES = 33554432;
function contentKey(input: ContentInput, revision: string): string {
  return JSON.stringify([
    input.projectId,
    input.identity.origin,
    input.identity.viewId,
    input.selection,
    revision,
  ]);
}
/** Bounded, demand-owned render cache. No files, polling, durable HTML or global hash lookup. */
export class ViewContentCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<ViewContent>>();
  private bytes = 0;
  private closed = false;
  constructor(
    readonly library: ViewLibrary,
    readonly renderer: ViewRendering,
  ) {}

  async prepare(input: ContentInput & { expectedRevision: string }): Promise<ViewContent> {
    if (this.closed) throw new ArchitecturalViewError("unavailable", "The host is shutting down.");
    const selected = await this.library.selected(input.projectId, input.identity, input.selection);
    if (selected.record.revision !== input.expectedRevision)
      throw new ArchitecturalViewError(
        "conflict",
        "The selected View changed. Read its new revision before rendering.",
      );
    const key = contentKey(input, input.expectedRevision);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.descriptor;
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= 2)
      throw new ArchitecturalViewError(
        "busy",
        "Two Views are already rendering. Try again when they finish.",
      );
    const work = this.render(input).finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  private async render(input: ContentInput & { expectedRevision: string }): Promise<ViewContent> {
    const selected = await this.library.selected(input.projectId, input.identity, input.selection);
    if (selected.record.revision !== input.expectedRevision)
      throw new ArchitecturalViewError("conflict", "The selected View changed before rendering.");
    const specification = await readSpecification(
      selected.store,
      input.identity.viewId,
      selected.record,
    );
    const rendered = await this.renderer.render({
      diagramType: recordKind(selected.record.value),
      specification,
      projectRoot: selected.store.projectRoot,
    });
    const latest = await this.library.selected(input.projectId, input.identity, input.selection);
    if (latest.record.revision !== input.expectedRevision)
      throw new ArchitecturalViewError(
        "conflict",
        "The View changed while rendering. The old result was not published.",
      );
    if (this.closed) throw new ArchitecturalViewError("unavailable", "The host is shutting down.");
    return this.keep(input, input.expectedRevision, rendered.html);
  }
  prime(input: ContentInput, revision: string, html: string): void {
    if (this.closed) return;
    this.keep(input, revision, html);
  }
  private keep(input: ContentInput, revision: string, html: string): ViewContent {
    const key = contentKey(input, revision);
    const previous = this.entries.get(key);
    if (previous) return previous.descriptor;
    const parts = Math.ceil(html.length / PART_CHARACTERS);
    const bytes = Buffer.byteLength(html);
    if (!parts || parts > 128 || bytes > 8388608)
      throw new ArchitecturalViewError("invalid", "Rendered View exceeds the transfer budget.");
    const descriptor: ViewContent = {
      contentId: viewDigest(randomBytes(32).toString("hex") + key),
      revision: revision,
      parts,
      characters: html.length,
    };
    while (this.entries.size >= 8 || this.bytes + bytes > CACHE_BYTES) this.evict();
    this.entries.set(key, { key, descriptor, html: html, bytes });
    this.bytes += bytes;
    return descriptor;
  }
  private evict(): void {
    const first = this.entries.entries().next().value;
    if (!first) return;
    this.entries.delete(first[0]);
    this.bytes -= first[1].bytes;
  }
  async part(input: ContentInput & { contentId: string; part: number }) {
    const selected = await this.library.selected(input.projectId, input.identity, input.selection);
    const entry = this.entries.get(contentKey(input, selected.record.revision));
    if (this.closed || !entry || entry.descriptor.contentId !== input.contentId)
      throw new ArchitecturalViewError(
        "conflict",
        "The View content expired or changed. Prepare the current revision again.",
      );
    if (!Number.isInteger(input.part) || input.part < 0 || input.part >= entry.descriptor.parts)
      throw new ArchitecturalViewError("invalid", "Invalid View content part.");
    return {
      contentId: input.contentId,
      part: input.part,
      text: entry.html.slice(input.part * PART_CHARACTERS, (input.part + 1) * PART_CHARACTERS),
    };
  }
  close(): void {
    this.closed = true;
    this.entries.clear();
    this.bytes = 0;
  }
}
