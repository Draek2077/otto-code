/**
 * A read that failed because nothing is at the path. The daemon forwards the
 * filesystem error text, so ENOENT is the only stable marker; anything else
 * (a directory at the path, a permission error) is a real failure, not a file
 * waiting to be created.
 */
export function isMissingFileError(message: string | null | undefined): boolean {
  return message != null && /\bENOENT\b/.test(message);
}
