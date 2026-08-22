import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_ITEMS, searchSettingsCatalog } from "./settings-search-catalog";
import { HOST_SECTION_SLUGS, SETTINGS_SECTION_SLUGS } from "@/utils/host-routes";

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

  it("keeps every current Settings panel discoverable", () => {
    const indexedAppSections = new Set(
      SETTINGS_SEARCH_ITEMS.filter((item) => !item.host).map((item) => item.section),
    );
    const indexedHostSections = new Set(
      SETTINGS_SEARCH_ITEMS.filter((item) => item.host).map((item) => item.section),
    );

    expect([...indexedAppSections].sort()).toEqual([...SETTINGS_SECTION_SLUGS].sort());
    expect([...indexedHostSections].sort()).toEqual([...HOST_SECTION_SLUGS].sort());
  });

  it("follows the current host Settings destinations", () => {
    expect(searchSettingsCatalog("pair device").map((item) => item.id)).toEqual(["pair-device"]);
    expect(SETTINGS_SEARCH_ITEMS.find((item) => item.id === "personalities")?.section).toBe(
      "teams",
    );
  });
});
