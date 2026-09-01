import { describe, expect, it } from "vitest";
import { resolveCompactExplorerTabs } from "./compact-explorer-sidebar-host-state";

describe("resolveCompactExplorerTabs", () => {
  it("shows only Files and coerces a persisted developer tab in User mode", () => {
    expect(
      resolveCompactExplorerTabs({
        activeTab: "search",
        isDeveloperMode: false,
        isGit: true,
        hasProjectSearch: true,
        showPullRequest: true,
      }),
    ).toEqual({ activeTab: "files", tabs: ["files"] });
  });

  it("keeps Otto Search additive to the upstream compact tabs", () => {
    expect(
      resolveCompactExplorerTabs({
        activeTab: "search",
        isDeveloperMode: true,
        isGit: true,
        hasProjectSearch: true,
        showPullRequest: true,
      }),
    ).toEqual({
      activeTab: "search",
      tabs: ["changes", "files", "search", "pr"],
    });
  });

  it("falls back when Search or pull-request content is unavailable", () => {
    expect(
      resolveCompactExplorerTabs({
        activeTab: "search",
        isDeveloperMode: true,
        isGit: true,
        hasProjectSearch: false,
        showPullRequest: false,
      }).activeTab,
    ).toBe("files");
    expect(
      resolveCompactExplorerTabs({
        activeTab: "pr",
        isDeveloperMode: true,
        isGit: true,
        hasProjectSearch: false,
        showPullRequest: false,
      }).activeTab,
    ).toBe("changes");
  });
});
