import type { ProjectKnowledgeListResponseMessage } from "@otto-code/protocol/messages";
import { absolutePathsEqual } from "@/workspace/file-open";

type ProjectKnowledgePayload = ProjectKnowledgeListResponseMessage["payload"];

/** A Knowledge tab can select either a project-map root or an atomic record. */
export type ProjectKnowledgeTabSelection =
  | { kind: "root"; slug: string }
  | { kind: "record"; id: string };

const ROOT_SLUGS = new Set(["background", "architecture", "flow", "mindmap", "stack", "roadmap"]);
const ATOMIC_RECORD_DIRECTORIES = new Set([
  "architectures",
  "constraints",
  "decisions",
  "findings",
  "projects",
  "references",
  "requirements",
]);

/**
 * Repository Knowledge has one fixed, workspace-relative layout, so an
 * Explorer click can select its canonical article without a daemon round trip.
 * Host-local stores deliberately use the catalog matcher below instead: a
 * generic absolute path ending in `/knowledge/` is not proof of ownership.
 */
export function findRepositoryKnowledgeFileSelection(
  path: string,
): ProjectKnowledgeTabSelection | null {
  const normalizedPath = normalizePath(path);
  const marker = ".otto/knowledge/";
  const lowerPath = normalizedPath.toLowerCase();
  const markerIndex = lowerPath.lastIndexOf(marker);
  if (markerIndex < 0 || (markerIndex > 0 && normalizedPath[markerIndex - 1] !== "/")) {
    return null;
  }

  const relativePath = normalizedPath.slice(markerIndex + marker.length);
  const segments = relativePath.split("/");
  if (!isMarkdownFilePath(relativePath)) return null;
  const filename = segments.at(-1)?.slice(0, -3).trim();
  if (!filename) return null;

  if (segments.length === 1 && ROOT_SLUGS.has(filename.toLowerCase())) {
    return { kind: "root", slug: filename };
  }
  if (segments.length === 2 && ATOMIC_RECORD_DIRECTORIES.has(segments[0]?.toLowerCase() ?? "")) {
    return { kind: "record", id: filename };
  }
  return null;
}

/**
 * A document opens through Manage Knowledge only when it is a canonical
 * Knowledge article. Store metadata and optional project guidance remain
 * ordinary Markdown files with their own File Editor workflows.
 */
export function findProjectKnowledgeFileSelection(input: {
  path: string;
  view: ProjectKnowledgePayload;
}): ProjectKnowledgeTabSelection | null {
  for (const root of input.view.rootPages ?? []) {
    if (knowledgePathsMatch(input.path, root.path, root.absolutePath)) {
      return { kind: "root", slug: root.slug };
    }
  }
  for (const record of input.view.records) {
    if (knowledgePathsMatch(input.path, record.path, record.absolutePath)) {
      return { kind: "record", id: record.id };
    }
  }
  return null;
}

/** Fast guard before asking the daemon for the on-demand Knowledge catalog. */
export function isMarkdownFilePath(path: string): boolean {
  return /\.md$/i.test(path.trim());
}

function knowledgePathsMatch(
  candidate: string,
  relativePath: string | undefined,
  absolutePath: string | undefined,
): boolean {
  const normalizedCandidate = normalizePath(candidate);
  if (!normalizedCandidate) return false;
  if (relativePath && normalizedCandidate === normalizePath(relativePath)) return true;
  return Boolean(
    absolutePath && absolutePathsEqual(normalizedCandidate, normalizePath(absolutePath)),
  );
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}
