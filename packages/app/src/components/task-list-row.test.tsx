/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 2: 8 },
    fontSize: { sm: 13 },
    colors: {
      foreground: "#foreground",
      foregroundMuted: "#muted",
      foregroundExtraMuted: "#extra-muted",
      statusInfo: "#running",
    },
  },
}));

vi.mock("react-native", () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", props, children),
  Text: ({ children, style }: React.PropsWithChildren<{ style?: Record<string, unknown>[] }>) => {
    const resolvedStyle = Object.assign({}, ...(style ?? []).filter(Boolean));
    return React.createElement(
      "span",
      {
        "data-color": resolvedStyle.color,
        "data-decoration": resolvedStyle.textDecorationLine,
      },
      children,
    );
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (value: typeof theme) => unknown) => factory(theme),
  },
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({ uniProps, ...props }: Record<string, unknown>) => {
      const themedProps = (uniProps as (value: typeof theme) => Record<string, unknown>)(theme);
      return React.createElement(Component, { ...props, ...themedProps });
    },
}));

// The row imports its glyphs from the Material Symbols barrel, so that is what gets mocked,
// and the stub set is derived from the barrel's own exports rather than hand-listed - a named
// mock goes stale the moment the row reaches for another icon.
vi.mock("@/components/icons/material-icons", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return Object.fromEntries(Object.keys(actual).map((name) => [name, createIcon(name)]));
});

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { TaskListRow } from "./task-list-row";

const pendingTask = { text: "Queued", completed: false } as const;
const runningTask = {
  text: "Run checks",
  activeForm: "Running checks",
  completed: false,
  status: "in_progress",
} as const;
const completedTask = { text: "Finished", completed: true, status: "completed" } as const;

describe("TaskListRow", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps pending tasks muted", () => {
    act(() => root.render(<TaskListRow task={pendingTask} />));

    expect(container.querySelector('[data-icon="Circle"]')?.getAttribute("color")).toBe("#muted");
    expect(container.querySelector("[data-color]")?.getAttribute("data-color")).toBe("#muted");
  });

  it("foregrounds only the running task with the running blue circle dot", () => {
    act(() => root.render(<TaskListRow task={runningTask} />));

    expect(container.textContent).toBe("Running checks");
    expect(container.querySelector('[data-icon="CircleDot"]')?.getAttribute("color")).toBe(
      "#running",
    );
    expect(container.querySelector("[data-color]")?.getAttribute("data-color")).toBe("#foreground");
  });

  it("extra-mutes completed tasks with a circle check", () => {
    act(() => root.render(<TaskListRow task={completedTask} />));

    expect(container.querySelector('[data-icon="CircleCheck"]')?.getAttribute("color")).toBe(
      "#extra-muted",
    );
    const text = container.querySelector("[data-color]");
    expect(text?.getAttribute("data-color")).toBe("#extra-muted");
    expect(text?.getAttribute("data-decoration")).toBe("line-through");
  });
});
