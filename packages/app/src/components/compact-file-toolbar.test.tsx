/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompactFileToolbar, type CompactFileToolbarAction } from "./compact-file-toolbar";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8 },
    colors: {
      border: "#444",
      foregroundMuted: "#aaa",
      surfaceInteractiveHover: "#222",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({ uniProps, ...rest }: { uniProps?: (currentTheme: unknown) => Record<string, unknown> }) =>
      React.createElement(Component, { ...rest, ...(uniProps ? uniProps(theme) : {}) }),
}));

vi.mock("@/components/icons/material-icons", () => ({
  MoreHorizontal: () => <span />,
}));

vi.mock("@/components/file-view-mode-bar", () => ({
  FileViewModeBar: () => <div data-testid="compact-file-mode-switcher" />,
}));

vi.mock("@/components/ui/toolbar-icon-button", () => ({
  ToolbarIconButton: ({
    label,
    onPress,
    testID,
  }: {
    label: string;
    onPress: () => void;
    testID: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress}>
      {label}
    </button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuTrigger: ({
    children,
    testID,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    testID: string;
    accessibilityLabel: string;
  }) => (
    <button type="button" data-testid={testID} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    testID,
  }: {
    children: React.ReactNode;
    onSelect: () => void;
    testID: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

const Icon = () => null;
const modeBar = {
  mode: "editor" as const,
  showSplit: false,
  onChange: vi.fn(),
  formatted: null,
};

function action(id: string, label: string, onPress = vi.fn()): CompactFileToolbarAction {
  return { id, label, Icon, onPress };
}

describe("CompactFileToolbar", () => {
  it("keeps editing commands direct and exposes contextual commands in the action sheet", () => {
    const save = vi.fn();
    const history = vi.fn();
    const refine = vi.fn();

    render(
      <CompactFileToolbar
        primaryActions={[action("save", "Save", save)]}
        moreActions={[action("history", "History", history), action("refine", "Refine", refine)]}
        moreActionsLabel="More actions"
        modeBar={null}
      />,
    );

    fireEvent.click(screen.getByTestId("compact-file-toolbar-save"));
    fireEvent.click(screen.getByTestId("compact-file-toolbar-history"));
    fireEvent.click(screen.getByTestId("compact-file-toolbar-refine"));

    expect(save).toHaveBeenCalledOnce();
    expect(history).toHaveBeenCalledOnce();
    expect(refine).toHaveBeenCalledOnce();
    expect(screen.getByTestId("compact-file-toolbar-more").getAttribute("aria-label")).toBe(
      "More actions",
    );
  });

  it("keeps the mode switcher in the compact chrome", () => {
    render(
      <CompactFileToolbar
        primaryActions={[]}
        moreActions={[]}
        moreActionsLabel="More actions"
        modeBar={modeBar}
      />,
    );

    expect(screen.getByTestId("compact-file-mode-switcher")).not.toBeNull();
  });
});
