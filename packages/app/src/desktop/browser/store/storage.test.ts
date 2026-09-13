import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  applyBrowserPatch,
  createBrowserRecord,
  rehydrateBrowserRecord,
  sanitizeBrowsersForPersist,
} from "./state";
import { createBrowserPersistStorage } from "./storage";

function storageFixture(raw: string) {
  const entries = new Map([["workspace-browser-store", raw]]);
  const backing: StateStorage = {
    getItem: (name) => entries.get(name) ?? null,
    setItem: (name, value) => {
      entries.set(name, value);
    },
    removeItem: (name) => {
      entries.delete(name);
    },
  };
  return { entries, storage: createBrowserPersistStorage(backing) };
}

describe("browser persistence", () => {
  it("saves navigation and new tabs after restore and retains them on a second restart", async () => {
    const original = createBrowserRecord({
      browserId: "restored",
      initialUrl: "https://example.com",
      now: 1,
    });
    const { storage } = storageFixture(
      JSON.stringify({ state: { browsersById: { restored: original } }, version: 0 }),
    );
    const saved = await storage.getItem("workspace-browser-store");
    const restored = rehydrateBrowserRecord("restored", saved!.state.browsersById.restored);
    const navigated = applyBrowserPatch({ browsersById: { restored } }, "restored", {
      url: "https://otto-code.me/docs",
      title: "Otto docs",
    });
    const added = createBrowserRecord({
      browserId: "added",
      initialUrl: "https://example.org/another-tab",
      now: 2,
    });
    await storage.setItem("workspace-browser-store", {
      state: sanitizeBrowsersForPersist({
        browsersById: { ...navigated.browsersById, added },
      }),
      version: 0,
    });
    const reopened = await storage.getItem("workspace-browser-store");
    expect(reopened!.state.browsersById.restored).toEqual({
      ...original,
      url: "https://otto-code.me/docs",
      title: "Otto docs",
    });
    expect(reopened!.state.browsersById.added).toEqual(added);
  });

  it("restores usable URLs through the actual storage boundary without deleting the source", async () => {
    const good = createBrowserRecord({
      browserId: "good",
      initialUrl: "https://otto-code.me/docs",
      now: 1,
    });
    const raw = JSON.stringify({
      state: { browsersById: { good, old: { url: "https://example.org/saved" }, broken: null } },
      version: 0,
    });
    const { storage, entries } = storageFixture(raw);
    const restored = await storage.getItem("workspace-browser-store");
    expect(restored?.state.browsersById.good.url).toBe("https://otto-code.me/docs");
    expect(restored?.state.browsersById.old.url).toBe("https://example.org/saved");
    expect(entries.get("workspace-browser-store")).toBe(raw);
    await storage.setItem("workspace-browser-store", restored!);
    const reopened = await storage.getItem("workspace-browser-store");
    expect(reopened?.state).toEqual(restored?.state);
  });

  it("leaves malformed saved data untouched on read", async () => {
    const raw = '{"state":';
    const { storage, entries } = storageFixture(raw);
    expect(await storage.getItem("workspace-browser-store")).toBeNull();
    expect(entries.get("workspace-browser-store")).toBe(raw);
  });
});
