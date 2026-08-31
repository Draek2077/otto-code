import { describe, expect, it } from "vitest";
import { buildWorkingDirectorySuggestions } from "./working-directory-suggestions";

describe("buildWorkingDirectorySuggestions", () => {
  it("returns de-duplicated recommendations when query is empty", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: ["/Users/me/projects/otto", "/Users/me/projects/otto"],
      serverPaths: ["/Users/me/projects/playground"],
      query: "",
    });

    expect(results).toEqual(["/Users/me/projects/otto"]);
  });

  it("keeps fuzzy recommendation matches before de-duplicated daemon suggestions", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: ["/Users/me/projects/otto-desktop", "/Users/me/documents"],
      serverPaths: ["/Users/me/projects/otto-plan", "/Users/me/projects/otto-desktop"],
      query: "oto",
    });

    expect(results).toEqual(["/Users/me/projects/otto-desktop", "/Users/me/projects/otto-plan"]);
  });

  it("does not reinterpret daemon-ranked suggestions", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: [],
      serverPaths: ["/Users/me/projects/otto-desktop"],
      query: "a-query-ranked-by-the-daemon",
    });

    expect(results).toEqual(["/Users/me/projects/otto-desktop"]);
  });

  it("matches recommended paths using the complete path text", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: [
        "/Users/me/archive/projects/otto-desktop",
        "/Users/me/projects/otto-desktop",
      ],
      serverPaths: [],
      // Spans the separator on purpose: the query only matches when it is run
      // against the whole path rather than the last segment.
      query: "projects/oto",
    });

    expect(results).toEqual([
      "/Users/me/archive/projects/otto-desktop",
      "/Users/me/projects/otto-desktop",
    ]);
  });

  it("fuzzy-matches recommended paths using their full path", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: ["/Users/me/projects/blankpage/editor"],
      serverPaths: [],
      query: "blank page editor",
    });

    expect(results).toEqual(["/Users/me/projects/blankpage/editor"]);
  });

  it("treats '~' as an active query and includes daemon suggestions", () => {
    const results = buildWorkingDirectorySuggestions({
      recommendedPaths: ["/Users/me/projects/otto"],
      serverPaths: ["/Users/me/documents", "/Users/me/projects"],
      query: "~",
    });

    expect(results).toEqual([
      "/Users/me/projects/otto",
      "/Users/me/documents",
      "/Users/me/projects",
    ]);
  });
});
