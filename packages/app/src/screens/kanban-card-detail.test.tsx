/** @vitest-environment jsdom */
/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- Mock tabs bridge DOM events to React Native callbacks. */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KanbanCard, KanbanField } from "@otto-code/protocol/kanban";
import { KanbanCardDetail } from "./kanban-card-detail";

vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-native", () => ({
  View: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <span data-testid={testID}>{children}</span>
  ),
  Linking: { openURL: vi.fn() },
  Pressable: ({
    children,
    onPress,
    testID,
    disabled,
  }: {
    children: React.ReactNode;
    onPress(): void;
    testID?: string;
    disabled?: boolean;
  }) => (
    <button type="button" data-testid={testID} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
    disabled,
  }: {
    children: React.ReactNode;
    onPress(): void;
    testID?: string;
    disabled?: boolean;
  }) => (
    <button type="button" data-testid={testID} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/tabbed-modal-sheet", () => ({
  TabbedModalSheet: ({
    children,
    footer,
    tabs,
    activeTab,
    onTabChange,
    testID,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
    tabs: { value: string; label: string }[];
    activeTab: string;
    onTabChange(value: string): void;
    testID: string;
  }) => (
    <div data-testid={testID}>
      {tabs.map((tab) => (
        <button key={tab.value} type="button" onClick={() => onTabChange(tab.value)}>
          {tab.label}
          {tab.value === activeTab ? " (selected)" : ""}
        </button>
      ))}
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: ({
    onChangeText,
    initialValue,
    testID,
  }: {
    onChangeText(value: string): void;
    initialValue: string;
    testID: string;
  }) =>
    React.createElement("input", {
      "data-testid": testID,
      defaultValue: initialValue,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
    }),
}));

const card: KanbanCard = {
  id: "card-1",
  title: "Fix the bug",
  status: "To Do",
  assignees: [],
  rawProviderId: "item-1",
};
const cardWithBody: KanbanCard = { ...card, body: "Long migrated issue description" };
const titleFields: KanbanField[] = [{ id: "title", name: "Title", kind: "text", editable: true }];
const titleValues = [{ fieldId: "title", display: card.title }];
const fields: KanbanField[] = [
  { id: "notes", name: "Notes", kind: "text", editable: true },
  { id: "locked", name: "Locked", kind: "text", editable: false, readOnlyReason: "No access" },
];

afterEach(cleanup);

describe("Kanban card detail", () => {
  it("shows provider fields and saves an edited value", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <KanbanCardDetail
        card={card}
        fields={fields}
        values={[{ fieldId: "notes", display: "Before" }]}
        canDelete={false}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Fields")).toBeTruthy();
    fireEvent.click(screen.getByText("Fields"));
    expect(screen.getByText(/No access/)).toBeTruthy();
    expect(screen.queryByTestId("kanban-detail-delete")).toBeNull();
    fireEvent.change(screen.getByTestId("kanban-field-input-notes"), {
      target: { value: "After" },
    });
    fireEvent.click(screen.getByTestId("kanban-field-save-notes"));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith("notes", { kind: "text", text: "After" }),
    );
  });

  it("keeps the sheet open and reports a failed save", async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error("Provider rejected edit"));
    render(
      <KanbanCardDetail
        card={card}
        fields={fields}
        values={[]}
        canDelete={true}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Fields"));
    fireEvent.change(screen.getByTestId("kanban-field-input-notes"), {
      target: { value: "Change" },
    });
    fireEvent.click(screen.getByTestId("kanban-field-save-notes"));
    expect((await screen.findByTestId("kanban-detail-error")).textContent).toContain(
      "Provider rejected edit",
    );
    expect(screen.getByTestId("kanban-card-detail")).toBeTruthy();
  });

  it("keeps a long card body off the details tab", () => {
    render(
      <KanbanCardDetail
        card={cardWithBody}
        fields={titleFields}
        values={titleValues}
        canDelete={false}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByText("Long migrated issue description")).toBeNull();
    fireEvent.click(screen.getByText("Description"));
    expect(screen.getByText("Long migrated issue description")).toBeTruthy();
  });
});
