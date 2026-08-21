import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_ITEMS, searchSettingsCatalog } from "./settings-search-catalog";

describe("Settings search catalog", () => {
  it("assigns every entry a unique id and a real settings scope", () => {
    expect(new Set(SETTINGS_SEARCH_ITEMS.map((item) => item.id)).size).toBe(
      SETTINGS_SEARCH_ITEMS.length,
    );
    for (const item of SETTINGS_SEARCH_ITEMS) {
      expect(item.title).not.toHaveLength(0);
      expect(item.description).not.toHaveLength(0);
      expect(item.keywords).not.toHaveLength(0);
    }
  });

  it("finds product vocabulary rather than requiring the canonical row label", () => {
    expect(searchSettingsCatalog("bitbucket").map((item) => item.id)).toEqual(["git-hosting"]);
    expect(searchSettingsCatalog("difftastic").map((item) => item.id)).toContain(
      "diff-presentation",
    );
    expect(searchSettingsCatalog("private key").map((item) => item.id)).toContain("git-fetch");
    expect(searchSettingsCatalog("vimrc").map((item) => item.id)).toContain("file-editor");
    expect(searchSettingsCatalog("markdown").map((item) => item.id)).toContain("file-editor");
  });

  it("returns no results for an empty query", () => {
    expect(searchSettingsCatalog("  ")).toEqual([]);
  });
});
