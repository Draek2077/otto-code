import { describe, expect, it } from "vitest";
import type { ExplorerDirectory, ExplorerEntry } from "@/stores/session-store";
import { planExpandedPathSync } from "./expanded-paths";

function entry(path: string, kind: ExplorerEntry["kind"] = "directory"): ExplorerEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return { name, path, kind, size: 0, modifiedAt: "2026-01-01T00:00:00.000Z" };
}

function directories(
  ...listings: { path: string; entries: ExplorerEntry[] }[]
): Map<string, ExplorerDirectory> {
  return new Map(listings.map((listing) => [listing.path, listing]));
}

const NOTHING_IN_FLIGHT = new Set<string>();

describe("planExpandedPathSync", () => {
  it("prunes a remembered directory the root listing no longer names", () => {
    const plan = planExpandedPathSync({
      directories: directories({ path: ".", entries: [entry("docs")] }),
      expandedPaths: [".", "docs", "archdocs"],
      showHiddenFiles: false,
      inFlightPaths: NOTHING_IN_FLIGHT,
    });

    expect(plan.prune).toEqual(["archdocs"]);
    expect(plan.request).toEqual(["docs"]);
  });

  it("prunes everything under a pruned directory", () => {
    const plan = planExpandedPathSync({
      directories: directories({ path: ".", entries: [] }),
      expandedPaths: ["archdocs/site/src", "archdocs", "archdocs/site"],
      showHiddenFiles: false,
      inFlightPaths: NOTHING_IN_FLIGHT,
    });

    expect(plan.prune).toEqual(["archdocs", "archdocs/site", "archdocs/site/src"]);
    expect(plan.request).toEqual([]);
  });

  it("prunes a remembered directory that is now a file", () => {
    const plan = planExpandedPathSync({
      directories: directories({ path: ".", entries: [entry("docs", "file")] }),
      expandedPaths: ["docs"],
      showHiddenFiles: true,
      inFlightPaths: NOTHING_IN_FLIGHT,
    });

    expect(plan.prune).toEqual(["docs"]);
    expect(plan.request).toEqual([]);
  });

  it("cascades one level at a time, deciding nothing about an unloaded parent", () => {
    const rootOnly = planExpandedPathSync({
      directories: directories({ path: ".", entries: [entry("packages")] }),
      expandedPaths: ["packages", "packages/app", "packages/app/src"],
      showHiddenFiles: true,
      inFlightPaths: NOTHING_IN_FLIGHT,
    });
    expect(rootOnly).toEqual({ request: ["packages"], prune: [] });

    const withPackages = planExpandedPathSync({
      directories: directories(
        { path: ".", entries: [entry("packages")] },
        { path: "packages", entries: [entry("packages/app")] },
      ),
      expandedPaths: ["packages", "packages/app", "packages/app/src"],
      showHiddenFiles: true,
      inFlightPaths: NOTHING_IN_FLIGHT,
    });
    expect(withPackages).toEqual({ request: ["packages/app"], prune: [] });
  });

  it("does not re-request a listing it already has or already asked for", () => {
    const plan = planExpandedPathSync({
      directories: directories(
        { path: ".", entries: [entry("docs"), entry("packages")] },
        { path: "docs", entries: [] },
      ),
      expandedPaths: ["docs", "packages"],
      showHiddenFiles: true,
      inFlightPaths: new Set(["packages"]),
    });

    expect(plan).toEqual({ request: [], prune: [] });
  });

  it("keeps hidden expansions persisted but unrequested while hidden files are off", () => {
    const listings = directories({ path: ".", entries: [entry(".otto")] });

    expect(
      planExpandedPathSync({
        directories: listings,
        expandedPaths: [".otto"],
        showHiddenFiles: false,
        inFlightPaths: NOTHING_IN_FLIGHT,
      }),
    ).toEqual({ request: [], prune: [] });

    expect(
      planExpandedPathSync({
        directories: listings,
        expandedPaths: [".otto"],
        showHiddenFiles: true,
        inFlightPaths: NOTHING_IN_FLIGHT,
      }),
    ).toEqual({ request: [".otto"], prune: [] });
  });
});
