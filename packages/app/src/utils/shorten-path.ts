/**
 * Shortens a file path by replacing the home directory prefix with ~.
 *
 * Covers macOS (`/Users/name`), Linux (`/home/name`) and Windows
 * (`C:\Users\name`, either slash). Windows used to be left alone, which meant
 * every path on a Windows host rendered with the drive and the account name in
 * front of it - the same nine characters repeated down a list, pushing the part
 * that identifies the file off the end of the row.
 */
export function shortenPath(path: string | undefined | null): string {
  if (!path) {
    return "";
  }
  return path
    .replace(/^\/(?:Users|home)\/[^/]+/, "~")
    .replace(/^[a-zA-Z]:[\\/]Users[\\/][^\\/]+/, "~");
}
