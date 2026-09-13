/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSidebarNavItems, type SidebarNavItem } from "@/sidebar-nav/model";
import { OTTO_SIDEBAR_NAV_BUILTINS } from "@/sidebar-nav/otto-sidebar-nav";
import { SidebarNavRows } from "./sidebar-nav-rows";

const state = vi.hoisted(() => ({ items: [] as SidebarNavItem[], events: [] as string[] }));
vi.mock("expo-router", () => ({
  router: { push: (route: string) => state.events.push(route) },
  usePathname: () => "/artifacts",
}));
vi.mock("react-native", () => ({ View: "div" }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (theme: unknown) => unknown) => factory({ spacing: { 1: 4, 2: 8 } }),
  },
}));
vi.mock("@/components/icons/material-icons", () => ({
  CalendarClock: () => null,
  Columns2: () => null,
  FileText: () => null,
  History: () => null,
  Network: () => null,
  Plus: () => null,
  Search: () => null,
}));
vi.mock("@/components/sidebar/sidebar-header-row", () => ({
  SidebarHeaderRow: ({
    label,
    onPress,
    testID,
  }: {
    label: string;
    onPress(): void;
    testID: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", onClick: onPress, "data-testid": testID },
      label,
    ),
}));
vi.mock("@/components/sidebar/sidebar-navigation-layout", () => ({
  sidebarNavigationLayoutStyles: { itemTwoColumn: {}, itemSingleColumn: {} },
}));
vi.mock("@/plugins/sidebar-items", () => ({
  PluginSidebarItemRow: ({ group }: { group: { title: string } }) =>
    React.createElement("button", { type: "button" }, group.title),
}));
vi.mock("@/sidebar-nav/use-sidebar-nav-items", () => ({
  useSidebarNavItems: () => ({ items: state.items }),
}));
vi.mock("@/hooks/use-shortcut-keys", () => ({ useShortcutKeys: () => null }));
vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => true }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  useActiveWorkspaceSelection: () => null,
}));
vi.mock("@/stores/session-store-hooks", () => ({ useWorkspace: () => null }));
vi.mock("@/projects/host-projects", () => ({ canCreateWorktreeForProjectKind: () => true }));
vi.mock("@/stores/keyboard-shortcuts-store", () => ({ useKeyboardShortcutsStore: () => vi.fn() }));
vi.mock("@/utils/host-routes", () => ({
  buildNewWorkspaceRoute: () => "/new",
  buildArtifactsRoute: () => "/artifacts",
  buildKanbanRoute: () => "/kanban",
  buildRunsRoute: () => "/runs",
  buildSchedulesRoute: () => "/schedules",
  buildSessionsRoute: () => "/sessions",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ??
      (
        {
          "sidebar.sections.schedules": "Schedules",
          "sidebar.actions.newWorkspace": "New workspace",
        } as Record<string, string>
      )[key] ??
      key,
  }),
}));

beforeEach(() => {
  state.items = resolveSidebarNavItems({
    pluginGroups: [],
    preferences: [],
    builtinItems: OTTO_SIDEBAR_NAV_BUILTINS,
  });
  state.events = [];
});
afterEach(cleanup);

function beforeNavigate() {
  state.events.push("close");
}

describe("SidebarNavRows with Otto descriptors", () => {
  it("renders every existing grid surface and leaves compact header actions in their own renderer", () => {
    render(<SidebarNavRows />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Artifacts",
      "Kanban",
      "Schedules",
      "Workflows",
    ]);
    expect(screen.queryByTestId("sidebar-sessions")).toBeNull();
    expect(screen.queryByTestId("sidebar-search")).toBeNull();
  });

  it("uses the current visible order and closes compact navigation before the route changes", () => {
    state.items = resolveSidebarNavItems({
      pluginGroups: [],
      builtinItems: OTTO_SIDEBAR_NAV_BUILTINS,
      preferences: [
        { key: "runs", visible: true },
        { key: "kanban", visible: false },
      ],
    });
    render(<SidebarNavRows isSingleColumn onBeforeNavigate={beforeNavigate} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Workflows",
      "Artifacts",
      "Schedules",
    ]);
    fireEvent.click(screen.getByTestId("sidebar-runs"));
    expect(state.events).toEqual(["close", "/runs"]);
  });

  it("keeps contributed plugin rows present alongside Otto navigation", () => {
    state.items = resolveSidebarNavItems({
      builtinItems: OTTO_SIDEBAR_NAV_BUILTINS,
      preferences: [],
      pluginGroups: [
        {
          key: "notes/sidebar/inbox",
          pluginId: "notes",
          contributionId: "inbox",
          title: "Notes inbox",
          icon: "FileText",
          targets: [],
        },
      ],
    });
    render(<SidebarNavRows />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Artifacts",
      "Kanban",
      "Schedules",
      "Workflows",
      "Notes inbox",
    ]);
  });
});
