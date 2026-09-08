import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createBrowserRecord } from "./state";
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
