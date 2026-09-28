/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KanbanCard, KanbanField } from "@otto-code/protocol/kanban";
import { KanbanCardDetail } from "./kanban-card-detail";

vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  View: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <span data-testid={testID}>{children}</span>
  ),
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
    fireEvent.change(screen.getByTestId("kanban-field-input-notes"), {
      target: { value: "Change" },
    });
    fireEvent.click(screen.getByTestId("kanban-field-save-notes"));
    expect((await screen.findByTestId("kanban-detail-error")).textContent).toContain(
      "Provider rejected edit",
    );
    expect(screen.getByTestId("kanban-card-detail")).toBeTruthy();
  });
});
