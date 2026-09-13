/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProjectEmptyState } from "./empty-states";
vi.mock("react-native", () => ({ View: "div", Text: "span" }));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/icons/material-icons", () => ({ Import: () => null, Plus: () => null }));
vi.mock("@/stores/sidebar-view-store", () => ({ useSidebarViewStore: () => vi.fn() }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ onPress, children }: { onPress(): void; children: React.ReactNode }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));
afterEach(cleanup);
describe("sidebar empty workspace actions", () => {
  it("keeps Add project and Import session as independent actions", () => {
    const add = vi.fn(),
      importSession = vi.fn();
    render(<SidebarProjectEmptyState onAddProject={add} onImportSession={importSession} />);
    fireEvent.click(screen.getByRole("button", { name: "importSession.title" }));
    expect(importSession).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "sidebar.actions.addProject" }));
    expect(add).toHaveBeenCalledTimes(1);
  });
  it("does not show an inert import action for a caller without an import handler", () => {
    render(<SidebarProjectEmptyState onAddProject={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "importSession.title" })).toBeNull();
    expect(screen.getByRole("button", { name: "sidebar.actions.addProject" })).toBeTruthy();
  });
});
