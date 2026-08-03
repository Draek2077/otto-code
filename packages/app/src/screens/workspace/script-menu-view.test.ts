import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkspaceScriptGroup } from "@/screens/workspace/use-workspace-script-groups";
import { OTTO_SCRIPT_GROUP_KEY } from "@/screens/workspace/use-workspace-script-groups";
import {
  buildScriptMenuView,
  RECENT_SCRIPT_GROUP_KEY,
  RECENT_SCRIPT_LIMIT,
  SCRIPT_FILTER_MIN_ROWS,
} from "@/screens/workspace/script-menu-view";

type WorkspaceScript = WorkspaceScriptGroup["scripts"][number];

function script(scriptName: string, overrides: Partial<WorkspaceScript> = {}): WorkspaceScript {
  return {
    scriptName,
    type: "script",
    hostname: scriptName,
    port: null,
    proxyUrl: null,
    lifecycle: "stopped",
    health: null,
    exitCode: null,
    terminalId: null,
    ...overrides,
  };
}

function discovered(name: string, command: string): WorkspaceScript {
  return script(`npm:${name}`, {
    label: name,
    command,
    source: { id: "npm", label: "npm", file: "package.json" },
  });
}

function groups(input: { otto?: string[]; npm?: Array<[string, string]> }): WorkspaceScriptGroup[] {
  const result: WorkspaceScriptGroup[] = [];
  if (input.otto) {
    result.push({
      key: OTTO_SCRIPT_GROUP_KEY,
      label: null,
      scripts: input.otto.map((name) => script(name, { command: `run ${name}` })),
    });
  }
  if (input.npm) {
    result.push({
      key: "npm:package.json",
      label: "npm · package.json",
      scripts: input.npm.map(([name, command]) => discovered(name, command)),
    });
  }
  return result;
}

function view(input: {
  groups: WorkspaceScriptGroup[];
  query?: string;
  expansionByGroupKey?: Record<string, boolean>;
  lastRunAtByScriptName?: Record<string, number>;
}) {
  return buildScriptMenuView({
    groups: input.groups,
    query: input.query ?? "",
    expansionByGroupKey: input.expansionByGroupKey ?? {},
    lastRunAtByScriptName: input.lastRunAtByScriptName ?? {},
  });
}

describe("collapse by default", () => {
  it("opens Otto's group and collapses every discovered one", () => {
    const result = view({
      groups: groups({
        otto: ["daemon", "app"],
        npm: [
          ["build", "tsc -b"],
          ["lint", "oxlint"],
        ],
      }),
    });

    expect(result.groups.map((group) => [group.key, group.isExpanded])).toEqual([
      [OTTO_SCRIPT_GROUP_KEY, true],
      ["npm:package.json", false],
    ]);
  });

  it("counts only the rows a collapsed menu actually shows", () => {
    const npm: Array<[string, string]> = Array.from({ length: 98 }, (_, index) => [
      `task-${index}`,
      `npm run task-${index}`,
    ]);
    const result = view({ groups: groups({ otto: ["daemon", "app"], npm }) });

    expect(result.totalRowCount).toBe(100);
    expect(result.visibleRowCount).toBe(2);
  });

  it("keeps Otto's group inert so it cannot be hidden", () => {
    const result = view({ groups: groups({ otto: ["daemon"], npm: [["build", "tsc -b"]] }) });

    expect(result.groups[0]?.isAlwaysExpanded).toBe(true);
    expect(result.groups[1]?.isAlwaysExpanded).toBe(false);
  });

  it("honours an explicit expansion over the default", () => {
    const result = view({
      groups: groups({ otto: ["daemon"], npm: [["build", "tsc -b"]] }),
      expansionByGroupKey: { "npm:package.json": true },
    });

    expect(result.groups[1]?.isExpanded).toBe(true);
    expect(result.visibleRowCount).toBe(2);
  });
});

describe("the filter threshold", () => {
  it("stays hidden while the menu is scannable", () => {
    const npm: Array<[string, string]> = Array.from(
      { length: SCRIPT_FILTER_MIN_ROWS - 2 },
      (_, i) => [`task-${i}`, `npm run task-${i}`],
    );
    expect(view({ groups: groups({ otto: ["daemon"], npm }) }).showFilter).toBe(false);
  });

  it("appears once the menu passes the threshold", () => {
    const npm: Array<[string, string]> = Array.from({ length: SCRIPT_FILTER_MIN_ROWS }, (_, i) => [
      `task-${i}`,
      `npm run task-${i}`,
    ]);
    expect(view({ groups: groups({ npm }) }).showFilter).toBe(true);
  });
});

describe("filtering across a collapsed tree", () => {
  const tree = groups({
    otto: ["daemon"],
    npm: [
      ["build", "tsc -b"],
      ["test", "vitest run"],
      ["test:watch", "vitest"],
    ],
  });

  it("expands a collapsed group that has a match", () => {
    const result = view({ groups: tree, query: "test" });

    const npmGroup = result.groups.find((group) => group.key === "npm:package.json");
    expect(npmGroup?.isExpanded).toBe(true);
    expect(npmGroup?.scripts.map((s) => s.label)).toEqual(["test", "test:watch"]);
  });

  it("drops groups with no match entirely", () => {
    const result = view({ groups: tree, query: "vitest" });

    expect(result.groups.map((group) => group.key)).toEqual(["npm:package.json"]);
  });

  it("matches the command, not just the name", () => {
    const result = view({ groups: tree, query: "tsc" });

    expect(result.groups[0]?.scripts.map((s) => s.label)).toEqual(["build"]);
  });

  it("never mutates the stored collapse state, so clearing restores the menu", () => {
    const expansionByGroupKey: Record<string, boolean> = {};
    const searched = view({ groups: tree, query: "test", expansionByGroupKey });
    expect(searched.groups.find((g) => g.key === "npm:package.json")?.isExpanded).toBe(true);

    // The caller's record is untouched, so the same input rebuilds the
    // pre-search menu.
    expect(expansionByGroupKey).toEqual({});
    const cleared = view({ groups: tree, query: "", expansionByGroupKey });
    expect(cleared.groups.find((g) => g.key === "npm:package.json")?.isExpanded).toBe(false);
  });

  it("reports when a search matched nothing", () => {
    const result = view({ groups: tree, query: "nothing-here" });

    expect(result.groups).toEqual([]);
    expect(result.hasNoMatches).toBe(true);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(view({ groups: tree, query: "  BUILD  " }).groups[0]?.scripts).toHaveLength(1);
  });
});

describe("recency", () => {
  const tree = groups({
    otto: ["daemon"],
    npm: [
      ["build", "tsc -b"],
      ["lint", "oxlint"],
      ["test", "vitest run"],
    ],
  });

  it("lifts recently-run discovered Scripts into an expanded Recent group", () => {
    const result = view({
      groups: tree,
      lastRunAtByScriptName: { "npm:test": 200, "npm:build": 100 },
    });

    const recent = result.groups[0];
    expect(recent?.key).toBe(RECENT_SCRIPT_GROUP_KEY);
    expect(recent?.isExpanded).toBe(true);
    expect(recent?.scripts.map((s) => s.label)).toEqual(["test", "build"]);
  });

  it("is absent until something has actually been run", () => {
    expect(view({ groups: tree }).groups[0]?.key).toBe(OTTO_SCRIPT_GROUP_KEY);
  });

  it("never lifts Otto's Scripts, which are already expanded and first", () => {
    const result = view({ groups: tree, lastRunAtByScriptName: { daemon: 300, "npm:build": 100 } });

    expect(result.groups[0]?.scripts.map((s) => s.scriptName)).toEqual(["npm:build"]);
  });

  it("caps the Recent group", () => {
    const npm: Array<[string, string]> = Array.from({ length: 20 }, (_, i) => [
      `task-${i}`,
      `npm run task-${i}`,
    ]);
    const lastRunAtByScriptName = Object.fromEntries(
      npm.map(([name], index) => [`npm:${name}`, index + 1]),
    );

    const result = view({ groups: groups({ npm }), lastRunAtByScriptName });

    expect(result.groups[0]?.scripts).toHaveLength(RECENT_SCRIPT_LIMIT);
  });

  it("orders inside a discovered group but leaves Otto's declared order alone", () => {
    const result = view({
      groups: tree,
      expansionByGroupKey: { "npm:package.json": true },
      lastRunAtByScriptName: { "npm:test": 500 },
    });

    const npmGroup = result.groups.find((group) => group.key === "npm:package.json");
    expect(npmGroup?.scripts.map((s) => s.label)).toEqual(["test", "build", "lint"]);
  });

  it("withdraws the Recent shortcut during a search, so no row is offered twice", () => {
    const result = view({
      groups: tree,
      query: "build",
      lastRunAtByScriptName: { "npm:build": 100 },
    });

    expect(result.groups.map((group) => group.key)).toEqual(["npm:package.json"]);
    expect(result.groups[0]?.scripts.map((s) => s.label)).toEqual(["build"]);
  });
});

describe("group headers", () => {
  it("hides the header in the pre-discovery shape: one always-expanded group", () => {
    const result = view({ groups: groups({ otto: ["daemon", "app"] }) });

    expect(result.showGroupHeaders).toBe(false);
    expect(result.visibleRowCount).toBe(2);
  });

  it("always shows the header of a lone collapsible group, or its rows are unreachable", () => {
    const result = view({ groups: groups({ npm: [["build", "tsc -b"]] }) });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.isExpanded).toBe(false);
    expect(result.showGroupHeaders).toBe(true);
  });
});

/**
 * Measured against this repo's real `otto.json` and root `package.json` rather
 * than a fixture. The whole slice exists because this menu had 100+ rows, so
 * the guard belongs on the actual worst case in the tree: if collapse-by-default
 * ever regresses, this fails with the real number.
 */
describe("this repo's own Scripts menu", () => {
  const repoRoot = join(__dirname, "..", "..", "..", "..", "..");
  const declared = JSON.parse(readFileSync(join(repoRoot, "otto.json"), "utf8")) as {
    scripts: Record<string, { command: string }>;
  };
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  const declaredNames = Object.keys(declared.scripts);
  const discoveredNames = Object.keys(manifest.scripts).filter(
    (name) => !declaredNames.includes(name),
  );

  const repoGroups: WorkspaceScriptGroup[] = [
    {
      key: OTTO_SCRIPT_GROUP_KEY,
      label: null,
      scripts: declaredNames.map((name) =>
        script(name, { command: declared.scripts[name]?.command }),
      ),
    },
    {
      key: "npm:package.json",
      label: "npm · package.json",
      scripts: discoveredNames.map((name) => discovered(name, `npm run ${name}`)),
    },
  ];

  it("opens to the curated set, not the long tail", () => {
    const result = view({ groups: repoGroups });

    expect(result.totalRowCount).toBeGreaterThan(100);
    expect(result.visibleRowCount).toBe(declaredNames.length);
    expect(result.showFilter).toBe(true);
    expect(result.groups.find((g) => g.key === "npm:package.json")?.isExpanded).toBe(false);
  });

  it("reaches any single script with one typed word", () => {
    const result = view({ groups: repoGroups, query: "typecheck" });

    expect(result.visibleRowCount).toBeGreaterThan(0);
    expect(result.visibleRowCount).toBeLessThan(12);
  });
});
