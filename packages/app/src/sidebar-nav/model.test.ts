import { describe, expect, it } from "vitest";
import type { PluginSidebarGroup } from "@/plugins/sidebar-groups";
import {
  groupSidebarNavigationRows,
  OTTO_SIDEBAR_NAV_BUILTINS,
  sidebarNavPlacement,
} from "./otto-sidebar-nav";
import {
  builtinSidebarNavShortcutAction,
  moveSidebarNavItem,
  pluginSidebarNavKey,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type SidebarNavItem,
  type SidebarNavPreference,
} from "./model";

function group(pluginId: string, contributionId: string): PluginSidebarGroup {
  return {
    key: `${pluginId}/sidebar/${contributionId}`,
    pluginId,
    contributionId,
    title: contributionId,
    icon: "puzzle",
    targets: [],
  };
}

const kanban = group("kanban", "board");
const notes = group("notes", "inbox");
const kanbanKey = pluginSidebarNavKey(kanban);
const notesKey = pluginSidebarNavKey(notes);

function summarize(items: readonly SidebarNavItem[]): SidebarNavPreference[] {
  return items.map(({ key, visible }) => ({ key, visible }));
}

describe("resolveSidebarNavItems", () => {
  it("yields builtins then plugins, all visible, when nothing is stored", () => {
    const items = resolveSidebarNavItems({ pluginGroups: [kanban, notes], preferences: [] });

    expect(summarize(items)).toEqual([
      { key: "new-workspace", visible: true },
      { key: "history", visible: true },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
      { key: kanbanKey, visible: true },
      { key: notesKey, visible: true },
    ]);
    expect(items[4]).toEqual({ kind: "plugin", key: kanbanKey, group: kanban, visible: true });
    expect(items[0]).toEqual({
      kind: "builtin",
      key: "new-workspace",
      id: "new-workspace",
      visible: true,
    });
  });

  it("keeps the stored order and appends newly available items as visible", () => {
    const items = resolveSidebarNavItems({
      pluginGroups: [notes, kanban],
      preferences: [
        { key: kanbanKey, visible: false },
        { key: "schedules", visible: true },
        { key: "new-workspace", visible: false },
      ],
    });

    expect(summarize(items)).toEqual([
      { key: kanbanKey, visible: false },
      { key: "schedules", visible: true },
      { key: "new-workspace", visible: false },
      { key: "history", visible: true },
      { key: "search", visible: true },
      { key: notesKey, visible: true },
    ]);
  });

  it("skips keys that are unknown or not currently available", () => {
    const items = resolveSidebarNavItems({
      pluginGroups: [],
      preferences: [
        { key: notesKey, visible: false },
        { key: "bogus", visible: true },
        { key: "history", visible: true },
      ],
    });

    expect(items.map((item) => item.key)).toEqual([
      "history",
      "new-workspace",
      "search",
      "schedules",
    ]);
  });

  it("lets the first of duplicate keys win", () => {
    const items = resolveSidebarNavItems({
      pluginGroups: [],
      preferences: [
        { key: "history", visible: false },
        { key: "history", visible: true },
      ],
    });

    expect(summarize(items)).toEqual([
      { key: "history", visible: false },
      { key: "new-workspace", visible: true },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
    ]);
  });
});

describe("setSidebarNavItemVisible", () => {
  it("toggles one item and writes the full resolved order", () => {
    const items = resolveSidebarNavItems({ pluginGroups: [kanban], preferences: [] });

    const next = setSidebarNavItemVisible({ items, key: "search", visible: false, previous: [] });

    expect(next).toEqual([
      { key: "new-workspace", visible: true },
      { key: "history", visible: true },
      { key: "search", visible: false },
      { key: "schedules", visible: true },
      { key: kanbanKey, visible: true },
    ]);
  });

  it("carries preferences for unavailable plugins through an unrelated edit", () => {
    const previous: SidebarNavPreference[] = [
      { key: notesKey, visible: false },
      { key: "history", visible: true },
    ];
    const items = resolveSidebarNavItems({ pluginGroups: [], preferences: previous });

    const next = setSidebarNavItemVisible({ items, key: "history", visible: false, previous });

    expect(next).toEqual([
      { key: notesKey, visible: false },
      { key: "history", visible: false },
      { key: "new-workspace", visible: true },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
    ]);
  });

  it("keeps an unavailable plugin in its configured position", () => {
    const previous: SidebarNavPreference[] = [
      { key: "new-workspace", visible: true },
      { key: notesKey, visible: false },
      { key: "history", visible: true },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
    ];
    const items = resolveSidebarNavItems({ pluginGroups: [], preferences: previous });

    const next = setSidebarNavItemVisible({ items, key: "history", visible: false, previous });

    expect(next).toEqual([
      { key: "new-workspace", visible: true },
      { key: notesKey, visible: false },
      { key: "history", visible: false },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
    ]);
    expect(summarize(resolveSidebarNavItems({ pluginGroups: [notes], preferences: next }))).toEqual(
      next,
    );
  });

  it("returns the normalized list unchanged for an unknown key", () => {
    const items = resolveSidebarNavItems({ pluginGroups: [], preferences: [] });

    const next = setSidebarNavItemVisible({ items, key: "bogus", visible: false, previous: [] });

    expect(next).toEqual(summarize(items));
  });
});

describe("moveSidebarNavItem", () => {
  const items = resolveSidebarNavItems({ pluginGroups: [kanban], preferences: [] });

  it("moves an item up", () => {
    const next = moveSidebarNavItem({ items, key: "search", direction: "up", previous: [] });

    expect(next.map((preference) => preference.key)).toEqual([
      "new-workspace",
      "search",
      "history",
      "schedules",
      kanbanKey,
    ]);
  });

  it("moves an item down", () => {
    const next = moveSidebarNavItem({ items, key: "schedules", direction: "down", previous: [] });

    expect(next.map((preference) => preference.key)).toEqual([
      "new-workspace",
      "history",
      "search",
      kanbanKey,
      "schedules",
    ]);
  });

  it("leaves the order alone at the boundaries", () => {
    const first = moveSidebarNavItem({
      items,
      key: "new-workspace",
      direction: "up",
      previous: [],
    });
    const last = moveSidebarNavItem({ items, key: kanbanKey, direction: "down", previous: [] });

    expect(first).toEqual(summarize(items));
    expect(last).toEqual(summarize(items));
  });

  it("returns the normalized list unchanged for an unknown key", () => {
    const next = moveSidebarNavItem({ items, key: "bogus", direction: "down", previous: [] });

    expect(next).toEqual(summarize(items));
  });

  it("drops duplicate carried-over keys", () => {
    const previous: SidebarNavPreference[] = [
      { key: notesKey, visible: false },
      { key: notesKey, visible: true },
    ];

    const next = moveSidebarNavItem({ items, key: "history", direction: "up", previous });

    expect(next.filter((preference) => preference.key === notesKey)).toEqual([
      { key: notesKey, visible: false },
    ]);
  });
});

describe("builtinSidebarNavShortcutAction", () => {
  it("maps only the builtins that have a keyboard shortcut", () => {
    expect(builtinSidebarNavShortcutAction("new-workspace")).toBe("new-workspace");
    expect(builtinSidebarNavShortcutAction("search")).toBe("toggle-command-center");
    expect(builtinSidebarNavShortcutAction("history")).toBeNull();
    expect(builtinSidebarNavShortcutAction("schedules")).toBeNull();
  });
});

function sidebarRowKeys(row: readonly SidebarNavItem[]) {
  return row.map((item) => item.key);
}

describe("Otto sidebar preservation", () => {
  const resolve = (preferences: readonly SidebarNavPreference[] = [], pluginGroups = [notes]) =>
    resolveSidebarNavItems({ preferences, pluginGroups, builtinItems: OTTO_SIDEBAR_NAV_BUILTINS });
  const navigation = (items: readonly SidebarNavItem[]) =>
    items.filter((item) => item.visible && sidebarNavPlacement(item) === "navigation");
  const header = (items: readonly SidebarNavItem[]) =>
    items.filter((item) => item.visible && sidebarNavPlacement(item) === "workspace-header");

  it("keeps the frozen grid, full plugin row and compact header actions by default", () => {
    const items = resolve();
    expect(groupSidebarNavigationRows(navigation(items)).map(sidebarRowKeys)).toEqual([
      ["artifacts", "kanban"],
      ["schedules", "runs"],
      [notesKey],
    ]);
    expect(header(items).map((item) => item.key)).toEqual(["history", "search"]);
    expect(items.find((item) => item.key === "new-workspace")?.visible).toBe(false);
  });

  it("hides only the selected surface and keeps the other Otto destinations", () => {
    const previous = setSidebarNavItemVisible({
      items: resolve(),
      key: "kanban",
      visible: false,
      previous: [],
    });
    expect(navigation(resolve(previous)).map((item) => item.key)).toEqual([
      "artifacts",
      "schedules",
      "runs",
      notesKey,
    ]);
    expect(header(resolve(previous)).map((item) => item.key)).toEqual(["history", "search"]);
  });

  it("reorders compact actions without migrating them into navigation rows", () => {
    const items = resolve();
    const previous = moveSidebarNavItem({
      items: header(items),
      key: "search",
      direction: "up",
      previous: [],
    });
    expect(header(resolve(previous)).map((item) => item.key)).toEqual(["search", "history"]);
    expect(navigation(resolve(previous)).map((item) => item.key)).toEqual([
      "artifacts",
      "kanban",
      "schedules",
      "runs",
      notesKey,
    ]);
  });

  it("preserves hidden disconnected plugin preferences through edits in either placement", () => {
    const preferences = [
      { key: notesKey, visible: false },
      { key: "history", visible: false },
    ];
    const available = resolve(preferences, []);
    const changed = setSidebarNavItemVisible({
      items: available,
      key: "runs",
      visible: false,
      previous: preferences,
    });
    const restored = resolve(changed);
    expect(restored.find((item) => item.key === notesKey)?.visible).toBe(false);
    expect(restored.find((item) => item.key === "history")?.visible).toBe(false);
    expect(restored.find((item) => item.key === "runs")?.visible).toBe(false);
    expect(restored.find((item) => item.key === "artifacts")?.visible).toBe(true);
  });

  it("keeps plugin rows full width when moved between two builtin shortcuts", () => {
    const items = resolve([
      { key: "artifacts", visible: true },
      { key: notesKey, visible: true },
      { key: "kanban", visible: true },
    ]);
    expect(groupSidebarNavigationRows(navigation(items)).slice(0, 3).map(sidebarRowKeys)).toEqual([
      ["artifacts"],
      [notesKey],
      ["kanban", "schedules"],
    ]);
  });

  it("makes the optional global workspace shortcut available without replacing project actions", () => {
    const preferences = setSidebarNavItemVisible({
      items: resolve(),
      key: "new-workspace",
      visible: true,
      previous: [],
    });
    expect(navigation(resolve(preferences)).map((item) => item.key)).toEqual([
      "artifacts",
      "kanban",
      "schedules",
      "runs",
      "new-workspace",
      notesKey,
    ]);
  });
});
