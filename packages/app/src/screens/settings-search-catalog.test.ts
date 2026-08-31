import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SETTINGS_SEARCH_ITEMS, searchSettingsCatalog } from "./settings-search-catalog";
import { HOST_SECTION_SLUGS, SETTINGS_SECTION_SLUGS } from "@/utils/host-routes";

function readInventoryRows() {
  const inventoryPath = fileURLToPath(
    new URL("../../../../outputs/settings-inventory/settings-index.md", import.meta.url),
  );
  const lines = readFileSync(inventoryPath, "utf8").split(/\r?\n/);
  let surface = "";
  let category = "";
  let group = "";
  let inTable = false;
  const rows: Array<{
    surface: string;
    category: string;
    group: string;
    title: string;
    description: string;
    scope: string;
  }> = [];

  for (const line of lines) {
    if (line === "## App settings") surface = "App";
    if (line === "## Host settings") surface = "Host";
    const categoryMatch = line.match(/^### (?:App|Host) \/ (.+)$/);
    if (categoryMatch) category = categoryMatch[1];
    const groupMatch = line.match(/^#### (.+)$/);
    if (groupMatch) group = groupMatch[1];
    if (line.startsWith("| Setting")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    if (/^\|\s*-+/.test(line)) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    rows.push({
      surface,
      category,
      group,
      title: cells[0] ?? "",
      description: cells[1] ?? "",
      scope: cells[2] ?? "",
    });
  }
  return rows;
}

describe("Settings search catalog", () => {
  it("assigns every entry a unique id and a real settings scope", () => {
    expect(SETTINGS_SEARCH_ITEMS).toHaveLength(421);
    expect(new Set(SETTINGS_SEARCH_ITEMS.map((item) => item.id)).size).toBe(
      SETTINGS_SEARCH_ITEMS.length,
    );
    for (const item of SETTINGS_SEARCH_ITEMS) {
      expect(item.title).not.toHaveLength(0);
      expect(item.description).not.toHaveLength(0);
      expect(item.keywords).not.toHaveLength(0);
      expect(item.category).not.toHaveLength(0);
      expect(item.group).not.toHaveLength(0);
      expect(item.audience).not.toHaveLength(0);
    }
  });

  it("matches every row in the audited Markdown inventory exactly", () => {
    expect(
      SETTINGS_SEARCH_ITEMS.map((item) => ({
        surface: item.host ? "Host" : "App",
        category: item.category,
        group: item.group,
        title: item.title,
        description: item.description,
        scope: item.scope,
      })),
    ).toEqual(readInventoryRows());
  });

  it("finds product vocabulary rather than requiring the canonical row label", () => {
    expect(searchSettingsCatalog("bitbucket").some((item) => item.section === "workspaces")).toBe(
      true,
    );
    expect(searchSettingsCatalog("structural").some((item) => item.section === "editor")).toBe(
      true,
    );
    expect(
      searchSettingsCatalog("fetch interval").some((item) => item.section === "workspaces"),
    ).toBe(true);
    expect(searchSettingsCatalog("external editor").some((item) => item.section === "editor")).toBe(
      true,
    );
    expect(searchSettingsCatalog("markdown").some((item) => item.section === "editor")).toBe(true);
  });

  it("narrows results when several terms are typed", () => {
    const brainRows = searchSettingsCatalog("brain");
    const brainHttpsRows = searchSettingsCatalog("brain https");

    expect(brainHttpsRows.length).toBeGreaterThan(0);
    expect(brainHttpsRows.length).toBeLessThan(brainRows.length);
    expect(brainHttpsRows.map((item) => item.id)).toContain("host-brain-server-use-https");
    for (const item of brainHttpsRows) {
      expect(
        `${item.title} ${item.description} ${item.keywords} ${item.category}`.toLowerCase(),
      ).toContain("https");
    }
  });

  it("matches terms in any order and ignores extra whitespace", () => {
    expect(searchSettingsCatalog("  https   brain  ").map((item) => item.id)).toEqual(
      searchSettingsCatalog("brain https").map((item) => item.id),
    );
  });

  it("keeps a quoted run together as one phrase", () => {
    expect(searchSettingsCatalog('"use https"').map((item) => item.id)).toContain(
      "host-brain-server-use-https",
    );
    expect(searchSettingsCatalog('"https brain"')).toEqual([]);
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

    const canonicalAppSections = SETTINGS_SECTION_SLUGS.filter(
      (section) => section !== "notifications",
    );
    // Plugins arrived with the v0.6.1 upstream merge and has no rows in the
    // generated inventory yet, so it is excluded here the same way notifications
    // is. Index it and drop this filter.
    const canonicalHostSections = HOST_SECTION_SLUGS.filter((section) => section !== "plugins");
    expect([...indexedAppSections].sort()).toEqual([...canonicalAppSections].sort());
    expect([...indexedHostSections].sort()).toEqual([...canonicalHostSections].sort());
  });

  it("follows the current host Settings destinations", () => {
    expect(
      searchSettingsCatalog("pair device").some((item) => item.section === "pair-device"),
    ).toBe(true);
    expect(SETTINGS_SEARCH_ITEMS.find((item) => item.title === "Add profile")?.section).toBe(
      "teams",
    );
  });

  it("follows every approved Settings move", () => {
    const sectionFor = (title: string) =>
      SETTINGS_SEARCH_ITEMS.find((item) => item.title === title)?.section;

    expect(sectionFor("Default send")).toBe("chat");
    expect(sectionFor("Review view")).toBe("editor");
    expect(sectionFor("Voice cues")).toBe("integrations");
    expect(sectionFor("Clear cached copies")).toBe("diagnostics");
    expect(sectionFor("Notification permission")).toBe("permissions");
    expect(sectionFor("Metadata generation")).toBe("metadata");
  });

  it("keeps every device-local voice and wake control on the App Integrations page", () => {
    const voiceRows = SETTINGS_SEARCH_ITEMS.filter((item) => item.group === "Voice & dictation");
    expect(voiceRows).toHaveLength(8);
    expect(new Set(voiceRows.map((item) => item.section))).toEqual(new Set(["integrations"]));
    expect(new Set(voiceRows.map((item) => item.scope))).toEqual(new Set(["App"]));
  });

  it("indexes Brain connection proof without restoring lifecycle controls to Settings", () => {
    const brainRows = SETTINGS_SEARCH_ITEMS.filter((item) => item.host && item.section === "brain");
    expect(brainRows).toHaveLength(37);
    expect(brainRows.filter((item) => item.group === "Detected Brain")).toHaveLength(8);
    expect(new Set(brainRows.map((item) => item.group))).not.toContain("Status");
    expect(brainRows.some((item) => item.title === "Lifecycle")).toBe(false);
    expect(brainRows.some((item) => item.title === "Model override")).toBe(false);
  });
});
