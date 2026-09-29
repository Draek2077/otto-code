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
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, testID }: { children: React.ReactNode; testID: string }) => (
    <button type="button" data-testid={testID}>
      {children}
    </button>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    testID,
  }: {
    children: React.ReactNode;
    onSelect(): void;
    testID: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onSelect}>
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
const columns = [
  { id: "todo", name: "To Do", cards: [card] },
  { id: "doing", name: "In Progress", cards: [] },
];
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
        columns={columns}
        currentColumnId="todo"
        fields={fields}
        values={[{ fieldId: "notes", display: "Before" }]}
        canDelete={false}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("More fields")).toBeTruthy();
    fireEvent.click(screen.getByText("More fields"));
    expect(screen.getByText(/No access/)).toBeTruthy();
    expect(screen.queryByTestId("kanban-detail-delete")).toBeNull();
    expect(screen.queryByTestId("kanban-field-input-notes")).toBeNull();
    fireEvent.click(screen.getByTestId("kanban-field-edit-notes"));
    fireEvent.change(screen.getByTestId("kanban-field-input-notes"), {
      target: { value: "After" },
    });
    fireEvent.click(screen.getByTestId("kanban-field-save-notes"));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith("notes", { kind: "text", text: "After" }),
    );
    await waitFor(() => expect(screen.queryByTestId("kanban-field-input-notes")).toBeNull());
  });

  it("keeps the sheet open and reports a failed save", async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error("Provider rejected edit"));
    render(
      <KanbanCardDetail
        card={card}
        columns={columns}
        currentColumnId="todo"
        fields={fields}
        values={[]}
        canDelete={true}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("More fields"));
    fireEvent.click(screen.getByTestId("kanban-field-edit-notes"));
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
        columns={columns}
        currentColumnId="todo"
        fields={titleFields}
        values={titleValues}
        canDelete={false}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByText("Long migrated issue description")).toBeNull();
    fireEvent.click(screen.getByText("Description"));
    expect(screen.getByText("Long migrated issue description")).toBeTruthy();
  });

  it("shows status in the overview and moves through the board columns", async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(
      <KanbanCardDetail
        card={card}
        columns={columns}
        currentColumnId="todo"
        fields={titleFields}
        values={titleValues}
        canDelete={false}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onMove={onMove}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("To Do")).toBeTruthy();
    expect(screen.getByTestId("kanban-detail-change-status")).toBeTruthy();
    fireEvent.click(screen.getByTestId("kanban-detail-status-doing"));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("doing"));
  });

  it("keeps the status control available when a provider rejects the move", async () => {
    const onMove = vi.fn().mockRejectedValue(new Error("Transition unavailable"));
    render(
      <KanbanCardDetail
        card={card}
        columns={columns}
        currentColumnId="todo"
        fields={[]}
        values={[]}
        canDelete={false}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onMove={onMove}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("kanban-detail-status-doing"));
    expect((await screen.findByTestId("kanban-detail-error")).textContent).toContain(
      "Transition unavailable",
    );
    expect(screen.getByTestId("kanban-detail-change-status")).toBeTruthy();
  });
});
