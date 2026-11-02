/** POSIX single quoting preserves the actual filename without evaluating shell syntax. */
export function quoteTerminalPath(path: string): string {
  return `'${path.replace(/'/g, "'\"'\"'")}'`;
}
