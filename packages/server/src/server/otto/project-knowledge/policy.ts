import path from "node:path";
import { readKnowledgeFile } from "./knowledge-files.js";
import { digest } from "./markdown-page.js";
import type { KnowledgeStore } from "./store-resolver.js";

// COMPAT(optionalKnowledgePolicy): added in v0.10.0; remove after 2027-04-24
// when the supported floor no longer uses generated 0.9 policy entry files.
// Exact LF-normalized signatures from frozen 95a19522a, with golden fixtures.
const GENERATED = new Set([
  "e271653e89d7f5ab030d2f7b782483149ef323144bf9792981962eed2e317187",
  "0befba3efb3d2ff27441768199d80362ed3bf7c1b2f1f4b14c66a5c050a92b4c",
  "12b159b8031dad7a1050a63c5462d28c40f309999d1ff6bfc98e86b8628105d9",
]);
export function hasCustomKnowledgePolicy(body: string | null): boolean {
  if (!body?.trim()) return false;
  return !GENERATED.has(digest(body.replace(/\r\n/g, "\n")));
}
export async function readKnowledgePolicy(store: KnowledgeStore) {
  const body = await readKnowledgeFile(store, path.join(store.base, "KNOWLEDGE.md"));
  if (body !== null && body.length > 524288)
    throw new Error("Knowledge policy exceeds its read limit");
  return body === null
    ? null
    : { body, revision: digest(body), custom: hasCustomKnowledgePolicy(body) };
}
