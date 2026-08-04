// Which documents a prose file points at.
//
// Refine's references list means "read these to understand what this file is
// part of". For a document, what it is part of is largely what it links to: an
// index is defined by its entries, an instruction file by the docs it defers
// to. Compaction gets that context handed to it by Context Management, which
// already holds a graph; a file opened from the editor has no graph, so it has
// to read its own links - which is what makes a plain Refine over a document as
// project-aware as a compaction, with a different objective.
//
// Discovery only ever produces READ-ONLY references. A file arriving here can
// never be rewritten unless the user marks it so in the working-set strip, so a
// mangled link costs a wasted read, never an edit to the wrong file.

import { isRefinableDocument } from "./refine-scope";

/** `[text](target)`, with an optional `"title"` after the target. */
const MARKDOWN_LINK = /\[[^\]\n]*\]\(\s*<?([^)>\s]+)>?(?:\s+"[^"]*")?\s*\)/g;

/**
 * Claude's `@path` import syntax, as used in CLAUDE.md and memory indexes. The
 * target must carry an extension: a bare `@name` is a mention, not a file.
 */
const AT_IMPORT = /(?:^|[\s(])@([./\\]*[\w./\\-]+\.[A-Za-z0-9]+)/g;

/**
 * A scheme needs two or more characters before the colon, so `http:` and
 * `mailto:` are excluded while the Windows drive letter in `C:/x` is not.
 */
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/** Every raw link target in a document, in the order they appear. */
export function extractLinkTargets(content: string): string[] {
  const targets: string[] = [];
  for (const match of content.matchAll(MARKDOWN_LINK)) {
    if (match[1]) {
      targets.push(match[1]);
    }
  }
  for (const match of content.matchAll(AT_IMPORT)) {
    if (match[1]) {
      targets.push(match[1]);
    }
  }
  return targets;
}

/** One comparison form for a path, so `\` vs `/` and case never split a file in two. */
export function refinePathKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/**
 * Resolve a link target against the linking file's directory. Returns null for
 * anything that is not a path into the filesystem - URLs, bare anchors, mail
 * addresses, and `~` targets whose home we cannot know from here.
 */
export function resolveLinkTarget(fromDir: string, target: string): string | null {
  const cleaned = (target.split("#")[0] ?? "").split("?")[0]?.trim() ?? "";
  if (!cleaned || cleaned.startsWith("~") || URL_SCHEME.test(cleaned)) {
    return null;
  }
  const normalized = cleaned.replace(/\\/g, "/");
  if (isAbsolutePath(normalized)) {
    return normalizeSegments(normalized);
  }
  const base = fromDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) {
    return null;
  }
  return normalizeSegments(`${base}/${normalized}`);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:\//.test(path);
}

/** Collapse `.` and `..` without touching the filesystem - these paths may not exist. */
function normalizeSegments(path: string): string {
  const drive = /^[a-zA-Z]:\//.exec(path)?.[0];
  const prefix = drive ?? (path.startsWith("/") ? "/" : "");
  const segments: string[] = [];
  for (const segment of path.slice(prefix.length).split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return prefix + segments.join("/");
}

/**
 * A cap on how many links one document drags in.
 *
 * Small on purpose. Every reference is read and then sent, so an index with
 * sixty entries would spend the request's whole budget on context before the
 * document it is meant to be rewriting. The user can add more from the tab.
 */
export const MAX_REFINE_LINKED_DOCUMENTS = 8;

export interface LinkedDocumentsInput {
  /** The linking document's content. */
  content: string;
  /** Its absolute path - link targets resolve against its directory. */
  absolutePath: string;
  /** Paths already in the working set, in any separator or case. */
  exclude?: readonly string[];
  max?: number;
}

/**
 * The prose documents this file links to, resolved to absolute paths.
 *
 * Prose only, by the same gate the entry point uses: a document that links to
 * source is common, and pulling a 4,000-line module in as "context" would spend
 * the request on something no rewrite of a paragraph needs.
 */
export function linkedDocumentsFor(input: LinkedDocumentsInput): string[] {
  const fromDir = directoryOf(input.absolutePath);
  if (!fromDir) {
    return [];
  }
  const seen = new Set((input.exclude ?? []).map(refinePathKey));
  seen.add(refinePathKey(input.absolutePath));
  const found: string[] = [];
  const max = input.max ?? MAX_REFINE_LINKED_DOCUMENTS;
  for (const target of extractLinkTargets(input.content)) {
    if (found.length >= max) {
      break;
    }
    const resolved = resolveLinkTarget(fromDir, target);
    if (!resolved || !isRefinableDocument(resolved)) {
      continue;
    }
    const key = refinePathKey(resolved);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    found.push(resolved);
  }
  return found;
}

function directoryOf(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  const cut = normalized.lastIndexOf("/");
  return cut <= 0 ? "" : normalized.slice(0, cut);
}
