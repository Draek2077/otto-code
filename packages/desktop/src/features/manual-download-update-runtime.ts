import { z } from "zod";
import type {
  AppUpdateRuntime,
  AppUpdateRuntimeConfiguration,
  RuntimeUpdateCheckResult,
  RuntimeUpdateInfo,
} from "./app-update-service.js";

// Update runtime for builds that cannot replace themselves in place.
//
// macOS is the only such platform today. This fork has no Apple Developer
// identity, so mac builds ship unsigned — arm64 gets an ad-hoc signature
// (arm64 refuses to execute without one) and x64 gets nothing at all. An ad-hoc
// signature's designated requirement is derived from the cdhash, which changes
// on every build, so Squirrel.Mac can never satisfy the running app's
// requirement with a replacement bundle. That makes in-place update impossible
// rather than merely unconfigured, which is why releases deliberately publish
// no `latest-mac.yml`.
//
// Left on the electron-updater path, a mac install would ask GitHub for that
// missing manifest, 404, and hold a permanent update error. So instead we ask
// the releases API directly and report what we find; installing is a link to
// the download page, which carries the Gatekeeper instructions the artifact
// needs anyway.
//
// COMPAT(macOS-signing): delete this runtime and its wiring once Apple signing
// is configured and mac releases publish a real manifest.

const GITHUB_RELEASES_URL = "https://api.github.com/repos/Draek2077/otto-code/releases?per_page=10";

/** Where "Update now" sends a manual-download user. Carries the install steps. */
export const MANUAL_DOWNLOAD_URL = "https://otto-code.me/download";

const releaseSchema = z.object({
  tag_name: z.string(),
  body: z.string().nullish(),
  published_at: z.string().nullish(),
  draft: z.boolean().nullish(),
  prerelease: z.boolean().nullish(),
  assets: z.array(z.object({ name: z.string() })).nullish(),
});

const releaseListSchema = z.array(releaseSchema);

export type GitHubReleaseSummary = z.infer<typeof releaseSchema>;

interface ParsedVersion {
  release: number[];
  prerelease: string[];
}

function parseVersion(version: string): ParsedVersion {
  const [releasePart = "", prereleasePart = ""] = version.replace(/^v/, "").split("-", 2);
  return {
    release: releasePart.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: prereleasePart ? prereleasePart.split(".") : [],
  };
}

/**
 * Semver-shaped comparison, enough for our own tags: `1.2.3` and
 * `1.2.3-beta.4`. Returns >0 when `a` is newer. A prerelease sorts before the
 * release it leads to, so 0.6.4-beta.1 < 0.6.4.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);

  const length = Math.max(left.release.length, right.release.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left.release[i] ?? 0) - (right.release[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < prereleaseLength; i += 1) {
    const leftPart = left.prerelease[i];
    const rightPart = right.prerelease[i];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftNumber = Number.parseInt(leftPart, 10);
    const rightNumber = Number.parseInt(rightPart, 10);
    const bothNumeric = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber);
    if (bothNumeric) return leftNumber - rightNumber;
    return leftPart < rightPart ? -1 : 1;
  }

  return 0;
}

/**
 * Newest release the given channel should see. Requires a mac artifact to be
 * attached: the mac jobs can finish after the release is published, and a
 * release whose mac build failed has nothing for this user to download.
 */
export function pickRelease(
  releases: GitHubReleaseSummary[],
  channel: "stable" | "beta",
  hasDownloadableAsset: (assetName: string) => boolean,
): GitHubReleaseSummary | null {
  const candidates = releases.filter((release) => {
    if (release.draft) return false;
    if (channel === "stable" && release.prerelease) return false;
    return (release.assets ?? []).some((asset) => hasDownloadableAsset(asset.name));
  });

  let newest: GitHubReleaseSummary | null = null;
  for (const candidate of candidates) {
    if (!newest || compareVersions(candidate.tag_name, newest.tag_name) > 0) {
      newest = candidate;
    }
  }
  return newest;
}

function isMacDownload(assetName: string): boolean {
  return assetName.endsWith("-unsigned.dmg");
}

export interface ManualDownloadUpdateRuntimeOptions {
  currentVersion(): string;
  /** Injected in tests; defaults to the releases API. */
  fetchReleases?(): Promise<unknown>;
  hasDownloadableAsset?(assetName: string): boolean;
}

export class ManualDownloadUpdateRuntime implements AppUpdateRuntime {
  private configuration: AppUpdateRuntimeConfiguration | null = null;
  private latestKnownVersion: string | null = null;

  constructor(private readonly options: ManualDownloadUpdateRuntimeOptions) {}

  /** Version of the newest release seen, for the "Update now" message. */
  get latestVersion(): string | null {
    return this.latestKnownVersion;
  }

  configure(input: AppUpdateRuntimeConfiguration): void {
    this.configuration = input;
  }

  async checkForUpdates(): Promise<RuntimeUpdateCheckResult | null> {
    const configuration = this.configuration;
    if (!configuration) return null;

    let releases: GitHubReleaseSummary[];
    try {
      const payload = await (this.options.fetchReleases?.() ?? fetchReleases());
      releases = releaseListSchema.parse(payload);
    } catch (error) {
      configuration.onError(error);
      throw error;
    }

    const hasDownloadableAsset = this.options.hasDownloadableAsset ?? isMacDownload;
    const release = pickRelease(releases, configuration.releaseChannel, hasDownloadableAsset);
    if (!release) {
      this.latestKnownVersion = null;
      configuration.onUpdateNotAvailable();
      return null;
    }

    const info: RuntimeUpdateInfo = {
      version: release.tag_name.replace(/^v/, ""),
      releaseNotes: release.body ?? undefined,
      releaseDate: release.published_at ?? undefined,
    };
    this.latestKnownVersion = info.version;

    if (compareVersions(info.version, this.options.currentVersion()) <= 0) {
      configuration.onUpdateNotAvailable();
      return { isUpdateAvailable: false, updateInfo: info };
    }

    // Staged rollout still applies. Releases carry no rolloutHours here (that
    // lives in the manifests we don't publish for mac), so shouldAdmitUpdate
    // admits immediately — the call is kept so a future manifest source works
    // without touching this runtime.
    const admitted = await configuration.shouldAdmitUpdate(info);
    return { isUpdateAvailable: admitted, updateInfo: info };
  }

  downloadUpdate(): Promise<unknown> {
    // Callers route "Update now" through the manual-download path instead; this
    // only fires if that wiring is ever bypassed.
    return Promise.reject(
      new Error("This build must be updated by downloading the new version manually."),
    );
  }

  quitAndInstall(): void {
    console.warn("[auto-updater] Ignoring quitAndInstall: this build cannot install in place.");
  }
}

async function fetchReleases(): Promise<unknown> {
  const response = await fetch(GITHUB_RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "otto-desktop",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub releases request failed: ${response.status}`);
  }
  return response.json();
}
