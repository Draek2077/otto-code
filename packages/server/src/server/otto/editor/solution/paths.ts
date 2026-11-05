import { isAbsolute, relative, resolve } from "node:path";
import { isInside } from "../lsp/uri.js";

/**
 * The one place a path crosses between "somewhere on this machine" and "something the client can
 * open".
 *
 * Two hazards this exists to contain, both of which were called out before a line was written:
 *
 * - **Separators.** The solution libraries return platform separators even for a `.slnx` that
 *   stores forward slashes. The sidecar normalises on its way out; this module keeps that
 *   property on the daemon side so nothing downstream has to care.
 * - **Case.** Linux paths are case-sensitive where Windows and macOS are not, so comparing raw
 *   strings gets containment wrong in both directions. `documentKey` is the existing discipline
 *   for exactly this and is reused rather than re-derived.
 */

/** Absolute and forward-slashed. */
export function toPosixAbsolute(path: string): string {
  return resolve(path).replace(/\\/g, "/");
}

/** Forward slashes, no trailing separator, nothing else changed. */
export function toPosix(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  return slashed.length > 1 && slashed.endsWith("/") && !slashed.endsWith(":/")
    ? slashed.slice(0, -1)
    : slashed;
}

export function isInsideWorkspace(root: string, candidate: string): boolean {
  // Use the owning host's path semantics. Identity keys may contain native
  // backslashes, so appending a POSIX slash to one is not containment.
  return isInside(toPosixAbsolute(root), toPosixAbsolute(candidate));
}

export interface WirePath {
  /** Workspace-relative when inside, absolute when not. Forward slashes either way. */
  path: string;
  outsideWorkspace: boolean;
}

/**
 * How a path reaches the client.
 *
 * Inside the workspace it is relative, which is what the existing file-open path already takes -
 * that is the whole reason opening a file from this view needs no new tab machinery. Outside it
 * stays absolute and is flagged, so the client never has to infer the distinction by inspecting
 * the string. The flag is the out-of-workspace policy made legible: shown and opened normally,
 * warned on edit, absent from every git surface.
 */
export function toWirePath(root: string, absolutePath: string): WirePath {
  const absolute = toPosixAbsolute(absolutePath);
  if (!isInsideWorkspace(root, absolute)) {
    return { path: absolute, outsideWorkspace: true };
  }
  const relativePath = toPosix(relative(toPosixAbsolute(root), absolute));
  // A path that resolves to the root itself is the root; "." is what the explorer calls it.
  return { path: relativePath.length === 0 ? "." : relativePath, outsideWorkspace: false };
}

/**
 * The inverse, for a path arriving from the client. An absolute one is honoured as-is: the
 * solution named it, and refusing here would break the very case the out-of-workspace policy
 * settled.
 */
export function fromWirePath(root: string, wirePath: string): string {
  return isAbsolute(wirePath) || /^[A-Za-z]:\//.test(wirePath)
    ? toPosixAbsolute(wirePath)
    : toPosixAbsolute(resolve(root, wirePath));
}
