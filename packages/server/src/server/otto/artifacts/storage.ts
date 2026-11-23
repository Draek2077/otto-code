import path from "node:path";
import { readdir, lstat } from "node:fs/promises";
import { z } from "zod";
import {
  ArtifactLocation,
  ArtifactSource,
  ArtifactRun,
  type ArtifactSummary,
} from "@getpaseo/plugin/otto/artifacts";
import { artifactData, validateArtifactHtml } from "./content.js";
import { digest, missing, readBounded, safeDirectory, safeId, ArtifactError } from "./files.js";

export const StoredArtifact = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(200),
    description: z.string().max(12000),
    projectId: z.string(),
    status: z.enum(["generating", "ready", "error"]),
    starred: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    generationProvider: z.string().nullable(),
    generationModel: z.string().nullable(),
    generationHostId: z.string().optional(),
    source: ArtifactSource.nullable().optional(),
    errorMessage: z.string().nullable(),
    runs: z.array(ArtifactRun.passthrough()).max(20).optional(),
    lastGoodHtml: z.string().max(340000).optional(),
    transcript: z.string().max(16000).optional(),
  })
  .passthrough();
export type StoredArtifact = z.infer<typeof StoredArtifact>;
export interface ArtifactProject {
  projectId: string;
  rootPath: string;
  record: Readonly<Record<string, unknown>>;
  revision: string;
}
export interface ArtifactStore {
  directory: string;
  boundary: string;
  location: z.infer<typeof ArtifactLocation>;
  project: ArtifactProject;
}
export async function storesFor(home: string, project: ArtifactProject): Promise<ArtifactStore[]> {
  const bound = project.record.artifactDirectoryName;
  const inherited = project.record.knowledgeDirectoryName;
  const candidates = [typeof bound === "string" ? bound : null];
  // COMPAT(otto09ArtifactDirectory): added v0.10.0; remove after 2027-04-27 following explicit migration.
  if (!bound && typeof inherited === "string") {
    safeId(inherited);
    try {
      await lstat(path.join(home, "project-artifacts", inherited));
      candidates.push(inherited);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  candidates.push(`project-${digest(project.projectId).slice(0, 32)}`);
  const result: ArtifactStore[] = [
    {
      boundary: project.rootPath,
      directory: path.join(project.rootPath, ".otto", "artifacts"),
      location: "repository",
      project,
    },
  ];
  for (const candidate of new Set(candidates)) {
    if (!candidate) continue;
    safeId(candidate);
    result.push({
      boundary: home,
      directory: path.join(home, "project-artifacts", candidate),
      location: "host",
      project,
    });
  }
  result.push({
    boundary: home,
    directory: path.join(home, "artifacts"),
    location: "legacy",
    project,
  });
  return result;
}
export async function selectedStore(
  stores: ArtifactStore[],
  defaultLocation: "repository" | "host",
) {
  const value = stores[0].project.record.artifactLocation;
  if (value !== null && value !== undefined && value !== "repository" && value !== "host")
    throw new ArtifactError("invalid", "The preserved Artifacts storage choice is invalid.");
  let existingRepository = false;
  try {
    await lstat(stores[0].directory);
    existingRepository = true;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const location = value ?? (existingRepository ? "repository" : defaultLocation);
  return stores.find((store) => store.location === location)!;
}
export function paths(store: ArtifactStore, id: string) {
  safeId(id);
  return {
    record: path.join(store.directory, `${id}.json`),
    html: path.join(store.directory, `${id}.html`),
  };
}
export async function readArtifactAt(store: ArtifactStore, id: string) {
  await safeDirectory(store.boundary, store.directory);
  const files = paths(store, id);
  const raw = await readBounded(files.record);
  if (raw === null) return null;
  let record: StoredArtifact,
    metadataInvalid = false;
  try {
    record = StoredArtifact.parse(JSON.parse(raw));
  } catch (error) {
    const snapshot = await readBounded(`${files.record}.last-good`);
    if (snapshot === null) throw error;
    record = StoredArtifact.parse(JSON.parse(snapshot));
    metadataInvalid = true;
  }
  // COMPAT(otto09ArtifactGrouping): added v0.10.0; remove after 2027-04-29 following explicit store migration.
  const identities = [
    store.project.projectId,
    store.project.rootPath,
    store.project.record.projectKey,
  ];
  if (record.id !== id || !identities.includes(record.projectId)) {
    if (store.location === "legacy") return null;
    throw new ArtifactError("invalid", "Artifact identity does not match its owning project.");
  }
  const html = await readBounded(files.html, 320000);
  // COMPAT(otto09ArtifactSnapshots): added v0.10.0; remove after 2027-04-29 following explicit metadata upgrades.
  // Never follow the old metadata filePath: the canonical owner supplies every path.
  if (!record.lastGoodHtml) {
    const snapshot =
      (await readBounded(`${files.html}.last-good`, 320000)) ??
      (record.status === "generating" ? await readBounded(`${files.html}.bak`, 320000) : null);
    if (snapshot !== null) {
      try {
        validateArtifactHtml(snapshot);
        record = { ...record, lastGoodHtml: snapshot };
      } catch {
        /* A damaged historical snapshot is retained, never promoted. */
      }
    }
  }
  const revision = digest(JSON.stringify([raw, html]));
  let error = record.errorMessage,
    hasData = false,
    previewAvailable = false;
  try {
    if (html === null) throw new Error("missing HTML");
    hasData = artifactData(html) !== null;
    previewAvailable = true;
  } catch {
    if (record.status !== "generating" || html !== null)
      error = [
        error,
        "Artifact HTML is missing or invalid. The external file is preserved; use Repair if a last good version is available.",
      ]
        .filter(Boolean)
        .join(" ");
  }
  if (metadataInvalid) {
    previewAvailable = false;
    error =
      "Artifact metadata is invalid. The original file is preserved. Repair restores the last valid metadata and output after confirmation.";
  }
  let good = false;
  try {
    if (record.lastGoodHtml) {
      validateArtifactHtml(record.lastGoodHtml);
      good = true;
    }
  } catch {
    /* Preserve a damaged recovery snapshot without offering it. */
  }
  const summary: ArtifactSummary = {
    id,
    name: record.name,
    description: record.description,
    projectId: store.project.projectId,
    location: store.location,
    revision,
    status: record.status,
    starred: record.starred,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    error,
    repairAvailable: good,
    previewAvailable,
    hasData,
    source: record.source ?? null,
    provider: record.generationProvider,
    model: record.generationModel,
  };
  return { store, files, record, html, revision, summary, metadataInvalid };
}
export function artifactOrder(a: ArtifactSummary, b: ArtifactSummary) {
  return (
    Number(b.starred) - Number(a.starred) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.id.localeCompare(b.id)
  );
}
export type ArtifactEntry = NonNullable<Awaited<ReturnType<typeof readArtifactAt>>>;
export async function listStore(store: ArtifactStore) {
  await safeDirectory(store.boundary, store.directory);
  let names: string[];
  try {
    names = await readdir(store.directory);
  } catch (error) {
    if (missing(error)) return { items: [], diagnostics: [] };
    throw error;
  }
  if (names.length > 3000)
    throw new ArtifactError(
      "unavailable",
      "This Artifacts directory exceeds 3,000 entries. Narrow the store before browsing.",
    );
  const items: ArtifactEntry[] = [],
    diagnostics: string[] = [];
  for (const file of names.sort()) {
    if (!/^[A-Za-z0-9_-]{1,64}\.json$/.test(file)) continue;
    try {
      const entry = await readArtifactAt(store, file.slice(0, -5));
      if (entry) items.push(entry);
    } catch {
      diagnostics.push(`Cannot read ${store.location} artifact ${file}. Its files were preserved.`);
    }
  }
  return { items, diagnostics };
}
