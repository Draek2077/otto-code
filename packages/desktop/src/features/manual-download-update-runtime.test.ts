import { describe, expect, it, vi } from "vitest";

import {
  compareVersions,
  ManualDownloadUpdateRuntime,
  pickRelease,
  type GitHubReleaseSummary,
} from "./manual-download-update-runtime";
import type { AppUpdateRuntimeConfiguration } from "./app-update-service";

describe("compareVersions", () => {
  it("orders by release parts", () => {
    expect(compareVersions("0.6.4", "0.6.3")).toBeGreaterThan(0);
    expect(compareVersions("0.6.3", "0.6.4")).toBeLessThan(0);
    expect(compareVersions("0.7.0", "0.6.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.6.4", "0.6.4")).toBe(0);
  });

  it("tolerates a leading v", () => {
    expect(compareVersions("v0.6.4", "0.6.4")).toBe(0);
  });

  it("sorts a prerelease before the release it leads to", () => {
    expect(compareVersions("0.6.4-beta.1", "0.6.4")).toBeLessThan(0);
    expect(compareVersions("0.6.4", "0.6.4-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("0.6.4-beta.2", "0.6.4-beta.1")).toBeGreaterThan(0);
    // Numeric, not lexical: beta.10 is newer than beta.9.
    expect(compareVersions("0.6.4-beta.10", "0.6.4-beta.9")).toBeGreaterThan(0);
  });
});

function release(overrides: Partial<GitHubReleaseSummary>): GitHubReleaseSummary {
  return {
    tag_name: "v0.6.4",
    assets: [{ name: "Otto-0.6.4-arm64-unsigned.dmg" }],
    ...overrides,
  };
}

const hasMacAsset = (name: string) => name.endsWith("-unsigned.dmg");

describe("pickRelease", () => {
  it("takes the newest release rather than the first listed", () => {
    const picked = pickRelease(
      [release({ tag_name: "v0.6.2" }), release({ tag_name: "v0.6.4" })],
      "stable",
      hasMacAsset,
    );
    expect(picked?.tag_name).toBe("v0.6.4");
  });

  it("skips drafts and, on stable, prereleases", () => {
    const releases = [
      release({ tag_name: "v0.7.0", draft: true }),
      release({ tag_name: "v0.6.5", prerelease: true }),
      release({ tag_name: "v0.6.4" }),
    ];
    expect(pickRelease(releases, "stable", hasMacAsset)?.tag_name).toBe("v0.6.4");
    expect(pickRelease(releases, "beta", hasMacAsset)?.tag_name).toBe("v0.6.5");
  });

  it("skips a release whose downloadable asset is missing", () => {
    // The mac jobs can finish after the release publishes, and a failed mac
    // build leaves a release with nothing for this user to download.
    const releases = [
      release({ tag_name: "v0.6.4", assets: [{ name: "Otto-Setup-0.6.4-x64.exe" }] }),
      release({ tag_name: "v0.6.3" }),
    ];
    expect(pickRelease(releases, "stable", hasMacAsset)?.tag_name).toBe("v0.6.3");
  });
});

function configuration(
  overrides: Partial<AppUpdateRuntimeConfiguration> = {},
): AppUpdateRuntimeConfiguration {
  return {
    releaseChannel: "stable",
    shouldAdmitUpdate: () => true,
    onUpdateAvailable: vi.fn(),
    onUpdateDownloaded: vi.fn(),
    onUpdateNotAvailable: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

function runtimeWith(
  currentVersion: string,
  releases: GitHubReleaseSummary[],
  overrides?: Partial<AppUpdateRuntimeConfiguration>,
) {
  const runtime = new ManualDownloadUpdateRuntime({
    currentVersion: () => currentVersion,
    fetchReleases: () => Promise.resolve(releases),
    hasDownloadableAsset: hasMacAsset,
  });
  runtime.configure(configuration(overrides));
  return runtime;
}

describe("ManualDownloadUpdateRuntime", () => {
  it("reports a newer release as available", async () => {
    const runtime = runtimeWith("0.6.3", [release({ tag_name: "v0.6.4" })]);
    const result = await runtime.checkForUpdates();

    expect(result?.isUpdateAvailable).toBe(true);
    expect(result?.updateInfo.version).toBe("0.6.4");
    expect(runtime.latestVersion).toBe("0.6.4");
  });

  it("reports nothing when already on the newest release", async () => {
    const onUpdateNotAvailable = vi.fn();
    const runtime = runtimeWith("0.6.4", [release({ tag_name: "v0.6.4" })], {
      onUpdateNotAvailable,
    });

    expect((await runtime.checkForUpdates())?.isUpdateAvailable).toBe(false);
    expect(onUpdateNotAvailable).toHaveBeenCalled();
  });

  it("never offers a downgrade", async () => {
    const runtime = runtimeWith("0.7.0", [release({ tag_name: "v0.6.4" })]);
    expect((await runtime.checkForUpdates())?.isUpdateAvailable).toBe(false);
  });

  it("withholds an update the rollout has not admitted", async () => {
    const runtime = runtimeWith("0.6.3", [release({ tag_name: "v0.6.4" })], {
      shouldAdmitUpdate: () => false,
    });

    const result = await runtime.checkForUpdates();
    expect(result?.isUpdateAvailable).toBe(false);
    expect(result?.updateInfo.version).toBe("0.6.4");
  });

  it("refuses to install in place", async () => {
    const runtime = runtimeWith("0.6.3", [release({ tag_name: "v0.6.4" })]);
    await expect(runtime.downloadUpdate()).rejects.toThrow(/manually/);
    expect(() => runtime.quitAndInstall()).not.toThrow();
  });

  it("surfaces a fetch failure through onError", async () => {
    const onError = vi.fn();
    const runtime = new ManualDownloadUpdateRuntime({
      currentVersion: () => "0.6.3",
      fetchReleases: () => Promise.reject(new Error("offline")),
    });
    runtime.configure(configuration({ onError }));

    await expect(runtime.checkForUpdates()).rejects.toThrow("offline");
    expect(onError).toHaveBeenCalled();
  });
});
