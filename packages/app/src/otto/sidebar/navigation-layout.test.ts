import { describe, expect, it } from "vitest";
import type { SidebarNavItem } from "@/sidebar-nav/model";
import {
  isWorkspaceHeaderAction,
  sidebarShortcutColumns,
  workspaceHeaderActions,
} from "./navigation-layout";

const items: SidebarNavItem<"header">[] = [
  { kind: "builtin", key: "new-workspace", id: "new-workspace", visible: true },
  { kind: "builtin", key: "history", id: "history", visible: true },
  { kind: "builtin", key: "search", id: "search", visible: true },
  { kind: "builtin", key: "schedules", id: "schedules", visible: true },
  {
    kind: "plugin",
    key: "plugin:otto-artifacts:artifacts",
    visible: true,
    group: {
      kind: "item",
      key: "otto-artifacts/artifacts",
      pluginId: "otto-artifacts",
      contributionId: "artifacts",
      title: "Artifacts",
      targets: [],
    },
  },
];

describe("Otto sidebar navigation placement", () => {
  it("keeps features in the shortcut grid and puts creation last in the workspace actions", () => {
    expect(items.filter((item) => !isWorkspaceHeaderAction(item)).map((item) => item.key)).toEqual([
      "schedules",
      "plugin:otto-artifacts:artifacts",
    ]);
    expect(workspaceHeaderActions(items).map((item) => item.key)).toEqual([
      "history",
      "search",
      "new-workspace",
    ]);
    expect(items[0].key).toBe("new-workspace");
  });
  it("honors visibility and the configured order of History and Search", () => {
    const ordered = [items[2], items[1], { ...items[0], visible: false }, items[3]];
    expect(workspaceHeaderActions(ordered).map((item) => item.key)).toEqual(["search", "history"]);
    expect(
      workspaceHeaderActions(items.map((item) => Object.assign({}, item, { visible: false }))),
    ).toEqual([]);
  });
  it("does not move a plugin that uses a builtin action's name", () => {
    const item: SidebarNavItem<"header"> = {
      kind: "plugin",
      key: "plugin:example:history",
      visible: true,
      group: {
        kind: "legacy",
        key: "example/history",
        pluginId: "example",
        contributionId: "history",
        title: "History",
        icon: "History",
        targets: [],
      },
    };
    expect(isWorkspaceHeaderAction(item)).toBe(false);
    expect(workspaceHeaderActions([item])).toEqual([]);
  });
  it.each([
    { width: 240, columns: 1 },
    { width: 271, columns: 1 },
    { width: 272, columns: 2 },
    { width: 320, columns: 2 },
    { width: 800, columns: 2 },
    { width: 0, columns: 1 },
    { width: Number.NaN, columns: 1 },
    { width: Number.POSITIVE_INFINITY, columns: 1 },
  ])("uses $columns columns at width $width", ({ width, columns }) => {
    expect(sidebarShortcutColumns(width)).toBe(columns);
  });
});
