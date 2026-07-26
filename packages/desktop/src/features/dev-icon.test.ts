import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBrandedAssetPath } from "./dev-icon";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  app: {
    isPackaged: true,
  },
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
}));

vi.mock("electron", () => ({
  app: mocks.app,
}));

const ASSETS = path.join("packages", "desktop", "assets");
const releaseIcon = path.join(ASSETS, "icon.ico");
const devIcon = path.join(ASSETS, "dev", "icon.ico");

beforeEach(() => {
  mocks.existsSync.mockReset();
});

describe("resolveBrandedAssetPath", () => {
  it("never reaches for dev art in a packaged build", () => {
    mocks.app.isPackaged = true;
    // Dev art present on disk must still be ignored: a release build wears the
    // black tile even if a stray assets/dev/ folder somehow shipped with it.
    mocks.existsSync.mockReturnValue(true);

    expect(resolveBrandedAssetPath(ASSETS, "icon.ico")).toBe(releaseIcon);
    expect(mocks.existsSync).not.toHaveBeenCalled();
  });

  it("uses the navy dev art when running unpackaged", () => {
    mocks.app.isPackaged = false;
    mocks.existsSync.mockReturnValue(true);

    expect(resolveBrandedAssetPath(ASSETS, "icon.ico")).toBe(devIcon);
    expect(mocks.existsSync).toHaveBeenCalledWith(devIcon);
  });

  it("falls back to the release art when the dev art has not been generated", () => {
    // A fresh checkout that has not run scripts/generate-brand-assets.mjs still
    // has to launch, so a missing dev asset degrades to the normal icon.
    mocks.app.isPackaged = false;
    mocks.existsSync.mockReturnValue(false);

    expect(resolveBrandedAssetPath(ASSETS, "icon.ico")).toBe(releaseIcon);
  });

  it("passes through assets that have no dev variant, like the mac tray template", () => {
    mocks.app.isPackaged = false;
    mocks.existsSync.mockImplementation(
      (candidate: string) => candidate !== path.join(ASSETS, "dev", "tray-icon-mac.png"),
    );

    expect(resolveBrandedAssetPath(ASSETS, "tray-icon-mac.png")).toBe(
      path.join(ASSETS, "tray-icon-mac.png"),
    );
  });
});
