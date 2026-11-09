import path from "node:path";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import {
  ViewId,
  ViewKind,
  ViewReference,
  ViewRevision,
  parseViewSpecification,
  ViewDraftBase,
  type ViewOrigin,
} from "@getpaseo/plugin/otto/architectural-views";
import type { KnowledgeStore } from "../project-knowledge/store-resolver.js";
import { replaceKnowledgeFile } from "../project-knowledge/knowledge-files.js";
import { readBounded, safeDirectory, missing } from "../artifacts/files.js";
import { ArchitecturalViewError, specificationText, viewDigest } from "./specification.js";

export const SourceDigest = z.object({ reference: ViewReference, sha256: ViewRevision.nullable() });
const sourceDigests = z.array(SourceDigest).max(32);
const pointers = z.object({ specification: ViewRevision, receipt: ViewRevision });
export const PublishedRecord = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("architectural-view"),
    id: ViewId,
    title: z.string().min(1).max(200),
    knowledgeReferences: z.array(ViewReference).min(1).max(32),
    sourceDigests: sourceDigests.optional(),
    specificationSha256: ViewRevision,
    renderedAt: z.string().max(64),
    diagramType: ViewKind.optional(),
    ottoPublication: pointers
      .extend({
        format: z.literal(1),
        operationId: z.string().max(120),
        draftId: ViewId,
        draftRevision: ViewRevision,
        baseRevision: ViewRevision.nullable(),
        lifecycle: z.discriminatedUnion("state", [
          z.object({ state: z.literal("published") }),
          z.object({
            state: z.literal("removed"),
            operationId: z.string().max(120),
            baseRevision: ViewRevision,
            removedAt: z.string().max(64),
          }),
        ]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export const DraftRecord = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("architectural-view-draft"),
    id: ViewId,
    viewId: ViewId,
    title: z.string().min(1).max(200),
    knowledgeReferences: z.array(ViewReference).min(1).max(32),
    baseSpecificationSha256: ViewRevision.nullable(),
    specificationSha256: ViewRevision,
    diagramType: ViewKind.optional(),
    authoringAgentId: z.string().max(200).nullable().optional(),
    authoringWorkspaceId: z.string().max(200).nullable().optional(),
    createdAt: z.string().max(64),
    updatedAt: z.string().max(64),
    receipt: z.record(z.string(), z.json()).optional(),
    ottoDraft: pointers
      .extend({
        format: z.literal(1),
        creationOperationId: z.string().max(120),
        base: ViewDraftBase,
        creationFingerprint: ViewRevision,
        sourceDigests,
        state: z.enum(["draft", "published", "discarded"]),
        starter: z.boolean(),
        operationId: z.string().max(120).nullable(),
        operationBaseRevision: ViewRevision.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type PublishedRecord = z.infer<typeof PublishedRecord>;
export type DraftRecord = z.infer<typeof DraftRecord>;
export type SourceDigest = z.infer<typeof SourceDigest>;
export interface ViewStore extends KnowledgeStore {
  origin: ViewOrigin;
}
export interface Stored<T> {
  value: T;
  raw: string;
  revision: string;
  directory: string;
}
export function viewDirectory(store: ViewStore, viewId: string): string {
  safeViewId(viewId);
  return path.join(store.base, "architectural-views", viewId);
}
export function draftDirectory(store: ViewStore, viewId: string, draftId: string): string {
  safeViewId(draftId);
  return path.join(viewDirectory(store, viewId), "drafts", draftId);
}
export function safeViewId(value: string): void {
  if (!ViewId.safeParse(value).success || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value))
    throw new ArchitecturalViewError("invalid", "Invalid View identity.");
}
export async function readViewFile(
  store: ViewStore,
  file: string,
  limit = 524288,
): Promise<string | null> {
  await safeDirectory(store.boundary, path.dirname(file));
  return readBounded(file, limit);
}
export async function readPublished(
  store: ViewStore,
  viewId: string,
): Promise<Stored<PublishedRecord> | null> {
  return readPublishedAt(store, viewId, viewDirectory(store, viewId));
}
export async function readPublishedAt(
  store: ViewStore,
  viewId: string,
  directory: string,
): Promise<Stored<PublishedRecord> | null> {
  const raw = await readViewFile(store, path.join(directory, "view.json"));
  if (raw === null) return null;
  const value = PublishedRecord.parse(JSON.parse(raw));
  if (value.id !== viewId)
    throw new ArchitecturalViewError(
      "invalid",
      "The View's saved identity does not match its location.",
    );
  return { value, raw, revision: viewDigest(raw), directory };
}
export async function readDraft(
  store: ViewStore,
  viewId: string,
  draftId: string,
): Promise<Stored<DraftRecord> | null> {
  const directory = draftDirectory(store, viewId, draftId);
  const raw = await readViewFile(store, path.join(directory, "draft.json"));
  if (raw === null) return null;
  const value = DraftRecord.parse(JSON.parse(raw));
  if (value.id !== draftId || value.viewId !== viewId)
    throw new ArchitecturalViewError(
      "invalid",
      "The draft's saved identity does not match its location.",
    );
  return { value, raw, revision: viewDigest(raw), directory };
}
export function recordKind(record: PublishedRecord | DraftRecord) {
  // COMPAT(otto09ViewKind): added v0.10.0; remove after 2027-05-09 following explicit legacy conversion.
  return record.diagramType ?? "architecture";
}
export function viewPublicationState(record: PublishedRecord): "published" | "removed" {
  // COMPAT(otto09ViewLifecycle): added v0.10.0; remove after 2027-05-09 following explicit legacy conversion.
  return record.ottoPublication?.lifecycle.state ?? "published";
}
function objectFile(store: ViewStore, viewId: string, hash: string): string {
  ViewRevision.parse(hash);
  return path.join(viewDirectory(store, viewId), ".objects", `${hash}.json`);
}
export async function readSpecification(
  store: ViewStore,
  viewId: string,
  record: Stored<PublishedRecord> | Stored<DraftRecord>,
) {
  const value = record.value;
  const kind = recordKind(value);
  const pointer = value.kind === "architectural-view" ? value.ottoPublication : value.ottoDraft;
  // COMPAT(otto09ViewSource): added v0.10.0; remove after 2027-05-09 following explicit legacy conversion.
  const file = pointer
    ? objectFile(store, viewId, pointer.specification)
    : path.join(record.directory, `view.${kind}.json`);
  const raw = await readViewFile(store, file);
  if (raw === null)
    throw new ArchitecturalViewError(
      "not_found",
      "The saved View specification is missing. Original metadata was retained.",
    );
  const parsed = parseViewSpecification(JSON.parse(raw));
  const text = specificationText(kind, parsed);
  if (viewDigest(text) !== value.specificationSha256)
    throw new ArchitecturalViewError(
      "conflict",
      "The specification changed outside its saved revision. Inspect the owning store before editing.",
    );
  if (pointer && pointer.specification !== viewDigest(raw))
    throw new ArchitecturalViewError(
      "invalid",
      "The immutable View source does not match its digest.",
    );
  return parsed;
}
/** Caller holds the canonical Knowledge writer lock. Content objects precede their sole pointer. */
export async function writeViewObject(
  store: ViewStore,
  viewId: string,
  text: string,
): Promise<string> {
  const hash = viewDigest(text);
  const file = objectFile(store, viewId, hash);
  const previous = await readViewFile(store, file);
  if (previous !== null) {
    if (previous !== text)
      throw new ArchitecturalViewError(
        "invalid",
        "An immutable View object changed. Inspect the owning store.",
      );
    return hash;
  }
  await replaceKnowledgeFile({ store, file, expectedRevision: null, body: text });
  return hash;
}
export async function writeViewPointer(
  store: ViewStore,
  file: string,
  value: unknown,
  expectedRevision: string | null,
): Promise<string> {
  const body = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(body) > 524288)
    throw new ArchitecturalViewError("invalid", "View metadata exceeds its file budget.");
  await replaceKnowledgeFile({ store, file, expectedRevision, body });
  return viewDigest(body);
}
export async function viewDirectories(
  store: ViewStore,
  directory: string,
  limit: number,
): Promise<string[]> {
  await safeDirectory(store.boundary, directory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  if (entries.length > limit)
    throw new ArchitecturalViewError(
      "invalid",
      "The View store exceeds its discovery budget. Original files were retained.",
    );
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw new ArchitecturalViewError(
        "invalid",
        "View discovery cannot follow linked directories.",
      );
    if (entry.isDirectory() && !entry.name.startsWith(".")) names.push(entry.name);
  }
  return names.sort();
}
