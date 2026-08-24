import { describe, expect, it } from "vitest";
import { normalizePinnedProjectSearchToolbarItems } from "./project-search-preferences-store";

describe("normalizePinnedProjectSearchToolbarItems", () => {
  it("falls back to the defaults when nothing was persisted", () => {
    expect(normalizePinnedProjectSearchToolbarItems(undefined)).toEqual(["wrap", "expand"]);
  });

  it("keeps an empty selection empty - the reader unpinned everything", () => {
    expect(normalizePinnedProjectSearchToolbarItems([])).toEqual([]);
  });

  it("drops ids this build no longer offers", () => {
    expect(normalizePinnedProjectSearchToolbarItems(["expand", "whitespace"])).toEqual(["expand"]);
  });

  it("returns the catalog order, not the order the items were pinned in", () => {
    expect(normalizePinnedProjectSearchToolbarItems(["refresh", "wrap"])).toEqual([
      "wrap",
      "refresh",
    ]);
  });
});
