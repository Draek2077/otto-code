import { describe, expect, it } from "vitest";
import { getPrimaryDownload, downloadUrls, type ReleaseAssetInfo, webAppUrl } from "./downloads";
const release: ReleaseAssetInfo = {
  version: "0.9.10",
  linuxAppImageAsset: "Otto-x86_64.AppImage",
  windowsX64Asset: "Otto-Setup-0.9.10-x64.exe",
  windowsArm64Asset: null,
  macArm64Asset: null,
  macX64Asset: null,
};
describe("Otto distribution over the shared visitor-platform owner", () => {
  it("routes iOS to the web app and Android to Otto's APK, without upstream store links", () => {
    expect(getPrimaryDownload(release, "ios")).toMatchObject({ label: "Web app", href: webAppUrl });
    expect(getPrimaryDownload(release, "android").href).toBe(downloadUrls(release).androidApk);
    expect(getPrimaryDownload(release, "android").href).toContain(
      "Draek2077/otto-code/releases/download/v0.9.10/otto-v0.9.10-android.apk",
    );
  });
  it("keeps Mac visitors on the unsigned-build instructions page with or without an artifact", () => {
    expect(getPrimaryDownload(release, "mac")).toMatchObject({
      href: "/download",
      openInPage: true,
    });
    expect(
      getPrimaryDownload({ ...release, macArm64Asset: "Otto-arm64-unsigned.dmg" }, "mac"),
    ).toMatchObject({ href: "/download", openInPage: true });
    expect(downloadUrls(release).macDmgArm64).toBeNull();
    expect(downloadUrls(release).macDmgX64).toBeNull();
  });
  it("uses actual release asset names for desktop visitors", () => {
    expect(getPrimaryDownload(release, "windows").href).toContain(release.windowsX64Asset);
    expect(getPrimaryDownload(release, "linux").href).toContain(release.linuxAppImageAsset);
  });
});
