import { containRelativePath, isAbsolutePath } from "@/utils/path";

/**
 * Resolving a document's own images - `![](docs/diagram.png)`,
 * `<img src="packages/website/public/logo.svg">` - against the workspace it
 * lives in, the way GitHub resolves them against the repo.
 *
 * **This module is the security boundary, and it runs before any RPC.** The
 * daemon deliberately does not bound a single-file read to a known workspace
 * (`file-explorer/workspace-files-session.ts`), so a document that names
 * `../../../etc/passwd` would be read if we asked. Containment is therefore
 * ours: nothing reaches `client.readFile` unless it resolved to a path *under*
 * the workspace root.
 *
 * Everything here is pure and synchronous. The fetch lives in
 * `workspace-image-cache.ts`, and it only ever receives paths this module
 * returned.
 */

export interface WorkspaceImageBase {
  /** Which daemon serves the read. */
  serverId: string;
  /** Absolute workspace root; every read is issued with this as the cwd. */
  workspaceRoot: string;
  /**
   * The document's own directory as a workspace-relative POSIX path, `""` at the
   * root. Relative srcs resolve against this; root-relative `/x.png` resolves
   * against the workspace root, which is why both are needed.
   */
  documentDir: string;
}

/**
 * Formats we will fetch. Two jobs: it keeps a badge-heavy document from reading
 * files that could never be drawn, and it means `![](.env)` never becomes a
 * read - the containment check alone would have allowed it.
 */
const WORKSPACE_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
  "avif",
  "heic",
  "heif",
]);

/** Any `scheme:` prefix - `https:`, `data:`, `javascript:`, and `C:` too. */
const HAS_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function safeDecodeURI(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Whether a src is the *shape* this module can resolve: a workspace-relative
 * path rather than a URL. Used by the HTML translation pass, which has to decide
 * whether an `<img>` survives as an image long before a base path is in scope.
 * Passing this is not permission to read anything - {@link resolveWorkspaceImagePath}
 * still has to contain it.
 */
export function isWorkspaceRelativeImageSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
    return false;
  }
  return !HAS_SCHEME.test(trimmed);
}

/**
 * A document-relative src → a workspace-relative path, or `null` when it must
 * not be fetched: a URL of any scheme, a host-absolute path, a path that climbs
 * above the workspace root, or a file that is not an image.
 */
export function resolveWorkspaceImagePath(
  src: string,
  base: Pick<WorkspaceImageBase, "documentDir">,
): string | null {
  const trimmed = src.trim();
  if (!isWorkspaceRelativeImageSrc(trimmed)) {
    return null;
  }

  // Backslashes are separators here too, so `..\..\secrets` cannot slip past the
  // `..` check by spelling itself the other way.
  const withoutSuffix = safeDecodeURI(trimmed.split(/[?#]/, 1)[0] ?? "").replace(/\\/g, "/");
  // A single leading `/` is repo-root-relative and allowed; `//host/share` (a UNC
  // path once its backslashes are folded) and `C:/...` name a host location.
  if (!withoutSuffix || withoutSuffix.startsWith("//") || /^[A-Za-z]:/.test(withoutSuffix)) {
    return null;
  }

  // GitHub semantics: a leading `/` is repo-root-relative, not host-absolute.
  const documentDir = withoutSuffix.startsWith("/") ? "" : base.documentDir;
  const combined = documentDir ? `${documentDir}/${withoutSuffix}` : withoutSuffix;

  const contained = containRelativePath(combined);
  if (!contained || !hasWorkspaceImageExtension(contained)) {
    return null;
  }
  return contained;
}

function hasWorkspaceImageExtension(path: string): boolean {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) {
    return false;
  }
  return WORKSPACE_IMAGE_EXTENSIONS.has(fileName.slice(lastDot + 1).toLowerCase());
}

/**
 * The base a rendered document resolves its images against, or `null` when there
 * is none to be had: no absolute workspace root, or a document that lives outside
 * it. Outside the root there is no boundary to contain against, so the surface
 * simply keeps today's alt-text behavior rather than reading from wherever the
 * document happens to sit.
 */
export function createWorkspaceImageBase(input: {
  serverId: string;
  workspaceRoot: string;
  documentPath: string;
}): WorkspaceImageBase | null {
  const workspaceRoot = normalizeRoot(input.workspaceRoot);
  const documentPath = input.documentPath.trim().replace(/\\/g, "/");
  if (!workspaceRoot || !documentPath) {
    return null;
  }

  const relativeDocument = toWorkspaceRelative(documentPath, workspaceRoot);
  if (relativeDocument === null) {
    return null;
  }

  const lastSlash = relativeDocument.lastIndexOf("/");
  return {
    serverId: input.serverId,
    workspaceRoot,
    documentDir: lastSlash < 0 ? "" : relativeDocument.slice(0, lastSlash),
  };
}

function normalizeRoot(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed || !isAbsolutePath(trimmed)) {
    return null;
  }
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

function toWorkspaceRelative(documentPath: string, workspaceRoot: string): string | null {
  if (!isAbsolutePath(documentPath)) {
    return containRelativePath(documentPath) || null;
  }

  // Windows paths compare case-insensitively; POSIX ones do not. Folding the
  // whole string would make `/Docs` and `/docs` the same workspace on Linux, so
  // only the drive letter is folded.
  const root = foldDriveLetter(workspaceRoot);
  const candidate = foldDriveLetter(documentPath);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!candidate.startsWith(prefix)) {
    return null;
  }
  return containRelativePath(candidate.slice(prefix.length)) || null;
}

function foldDriveLetter(value: string): string {
  return /^[A-Za-z]:/.test(value) ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}
