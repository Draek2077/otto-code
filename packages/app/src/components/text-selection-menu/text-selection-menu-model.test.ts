import { describe, expect, it } from "vitest";

import { resolveTextSelectionMenuActions } from "./text-selection-menu-model";

describe("resolveTextSelectionMenuActions", () => {
  it("offers only actions that have a meaningful static-text target", () => {
    expect(
      resolveTextSelectionMenuActions({ editable: false, hasSelection: true, canSelectAll: true }),
    ).toEqual([
      { id: "copy", enabled: true },
      { id: "selectAll", enabled: true },
    ]);
  });

  it("keeps copy disabled when static text has no selection", () => {
    expect(
      resolveTextSelectionMenuActions({ editable: false, hasSelection: false, canSelectAll: true }),
    ).toEqual([
      { id: "copy", enabled: false },
      { id: "selectAll", enabled: true },
    ]);
  });

  it("gives editable controls the complete cut, copy, paste, and select-all set", () => {
    expect(
      resolveTextSelectionMenuActions({ editable: true, hasSelection: false, canSelectAll: true }),
    ).toEqual([
      { id: "cut", enabled: false },
      { id: "copy", enabled: false },
      { id: "paste", enabled: true },
      { id: "selectAll", enabled: true },
    ]);
  });
});
