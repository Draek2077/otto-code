/**
 * Write `toFile` as a path relative to the document at `fromFile`.
 *
 * Both are workspace-relative with `/` separators, which is what
 * `code.list_files` returns. A relative link is what belongs in the file: it
 * survives the directory being moved, and it is what every markdown renderer
 * outside this app resolves. A workspace-relative path would only work here.
 */
export function relativeLinkPath(fromFile: string, toFile: string): string {
  const fromDirectory = fromFile.split("/").slice(0, -1);
  const toSegments = toFile.split("/");
  const toName = toSegments.pop() ?? "";

  let common = 0;
  while (
    common < fromDirectory.length &&
    common < toSegments.length &&
    fromDirectory[common] === toSegments[common]
  ) {
    common += 1;
  }

  const up = Array.from({ length: fromDirectory.length - common }, () => "..");
  return [...up, ...toSegments.slice(common), toName].join("/");
}

/**
 * Percent-encode only what would end the link target early.
 *
 * Deliberately not `encodeURI`: that would also escape non-ASCII, turning a
 * perfectly valid `docs/guía.md` into an unreadable link for no benefit.
 */
export function encodeLinkPath(path: string): string {
  return path.replace(
    /[ ()<>]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
