export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Collapse `.` and `..` in a relative POSIX path, refusing anything that climbs
 * above its own root.
 *
 * This is the containment primitive: `null` means "this path escapes", and every
 * caller treats that as a refusal rather than as something to clamp. `""` means
 * the path resolved to the root itself, which callers interpret for themselves.
 *
 * The input must already be relative — an absolute path has a root of its own and
 * this function would silently treat it as relative to the caller's.
 */
export function containRelativePath(pathValue: string): string | null {
  const resolvedSegments: string[] = [];
  for (const segment of pathValue.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolvedSegments.length === 0) {
        return null;
      }
      resolvedSegments.pop();
      continue;
    }
    resolvedSegments.push(segment);
  }
  return resolvedSegments.join("/");
}
