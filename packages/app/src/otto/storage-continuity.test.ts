import { beforeEach, expect, it } from "vitest";
import RawStorage from "@react-native-async-storage/async-storage";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { BrowserIndexStateSchema, createBrowserRecord } from "@/desktop/browser/store/state";
import OttoStorage from "./async-storage";
import { createOttoStorageContinuity, OTTO_APP_RECOVERY_PREFIX } from "./storage-continuity";
import { loadAppSettingsFromStorage } from "@/hooks/use-settings/storage";
import { createFakeDesktopBridge } from "@/hooks/use-settings/fakes";
import { migrateAppSettings } from "@/hooks/use-settings/migrations";

beforeEach(async () => {
  await RawStorage.clear();
});
const recoveryKey = (key: string) => `${OTTO_APP_RECOVERY_PREFIX}${encodeURIComponent(key)}`;

it("restores 0.9 browser tabs through the real strict validator and retains their Otto metadata on disk", async () => {
  const browser = createBrowserRecord({
    browserId: "existing",
    initialUrl: "https://example.com",
    now: 1,
  });
  const metadata = {
    openedByAgentId: "chat",
    renderMode: "native",
    isPreview: true,
    previewServerId: "server",
    previewServerName: "app",
    previewCwd: "/project",
    previewStatus: "idle",
  };
  const original = JSON.stringify({
    state: {
      browsersById: {
        existing: { ...browser, ...metadata },
        removed: { ...browser, browserId: "removed", ...metadata },
      },
    },
    version: 0,
  });
  await RawStorage.setItem("workspace-browser-store", original);
  const storage = createValidatedPersistStorage(OttoStorage, BrowserIndexStateSchema);
  const restored = await storage.getItem("workspace-browser-store");
  expect(restored?.state.browsersById.existing).toEqual(browser);
  await storage.setItem("workspace-browser-store", {
    state: { browsersById: { existing: { ...browser, url: "https://example.com/changed" } } },
    version: 0,
  });
  const written = JSON.parse((await RawStorage.getItem("workspace-browser-store"))!);
  expect(written.state.browsersById).toEqual({
    existing: { ...browser, ...metadata, url: "https://example.com/changed" },
  });
  expect(await RawStorage.getItem(recoveryKey("workspace-browser-store"))).toBe(original);
  expect(await OttoStorage.getAllKeys()).toEqual(["workspace-browser-store"]);
});

it("keeps an exact once-only settings recovery copy across writes and adapter restarts", async () => {
  const original = '{ "theme": "daylight", "brain": { "model": "local" } }';
  await RawStorage.setItem("@otto:app-settings", original);
  await OttoStorage.setItem("@paseo:app-settings", '{"theme":"dark"}');
  const restarted = createOttoStorageContinuity(RawStorage);
  await restarted.setItem("@otto:app-settings", '{"theme":"light"}');
  expect(await RawStorage.getItem(recoveryKey("@otto:app-settings"))).toBe(original);
  expect(await OttoStorage.getItem("@paseo:app-settings")).toBe('{"theme":"light"}');
});

it("preserves rejected layout data before validators remove it", async () => {
  const original = '{"state":{"ottoFeatureTabs":["knowledge","brain"]},"version":9}';
  await RawStorage.setItem("workspace-layout-state", original);
  await OttoStorage.multiRemove(["workspace-layout-state"]);
  expect(await RawStorage.getItem("workspace-layout-state")).toBeNull();
  expect(await RawStorage.getItem(recoveryKey("workspace-layout-state"))).toBe(original);
});

it("does not overwrite settings when the recovery copy cannot be written", async () => {
  await RawStorage.setItem("@otto:app-settings", "original");
  const storage = createOttoStorageContinuity({
    ...RawStorage,
    setItem: async () => {
      throw new Error("storage full");
    },
  });
  await expect(storage.setItem("@otto:app-settings", "changed")).rejects.toThrow("storage full");
  expect(await RawStorage.getItem("@otto:app-settings")).toBe("original");
});

it("does not create recovery copies of credentials and honors an explicit clear", async () => {
  await OttoStorage.setItem("@paseo:auth-token", "secret");
  await OttoStorage.removeItem("@paseo:auth-token");
  expect(await RawStorage.getAllKeys()).toEqual([]);
  await RawStorage.setItem("panel-state", "old-panel");
  await OttoStorage.multiSet([["panel-state", "new-panel"]]);
  expect(await RawStorage.getItem(recoveryKey("panel-state"))).toBe("old-panel");
  await OttoStorage.clear();
  expect(await RawStorage.getAllKeys()).toEqual([]);
});

it("reads the previous remembered workspace key", async () => {
  await RawStorage.setItem("otto:last-workspace-route-selection", "saved-workspace");
  expect(await OttoStorage.getItem("paseo:last-workspace-route-selection")).toBe("saved-workspace");
});

it("does not replace an upgrading user's explicit send behavior or mobile font size with newer defaults", async () => {
  await RawStorage.setItem(
    "@otto:app-settings",
    JSON.stringify({
      theme: "dark",
      sendBehavior: "interrupt",
      uiBaseFontSize: 17,
      contentFontSize: 15,
    }),
  );
  const loaded = await loadAppSettingsFromStorage({
    storage: OttoStorage,
    desktop: createFakeDesktopBridge(),
  });
  expect(loaded.sendBehavior).toBe("interrupt");
  const mobile = await migrateAppSettings(loaded, OttoStorage, undefined, { native: true });
  expect(mobile.contentFontSize).toBe(15);
  expect(JSON.parse((await RawStorage.getItem("@otto:app-settings"))!)).toMatchObject({
    sendBehavior: "interrupt",
    contentFontSize: 15,
  });
});
