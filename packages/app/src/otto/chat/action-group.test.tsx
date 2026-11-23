/** @vitest-environment jsdom */
import React, { act, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import { ActionGroupView } from "./action-group";
import type { ActionGroup, ActionMember } from "./action-groups";

void testI18n;
// This unit exercises member admission at the badge's lazy-render boundary. The
// E2E journey exercises the real badge and transcript viewport in Chromium.
vi.mock("@/components/message", () => ({
  ExpandableBadge: ({
    isExpanded,
    onToggle,
    renderDetails,
  }: {
    isExpanded: boolean;
    onToggle: () => void;
    renderDetails: () => ReactNode;
  }) => (
    <div>
      <button type="button" onClick={onToggle}>
        Actions
      </button>
      {isExpanded ? renderDetails() : null}
    </div>
  ),
}));
let root: Root | undefined;
let container: HTMLDivElement | undefined;
let renderCount = 0;
const group: ActionGroup = {
  id: "long-run",
  counts: { thought: 2000 },
  failedCount: 0,
  members: Array.from({ length: 2000 }, (_, index) => ({
    kind: "thought",
    id: `member-${index}`,
    timestamp: new Date(0),
    text: `Thought ${index}`,
    status: "ready",
  })),
};
function renderMember(member: ActionMember) {
  renderCount++;
  return <div data-testid="mounted-action">{member.id}</div>;
}
function Fixture() {
  const [expanded, setExpanded] = useState(false);
  const change = useCallback((_id: string, value: boolean) => {
    setExpanded(value);
  }, []);
  return (
    <ActionGroupView
      group={group}
      expanded={expanded}
      onExpandedChange={change}
      isLastInSequence
      renderMember={renderMember}
    />
  );
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  renderCount = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

test("a collapsed 2,000-action run mounts no members; expansion is bounded and collapse releases them", () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Fixture />));
  const view = within(container);
  expect(renderCount).toBe(0);
  expect(view.queryAllByTestId("mounted-action")).toHaveLength(0);
  const toggle = () => act(() => view.getAllByRole("button")[0].click());
  toggle();
  expect(view.queryAllByTestId("mounted-action")).toHaveLength(25);
  act(() => view.getByRole("button", { name: "Show 25 more actions" }).click());
  expect(view.queryAllByTestId("mounted-action")).toHaveLength(50);
  toggle();
  expect(view.queryAllByTestId("mounted-action")).toHaveLength(0);
  toggle();
  expect(view.queryAllByTestId("mounted-action")).toHaveLength(25);
});
