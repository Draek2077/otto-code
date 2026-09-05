import {
  realpathSync,
  watch,
  type FSWatcher,
  type WatchListener,
  type WatchOptions,
} from "node:fs";

/** Keep native watcher roots in the same spelling as Windows change events. */
export function watchDirectory(
  directory: string,
  options: WatchOptions,
  listener: WatchListener<string>,
): FSWatcher {
  // libuv aborts the process when an 8.3 root differs from the full path in a
  // directory-change notification. This belongs at the OS boundary: callers
  // retain their original paths for protocol identities and cache keys.
  const root = process.platform === "win32" ? realpathSync.native(directory) : directory;
  return watch(root, options, listener);
}
