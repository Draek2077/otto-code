// OTTO(website): current plugin docs and the retained historical guides stay discoverable.
import { describe, expect, it } from "vitest";
import { buildDocsNavTree, getDoc, getDocs } from "./docs";

describe("versioned plugin documentation", () => {
  it("keeps current and historical API versions together in the Plugins navigation", () => {
    const plugins = buildDocsNavTree(getDocs()).find(
      (node) => node.type === "category" && node.label === "Plugins",
    );
    expect(plugins?.type).toBe("category");
    if (plugins?.type !== "category") throw new Error("Plugins navigation is missing");
    expect(plugins.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "page",
          label: "Quickstart (current)",
          href: "/docs/plugins",
        }),
        expect.objectContaining({
          type: "page",
          label: "Reference",
          href: "/docs/plugins/reference",
        }),
        expect.objectContaining({
          type: "group",
          label: "Paseo v0.7 (historical)",
          href: "/docs/plugins/v0.7",
        }),
        expect.objectContaining({
          type: "group",
          label: "Paseo v0.8 (historical)",
          href: "/docs/plugins/v0.8",
        }),
      ]),
    );
  });

  it("loads current plugin contracts and preserves document metadata", () => {
    expect(getDoc("plugins/reference")?.content).toContain("client.addScreen(");
    expect(getDoc("plugins/migration")?.frontmatter.nav).toBe("Migration");
    expect(getDoc("")?.frontmatter).toMatchObject({
      title: "Getting started",
      nav: "Getting started",
      order: 1,
      category: "Getting started",
    });
    for (const doc of getDocs()) expect(doc.frontmatter.title, doc.sourcePath).not.toBe("");
  });
});
