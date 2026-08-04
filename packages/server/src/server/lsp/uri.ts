import { isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Language servers speak `file://` URIs; the daemon speaks filesystem paths.
 * Node's WHATWG conversion already handles drive letters, UNC shares (including
 * `\\wsl$\...`) and percent-encoding, so this module only adds the boundary
 * checks and - the part stdlib cannot give us - a canonical identity key.
 *
 * The key matters because a server may echo a document back in a different but
 * equivalent spelling: we send `file:///C:/a/b.ts`, tsserver answers with
 * `file:///c%3A/a/b.ts`. Same file, different string, so anything keyed on the
 * raw URI silently loses the binding. Every map keyed by document uses
 * `documentKey`, never a URI.
 */

export class NotAFileUriError extends Error {
  readonly uri: string;

  constructor(uri: string) {
    super(`Expected a file:// uri, received: ${uri}`);
    this.name = "NotAFileUriError";
    this.uri = uri;
  }
}

export class RelativePathError extends Error {
  readonly path: string;

  constructor(filePath: string) {
    super(`Expected an absolute path, received: ${filePath}`);
    this.name = "RelativePathError";
    this.path = filePath;
  }
}

export function toFileUri(filePath: string): string {
  if (!isAbsolute(filePath)) {
    throw new RelativePathError(filePath);
  }
  return pathToFileURL(filePath).toString();
}

export function fromFileUri(uri: string): string {
  if (!uri.startsWith("file:")) {
    throw new NotAFileUriError(uri);
  }
  return fileURLToPath(uri);
}

/**
 * Canonical identity for a document, accepting either a path or a `file://` URI.
 * Forward slashes throughout and an upper-cased drive letter, because `c:` and
 * `C:` are the same file on Windows. The rest of the path keeps its case - POSIX
 * filesystems are case-sensitive and lower-casing would merge distinct files.
 */
export function documentKey(filePathOrUri: string): string {
  const filePath = filePathOrUri.startsWith("file:") ? fromFileUri(filePathOrUri) : filePathOrUri;
  const slashed = filePath.replace(/\\/g, "/");
  return slashed.replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`);
}
