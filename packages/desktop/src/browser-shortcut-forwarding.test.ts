import { describe, expect, test } from "vitest";

import {
  isForwardableOttoShortcutInput,
  type ForwardableShortcutInput,
} from "./browser-shortcut-forwarding.js";

function keyDown(overrides: Partial<ForwardableShortcutInput>): ForwardableShortcutInput {
  return { type: "keyDown", meta: false, control: false, key: "a", ...overrides };
}

describe("isForwardableOttoShortcutInput", () => {
  // The regression: forwarding this took Cmd/Ctrl+Enter away from the page and
  // gave it to a shortcut layer that declines to bind it, so sending or queueing
  // a message from Otto running inside the browser pane did nothing at all.
  test("does not forward Ctrl+Enter, so the page keeps its send chord", () => {
    expect(isForwardableOttoShortcutInput(keyDown({ control: true, key: "Enter" }))).toBe(false);
  });

  test("does not forward Cmd+Enter either", () => {
    expect(isForwardableOttoShortcutInput(keyDown({ meta: true, key: "Enter" }))).toBe(false);
  });

  test("still forwards Otto's own chrome shortcuts", () => {
    expect(isForwardableOttoShortcutInput(keyDown({ control: true, key: "b" }))).toBe(true);
    expect(isForwardableOttoShortcutInput(keyDown({ meta: true, key: "T" }))).toBe(true);
  });

  test("ignores keys pressed without Cmd or Ctrl", () => {
    expect(isForwardableOttoShortcutInput(keyDown({ key: "b" }))).toBe(false);
  });

  test("ignores anything that is not a key down", () => {
    expect(
      isForwardableOttoShortcutInput(keyDown({ type: "keyUp", control: true, key: "b" })),
    ).toBe(false);
  });
});
