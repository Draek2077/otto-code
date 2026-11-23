import path from "node:path";
import type { ViewStore, Stored, PublishedRecord } from "./records.js";
import {
  readPublishedAt,
  readViewFile,
  readSpecification,
  viewDirectory,
  viewDirectories,
  recordKind,
} from "./records.js";
import { ArchitecturalViewError } from "./specification.js";
import { replaceKnowledgeFile } from "../project-knowledge/knowledge-files.js";

/** Prior bytes are retained before publishing a new pointer; no history is pruned. */
export async function retainViewRevision(
  store: ViewStore,
  viewId: string,
  previous: Stored<PublishedRecord>,
): Promise<void> {
  const directory = path.join(viewDirectory(store, viewId), "revisions", previous.revision);
  const file = path.join(directory, "view.json");
  const existing = await readViewFile(store, file);
  if (existing !== null) {
    if (existing !== previous.raw)
      throw new ArchitecturalViewError("conflict", "The retained View revision changed.");
    await readSpecification(store, viewId, { ...previous, directory });
    return;
  }
  if (!previous.value.ottoPublication) {
    // COMPAT(otto09ViewHistory): added v0.10.0; remove after 2027-05-09 following explicit legacy conversion.
    for (const name of [`view.${recordKind(previous.value)}.json`, "receipt.json"]) {
      const raw = await readViewFile(store, path.join(previous.directory, name));
      if (raw === null) {
        if (name === "receipt.json") continue;
        throw new ArchitecturalViewError(
          "not_found",
          "The old View source is missing. Publication did not replace it.",
        );
      }
      const destination = path.join(directory, name);
      const retained = await readViewFile(store, destination);
      if (retained !== null && retained !== raw)
        throw new ArchitecturalViewError("conflict", "Retained View source changed.");
      if (retained === null)
        await replaceKnowledgeFile({ store, file: destination, expectedRevision: null, body: raw });
    }
  }
  await readSpecification(store, viewId, { ...previous, directory });
  await replaceKnowledgeFile({ store, file, expectedRevision: null, body: previous.raw });
}
export async function viewRevisionRecords(
  store: ViewStore,
  viewId: string,
): Promise<Array<Stored<PublishedRecord>>> {
  const root = path.join(viewDirectory(store, viewId), "revisions");
  const records: Array<Stored<PublishedRecord>> = [];
  let bytes = 0;
  for (const name of await viewDirectories(store, root, 2000)) {
    if (!/^(?:[a-f0-9]{64}|published-[0-9TZ-]{10,80})$/.test(name))
      throw new ArchitecturalViewError(
        "invalid",
        "Unknown View history directory. Original files were retained.",
      );
    const record = await readPublishedAt(store, viewId, path.join(root, name));
    if (!record)
      throw new ArchitecturalViewError(
        "not_found",
        "A retained View revision is missing its metadata.",
      );
    bytes += Buffer.byteLength(record.raw);
    if (bytes > 16777216)
      throw new ArchitecturalViewError(
        "invalid",
        "View history exceeds the inspection budget. Use the owning host to inspect it.",
      );
    records.push(record);
  }
  return records.sort((left, right) => right.value.renderedAt.localeCompare(left.value.renderedAt));
}
export async function findViewRevision(store: ViewStore, viewId: string, revision: string) {
  const record = await readPublishedAt(
    store,
    viewId,
    path.join(viewDirectory(store, viewId), "revisions", revision),
  );
  if (record) {
    if (record.revision !== revision)
      throw new ArchitecturalViewError(
        "invalid",
        "Retained View metadata does not match its revision.",
      );
    return record;
  }
  const legacy = (await viewRevisionRecords(store, viewId)).find(
    (candidate) => candidate.revision === revision,
  );
  if (!legacy)
    throw new ArchitecturalViewError("not_found", "The requested View revision is unavailable.");
  return legacy;
}
