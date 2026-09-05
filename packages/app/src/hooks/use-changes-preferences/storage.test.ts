import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createInMemoryKeyValueStorage } from "./fakes";
import {
  CHANGES_PREFERENCES_QUERY_KEY,
  CHANGES_PREFERENCES_STORAGE_KEY,
  DEFAULT_CHANGES_PREFERENCES,
  loadChangesPreferencesFromStorage,
  saveChangesPreferences,
} from "./storage";

describe("loadChangesPreferencesFromStorage", () => {
  it("defaults to unified layout with visible whitespace and writes the defaults back", async () => {
    const storage = createInMemoryKeyValueStorage();

    const result = await loadChangesPreferencesFromStorage(storage);

    expect(result).toEqual(DEFAULT_CHANGES_PREFERENCES);
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify(DEFAULT_CHANGES_PREFERENCES),
    );
  });

  it("migrates the legacy wrap-lines toggle into the new preferences object", async () => {
    const storage = createInMemoryKeyValueStorage({ "diff-wrap-lines": "true" });

    const result = await loadChangesPreferencesFromStorage(storage);

    expect(result).toEqual({
      presentation: "line",
      layout: "unified",
      desktopTreeVisible: false,
      wrapLines: true,
      hideWhitespace: false,
      pinnedToolbarItems: DEFAULT_CHANGES_PREFERENCES.pinnedToolbarItems,
      inlineDiff: true,
      commitsCollapsed: true,
      commitType: "none",
    });
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(JSON.stringify(result));
  });

  it("loads persisted layout and whitespace preferences without rewriting storage", async () => {
    const persisted = JSON.stringify({
      layout: "split",
      viewMode: "tree",
      hideWhitespace: true,
      wrapLines: false,
    });
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: persisted,
    });

    const result = await loadChangesPreferencesFromStorage(storage);

    expect(result).toEqual({
      presentation: "line",
      layout: "split",
      desktopTreeVisible: true,
      hideWhitespace: true,
      wrapLines: false,
      pinnedToolbarItems: DEFAULT_CHANGES_PREFERENCES.pinnedToolbarItems,
      inlineDiff: true,
      commitsCollapsed: true,
      commitType: "none",
    });
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(persisted);
    expect(storage.entries.size).toBe(1);
  });

  it("loads a persisted pinned-toolbar set verbatim", async () => {
    const persisted = JSON.stringify({
      layout: "unified",
      viewMode: "flat",
      hideWhitespace: false,
      wrapLines: false,
      pinnedToolbarItems: ["wrap", "refresh"],
    });
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: persisted,
    });

    const result = await loadChangesPreferencesFromStorage(storage);

    expect(result.pinnedToolbarItems).toEqual(["wrap", "refresh"]);
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(persisted);
  });
});

describe("changes preferences commitsCollapsed", () => {
  it("collapses commits by default", () => {
    expect(DEFAULT_CHANGES_PREFERENCES.commitsCollapsed).toBe(true);
  });

  it("round-trips commitsCollapsed: false", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({ commitsCollapsed: false }),
    });

    const prefs = await loadChangesPreferencesFromStorage(storage);

    expect(prefs.commitsCollapsed).toBe(false);
  });

  it("falls back to collapsed for invalid commitsCollapsed", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({ commitsCollapsed: "nope" }),
    });

    const prefs = await loadChangesPreferencesFromStorage(storage);

    expect(prefs.commitsCollapsed).toBe(true);
  });
});

describe("changes preferences commitType", () => {
  it("defaults to no type prefix", () => {
    expect(DEFAULT_CHANGES_PREFERENCES.commitType).toBe("none");
  });

  it("round-trips a persisted commit type", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({ commitType: "fix" }),
    });

    const prefs = await loadChangesPreferencesFromStorage(storage);

    expect(prefs.commitType).toBe("fix");
  });

  it("falls back to none for an unknown commit type", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({ commitType: "wip" }),
    });

    const prefs = await loadChangesPreferencesFromStorage(storage);

    expect(prefs.commitType).toBe("none");
  });
});

describe("changes preferences inlineDiff", () => {
  it("opens Changes with inline diff by default", () => {
    expect(DEFAULT_CHANGES_PREFERENCES.inlineDiff).toBe(true);
  });

  it("round-trips the inline diff preference", async () => {
    const storage = createInMemoryKeyValueStorage({
      [CHANGES_PREFERENCES_STORAGE_KEY]: JSON.stringify({ inlineDiff: true }),
    });

    const prefs = await loadChangesPreferencesFromStorage(storage);

    expect(prefs.inlineDiff).toBe(true);
  });
});

describe("saveChangesPreferences", () => {
  it("merges updates onto cached preferences and persists the result", async () => {
    const storage = createInMemoryKeyValueStorage();
    const queryClient = new QueryClient();
    queryClient.setQueryData(CHANGES_PREFERENCES_QUERY_KEY, DEFAULT_CHANGES_PREFERENCES);

    await saveChangesPreferences({
      queryClient,
      updates: { layout: "split", desktopTreeVisible: true, hideWhitespace: true },
      storage,
    });

    const expected = {
      ...DEFAULT_CHANGES_PREFERENCES,
      layout: "split",
      desktopTreeVisible: true,
      hideWhitespace: true,
    };
    expect(queryClient.getQueryData(CHANGES_PREFERENCES_QUERY_KEY)).toEqual(expected);
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(JSON.stringify(expected));
  });

  it("falls back to defaults when the query cache has no prior preferences", async () => {
    const storage = createInMemoryKeyValueStorage();
    const queryClient = new QueryClient();

    await saveChangesPreferences({
      queryClient,
      updates: { wrapLines: true },
      storage,
    });

    const expected = { ...DEFAULT_CHANGES_PREFERENCES, wrapLines: true };
    expect(storage.entries.get(CHANGES_PREFERENCES_STORAGE_KEY)).toBe(JSON.stringify(expected));
  });
});
