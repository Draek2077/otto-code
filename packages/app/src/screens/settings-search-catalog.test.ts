import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SETTINGS_SEARCH_ITEMS, searchSettingsCatalog } from "./settings-search-catalog";
import { HOST_SECTION_SLUGS, SETTINGS_SECTION_SLUGS } from "@/utils/host-routes";

function inventoryMarkdownPath() {
  return fileURLToPath(
    new URL("../../../../outputs/settings-inventory/settings-index.md", import.meta.url),
  );
}

function readInventoryRows() {
  const lines = readFileSync(inventoryMarkdownPath(), "utf8").split(/\r?\n/);
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
    kind: string;
    choices: string;
    defaultValue: string;
    audience: string;
    conditions: string;
    persistence: string;
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
      kind: cells[3] ?? "",
      choices: cells[4] ?? "",
      defaultValue: cells[5] ?? "",
      audience: cells[6] ?? "",
      conditions: cells[7] ?? "",
      persistence: cells[8] ?? "",
    });
  }
  return rows;
}

describe("Settings search catalog", () => {
  it("assigns every entry a unique id and a real settings scope", () => {
    expect(SETTINGS_SEARCH_ITEMS).toHaveLength(432);
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
        kind: item.kind,
        choices: item.choices,
        defaultValue: item.defaultValue,
        audience: item.audience,
        conditions: item.conditions,
        persistence: item.persistence,
      })),
    ).toEqual(readInventoryRows());
  });

  it("keeps the inventory summary totals aligned with its indexed rows", () => {
    const rows = readInventoryRows();
    const inventory = readFileSync(inventoryMarkdownPath(), "utf8");
    const appRows = rows.filter((row) => row.surface === "App");
    const hostRows = rows.filter((row) => row.surface === "Host");

    expect(inventory).toContain(`**Total indexed entries:** ${rows.length}`);
    expect(inventory).toContain(`**App surface:** ${appRows.length}`);
    expect(inventory).toContain(`**Host surface:** ${hostRows.length}`);
  });

  it("keeps every inventory contents count aligned with its category", () => {
    const rows = readInventoryRows();
    const inventory = readFileSync(inventoryMarkdownPath(), "utf8");
    const contents = inventory.slice(
      inventory.indexOf("## Contents"),
      inventory.indexOf("## App settings"),
    );
    const entries = [...contents.matchAll(/^  - \[(.+) \((\d+)\)\]\(#(app|host)-/gm)];

    expect(entries).not.toHaveLength(0);
    for (const [, category, count, surface] of entries) {
      expect(Number(count)).toBe(
        rows.filter(
          (row) =>
            row.surface === (surface === "app" ? "App" : "Host") && row.category === category,
        ).length,
      );
    }
  });

  it("keeps every inventory source link pointed at an existing source line", () => {
    const inventoryPath = inventoryMarkdownPath();
    const inventory = readFileSync(inventoryPath, "utf8");
    const sourceLinks = [...inventory.matchAll(/\]\(\.\.\/\.\.\/([^)#]+)#L(\d+)\)/g)];

    expect(sourceLinks).toHaveLength(readInventoryRows().length);
    for (const [, sourcePath, sourceLine] of sourceLinks) {
      const source = resolve(dirname(inventoryPath), "..", "..", sourcePath);
      expect(existsSync(source)).toBe(true);
      expect(Number(sourceLine)).toBeLessThanOrEqual(
        readFileSync(source, "utf8").split(/\r?\n/).length,
      );
    }
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

    const canonicalAppSections = SETTINGS_SECTION_SLUGS;
    const canonicalHostSections = HOST_SECTION_SLUGS;
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
    expect(sectionFor("Play sound")).toBe("notifications");
    expect(sectionFor("Clear cached copies")).toBe("diagnostics");
    expect(sectionFor("Notification permission")).toBe("permissions");
    expect(sectionFor("Metadata generation")).toBe("metadata");
    expect(sectionFor("Enable plugins")).toBe("plugins");
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
