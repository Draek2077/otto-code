import { createWorkspaceImageBase } from "./workspace-image-source";
import { headingAnchorSlug } from "@/editor/markdown/markdown-link-completion";
import { containRelativePath } from "@/utils/path";

export type WorkspaceMarkdownLinkTarget =
  | { kind: "external" }
  | { kind: "workspace"; path: string; anchor?: string }
  | { kind: "invalid"; reason: string };

/** Any URI scheme, including a Windows drive letter, is never a workspace path. */
const HAS_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function resolveLocalPath(input: {
  rawPath: string;
  documentDir: string;
}): WorkspaceMarkdownLinkTarget | { kind: "path"; path: string } {
  const decodedPath = decode(input.rawPath);
  if (!decodedPath) {
    return { kind: "invalid", reason: "The Markdown file target is invalid." };
  }
  const normalizedPath = decodedPath.replace(/\\/g, "/");
  if (
    !normalizedPath ||
    HAS_SCHEME.test(normalizedPath) ||
    normalizedPath.startsWith("//") ||
    /^[A-Za-z]:/.test(normalizedPath)
  ) {
    return { kind: "invalid", reason: "The Markdown link does not name a workspace file." };
  }
  let combined = normalizedPath;
  if (normalizedPath.startsWith("/")) {
    combined = normalizedPath.slice(1);
  } else if (input.documentDir) {
    combined = `${input.documentDir}/${normalizedPath}`;
  }
  const path = containRelativePath(combined);
  return path
    ? { kind: "path", path }
    : { kind: "invalid", reason: "The Markdown link escapes this workspace." };
}

/**
 * Resolves the local half of a Markdown href before a rendered document can
 * fall through to the outbound-link opener. The image resolver owns the same
 * workspace containment policy; this only broadens the allowed file types.
 */
export function resolveWorkspaceMarkdownLink(input: {
  href: string;
  workspaceRoot: string;
  documentPath: string;
}): WorkspaceMarkdownLinkTarget {
  const href = input.href.trim();
  if (!href || HAS_SCHEME.test(href) || href.startsWith("//")) {
    return { kind: "external" };
  }

  const hash = href.indexOf("#");
  const rawPath = hash < 0 ? href : href.slice(0, hash);
  const rawAnchor = hash < 0 ? null : href.slice(hash + 1);
  if (rawPath.includes("?")) {
    return { kind: "invalid", reason: "Markdown document links cannot include a query string." };
  }
  const decodedAnchor = rawAnchor === null ? null : decode(rawAnchor);
  const anchor = decodedAnchor === null ? null : headingAnchorSlug(decodedAnchor);
  if (rawAnchor !== null && !anchor) {
    return { kind: "invalid", reason: "The Markdown heading target is invalid." };
  }

  const base = createWorkspaceImageBase({
    serverId: "markdown-link-resolution",
    workspaceRoot: input.workspaceRoot,
    documentPath: input.documentPath,
  });
  if (!base) {
    return {
      kind: "invalid",
      reason: "This document is outside the workspace, so its local links cannot be opened safely.",
    };
  }

  if (!rawPath) {
    return { kind: "workspace", path: input.documentPath, ...(anchor ? { anchor } : {}) };
  }

  const resolvedPath = resolveLocalPath({ rawPath, documentDir: base.documentDir });
  if (resolvedPath.kind !== "path") return resolvedPath;
  return { kind: "workspace", path: resolvedPath.path, ...(anchor ? { anchor } : {}) };
}
