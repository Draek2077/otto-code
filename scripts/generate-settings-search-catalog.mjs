#!/usr/bin/env node
/**
 * Keeps Settings discovery attached to the audited inventory. The inventory is
 * deliberately the source here: a row that is not in Settings must not become
 * searchable, and a rendered row missing from this report fails the catalog
 * test. Existing ids are recovered from the previous generated catalog so
 * routes and automation keep their stable identifiers while this generator is
 * adopted.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const inventoryPath = resolve(root, "outputs/settings-inventory/settings-index.md");
const generatedPath = resolve(root, "packages/app/src/screens/settings-search-generated.ts");

const sectionForCategory = {
  about: "about",
  agents: "agents",
  appearance: "appearance",
  brain: "brain",
  chat: "chat",
  code: "code",
  connections: "connections",
  diagnostics: "diagnostics",
  editor: "editor",
  general: "general",
  host: "host",
  integrations: "integrations",
  layout: "layout",
  metadata: "metadata",
  "pair device": "pair-device",
  permissions: "permissions",
  plugins: "plugins",
  projects: "projects",
  "projects / project settings": "projects",
  providers: "providers",
  shortcuts: "shortcuts",
  storage: "storage",
  teams: "teams",
  terminals: "terminals",
  tools: "tools",
  usage: "usage",
  visualizer: "visualizer",
  workspaces: "workspaces",
};

function slug(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseCells(line) {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function readExistingIds() {
  const source = readFileSync(generatedPath, "utf8");
  const rowsMatch = source.match(/const ROWS = (\[[\s\S]*?\]) as const;/);
  if (!rowsMatch) return { exact: new Map(), relaxed: new Map() };
  const rows = vm.runInNewContext(`(${rowsMatch[1]})`);
  const exact = new Map();
  const relaxedCandidates = new Map();
  for (const row of rows) {
    const [id, title, description, _keywords, scope, _section, host, category, group] = row;
    const routeIdentity = [host ? "Host" : "App", category, group, title, scope].join("\u0000");
    exact.set(`${routeIdentity}\u0000${description}`, id);
    relaxedCandidates.set(routeIdentity, [...(relaxedCandidates.get(routeIdentity) ?? []), id]);
  }
  const relaxed = new Map([...relaxedCandidates].filter(([, ids]) => ids.length === 1));
  return { exact, relaxed };
}

function readInventory() {
  const rows = [];
  let surface = "";
  let category = "";
  let group = "";
  let inTable = false;
  for (const line of readFileSync(inventoryPath, "utf8").split(/\r?\n/)) {
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
    const [
      title,
      description,
      scope,
      kind,
      choices,
      defaultValue,
      audience,
      conditions,
      persistence,
    ] = parseCells(line);
    const normalizedCategory = category.toLowerCase();
    let section = sectionForCategory[normalizedCategory];
    if (surface === "App" && normalizedCategory === "permissions" && group === "Notifications") {
      section = "notifications";
    }
    if (!section) {
      throw new Error(`No Settings route mapping for ${surface} / ${category}`);
    }
    rows.push({
      surface,
      category,
      group,
      title,
      description,
      scope,
      section,
      host: surface === "Host",
      audience,
      kind,
      choices,
      defaultValue,
      conditions,
      persistence,
      keywords: [
        category,
        group,
        kind,
        choices,
        defaultValue,
        conditions,
        persistence,
        scope,
        audience,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  return rows;
}

const existingIds = readExistingIds();
const rows = readInventory().map((row) => {
  const routeIdentity = [row.surface, row.category, row.group, row.title, row.scope].join("\u0000");
  const identity = `${routeIdentity}\u0000${row.description}`;
  return [
    existingIds.exact.get(identity) ??
      existingIds.relaxed.get(routeIdentity) ??
      slug(`${row.surface}-${row.category}-${row.group}-${row.title}`),
    row.title,
    row.description,
    row.keywords,
    row.scope,
    row.section,
    row.host,
    row.category,
    row.group,
    row.audience,
    row.kind,
    row.choices,
    row.defaultValue,
    row.conditions,
    row.persistence,
    row.audience === "Developer",
    row.audience === "Developer",
  ];
});

const generated = `// Generated from outputs/settings-inventory/settings-index.md by\n// scripts/generate-settings-search-catalog.mjs. Do not edit by hand.\nimport type { SettingsSearchItem } from "@/screens/settings-search-catalog";\n\nconst ROWS = ${JSON.stringify(rows, null, 2)} as const;\n\nexport const GENERATED_SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = ROWS.map(\n  ([id, title, description, keywords, scope, section, host, category, group, audience, kind, choices, defaultValue, conditions, persistence, advanced, developerOnly]) => ({\n    id,\n    title,\n    description,\n    keywords,\n    scope,\n    section,\n    host,\n    category,\n    group,\n    audience,\n    kind,\n    choices,\n    defaultValue,\n    conditions,\n    persistence,\n    advanced,\n    developerOnly,\n  }),\n);\n`;

writeFileSync(generatedPath, generated);
console.log(`Generated ${rows.length} Settings search entries.`);
