import { createServerFn } from "@tanstack/react-start";
import { getBlockingColdCache } from "./github-cache";

interface GitHubAsset {
  name: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
  prerelease: boolean;
  draft: boolean;
}

const LINUX_APPIMAGE_ASSET_PATTERN =
  /^Otto-(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)-)?x86_64\.AppImage$/;

const MAC_ARM64_ASSET_PATTERN = /^Otto-.*-arm64-unsigned\.dmg$/;
const MAC_X64_ASSET_PATTERN = /^Otto-.*-x64-unsigned\.dmg$/;

// macOS stays out of the required set on purpose. The mac jobs can finish after
// the release publishes, and `finalize-rollout` tolerates a failed mac build so
// Windows/Linux still ship — requiring a mac asset here would pin the whole site
// to an older release whenever mac alone fails. Missing mac assets degrade to
// "no mac links" instead.
const REQUIRED_ASSET_PATTERNS = [
  LINUX_APPIMAGE_ASSET_PATTERN, // Linux AppImage
  /Otto-Setup-.*\.exe$/, // Windows (any arch)
];

function hasRequiredAssets(release: GitHubRelease): boolean {
  return REQUIRED_ASSET_PATTERNS.every((pattern) =>
    release.assets.some((asset) => pattern.test(asset.name)),
  );
}

function pickWindowsAssets(assets: GitHubAsset[]) {
  const x64Suffixed = assets.find((a) => /Otto-Setup-.*-x64\.exe$/.test(a.name));
  const arm64 = assets.find((a) => /Otto-Setup-.*-arm64\.exe$/.test(a.name));
  const legacy = assets.find(
    (a) =>
      /Otto-Setup-.*\.exe$/.test(a.name) &&
      !a.name.endsWith("-x64.exe") &&
      !a.name.endsWith("-arm64.exe"),
  );
  return {
    x64: (x64Suffixed ?? legacy)?.name ?? null,
    arm64: arm64?.name ?? null,
  };
}

function pickLinuxAppImageAsset(assets: GitHubAsset[]) {
  return assets.find((a) => LINUX_APPIMAGE_ASSET_PATTERN.test(a.name))?.name ?? null;
}

function pickMacAssets(assets: GitHubAsset[]) {
  return {
    arm64: assets.find((a) => MAC_ARM64_ASSET_PATTERN.test(a.name))?.name ?? null,
    x64: assets.find((a) => MAC_X64_ASSET_PATTERN.test(a.name))?.name ?? null,
  };
}

function versionFromTag(tag: string): string {
  return tag.replace(/^v/, "");
}

interface ReleaseInfo {
  version: string;
  linuxAppImageAsset: string;
  windowsX64Asset: string | null;
  windowsArm64Asset: string | null;
  macArm64Asset: string | null;
  macX64Asset: string | null;
}

const GITHUB_RELEASES_URL = "https://api.github.com/repos/Draek2077/otto-code/releases?per_page=10";
const RELEASE_CACHE_KEY = "github-release:v1";

async function fetchLatestReadyRelease(): Promise<ReleaseInfo> {
  const res = await fetch(GITHUB_RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "otto-website",
    },
    cf: {
      cacheEverything: true,
      cacheTtl: 60,
      cacheKey: "github-releases-latest",
    },
  } as RequestInit);
  if (!res.ok) throw new Error(`github releases ${res.status}`);

  const releases = (await res.json()) as GitHubRelease[];
  const ready = releases.find((r) => !r.prerelease && !r.draft && hasRequiredAssets(r));
  if (!ready) throw new Error("no ready GitHub release found");
  const win = pickWindowsAssets(ready.assets);
  const mac = pickMacAssets(ready.assets);
  const linuxAppImageAsset = pickLinuxAppImageAsset(ready.assets);
  if (!linuxAppImageAsset) throw new Error("ready release missing Linux AppImage asset");
  return {
    version: versionFromTag(ready.tag_name),
    linuxAppImageAsset,
    windowsX64Asset: win.x64,
    windowsArm64Asset: win.arm64,
    macArm64Asset: mac.arm64,
    macX64Asset: mac.x64,
  };
}

function isReleaseInfo(value: unknown): value is ReleaseInfo {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(record.version) &&
    typeof record.linuxAppImageAsset === "string" &&
    (record.linuxAppImageAsset === "Otto-x86_64.AppImage" ||
      new RegExp(`^Otto-${record.version.replaceAll(".", "\\.")}-x86_64\\.AppImage$`).test(
        record.linuxAppImageAsset,
      )) &&
    (typeof record.windowsX64Asset === "string" || record.windowsX64Asset === null) &&
    (typeof record.windowsArm64Asset === "string" || record.windowsArm64Asset === null) &&
    (record.windowsX64Asset === null ||
      new RegExp(`^Otto-Setup-${record.version.replaceAll(".", "\\.")}(?:-x64)?\\.exe$`).test(
        record.windowsX64Asset,
      )) &&
    (record.windowsArm64Asset === null ||
      new RegExp(`^Otto-Setup-${record.version.replaceAll(".", "\\.")}-arm64\\.exe$`).test(
        record.windowsArm64Asset,
      )) &&
    // Mac fields arrived after this cache key shipped, so a value cached by an
    // older deploy has them absent. Treating undefined as valid keeps that entry
    // usable (readers coerce to null) instead of forcing a cold refetch.
    isOptionalMacAsset(record.macArm64Asset, record.version, "arm64") &&
    isOptionalMacAsset(record.macX64Asset, record.version, "x64")
  );
}

function isOptionalMacAsset(value: unknown, version: string, arch: "arm64" | "x64"): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return new RegExp(`^Otto-${version.replaceAll(".", "\\.")}-${arch}-unsigned\\.dmg$`).test(value);
}

export const getLatestRelease = createServerFn({ method: "GET" }).handler(async () => {
  return getBlockingColdCache({
    key: RELEASE_CACHE_KEY,
    isValue: isReleaseInfo,
    fetchFresh: fetchLatestReadyRelease,
  });
});
