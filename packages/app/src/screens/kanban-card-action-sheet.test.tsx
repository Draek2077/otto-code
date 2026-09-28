/** @vitest-environment jsdom */
/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- Mock inputs bridge DOM events to React Native callbacks. */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KanbanColumn } from "@otto-code/protocol/kanban";
import { KanbanCardActionSheet } from "./kanban-card-action-sheet";

vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <span data-testid={testID}>{children}</span>
  ),
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    children,
    footer,
    testID,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
    testID: string;
  }) => (
    <div data-testid={testID}>
      {children}
      {footer}
    </div>
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
vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: ({
    onChangeText,
    testID,
  }: {
    onChangeText(value: string): void;
    testID: string;
  }) => (
    <input
      data-testid={testID}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value)}
    />
  ),
}));

const firstColumn: KanbanColumn = { id: "todo", name: "To do", cards: [] };

afterEach(cleanup);

describe("Kanban card action sheet", () => {
  it("creates in the first workflow column with an optional description", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <KanbanCardActionSheet
        action="create"
        firstColumn={firstColumn}
        providerId="github"
        onClose={onClose}
        onCreate={onCreate}
        onLink={vi.fn()}
      />,
    );
    expect(screen.getByText("New cards start in To do")).toBeTruthy();
    fireEvent.change(screen.getByTestId("kanban-new-card-input"), {
      target: { value: " Fix bug " },
    });
    fireEvent.change(screen.getByTestId("kanban-new-card-description"), {
      target: { value: " Details " },
    });
    fireEvent.click(screen.getByTestId("kanban-new-card-confirm"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("todo", "Fix bug", "Details"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("keeps a failed link in the sheet for correction", async () => {
    const onLink = vi.fn().mockRejectedValue(new Error("Item not on this board"));
    const onClose = vi.fn();
    render(
      <KanbanCardActionSheet
        action="link"
        firstColumn={firstColumn}
        providerId="github"
        onClose={onClose}
        onCreate={vi.fn()}
        onLink={onLink}
      />,
    );
    fireEvent.change(screen.getByTestId("kanban-link-input"), {
      target: { value: "https://github.com/example/repo/issues/3" },
    });
    fireEvent.click(screen.getByTestId("kanban-link-confirm"));
    expect((await screen.findByTestId("kanban-action-error")).textContent).toContain(
      "Item not on this board",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
