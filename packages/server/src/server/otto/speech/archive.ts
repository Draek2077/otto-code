import path from "node:path";

/** GNU tar interprets C: in an archive argument as a remote host. Resolve the
 * archive through cwd and its basename, without platform-specific flags or a
 * second extractor. -C is an ordinary destination argument, not an archive URL.
 */
export function speechArchiveCommand(
  archive: string,
  destination: string,
  windows = process.platform === "win32",
) {
  const paths = windows ? path.win32 : path;
  if (!paths.isAbsolute(archive) || !paths.isAbsolute(destination))
    throw new Error("Speech archive extraction requires absolute host paths.");
  return { args: ["xf", paths.basename(archive), "-C", destination], cwd: paths.dirname(archive) };
}
