/** Nix's glibc Node cannot load extract-zip's colocated musl variant. Keep its real binding strict. */
export function includeTracedNativeFile(file, { platform, glibcVersion }) {
  if (platform !== "linux" || !glibcVersion) return true;
  return !/^node_modules\/@electron-internal\/extract-zip\/index\.linux-[a-z0-9_-]+-musl\.node$/.test(
    file.replaceAll("\\", "/"),
  );
}
