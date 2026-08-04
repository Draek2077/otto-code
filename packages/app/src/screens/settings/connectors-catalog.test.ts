// The catalog's guardrail.
//
// This file exists because the connector catalog once shipped ~70 entries whose
// command was the literal string `npx -y <slug-mcp-server>` - angle brackets and
// all. Every one of them looked like a working integration in the UI and none of
// them could start. These tests assert the properties that make that impossible
// to reintroduce quietly: no placeholder syntax, a real endpoint, and a citation
// for every entry.
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_CATALOG,
  catalogForAudience,
  searchCatalog,
  type ConnectorCatalogEntry,
} from "./connectors-catalog";

// Substrings that mean "somebody intended to fill this in later". A catalog is
// the wrong place for that intention.
const PLACEHOLDER_MARKERS = [
  "<",
  ">",
  "your-",
  "YOUR_",
  "TODO",
  "FIXME",
  "example.com",
  "acme",
  "changeme",
];

function endpointText(entry: ConnectorCatalogEntry): string {
  const setup = entry.setup;
  if (setup.kind === "oauth") {
    return setup.url;
  }
  if (setup.kind === "none") {
    return setup.transport === "http" ? setup.url : [setup.command, ...setup.args].join(" ");
  }
  return [setup.command, ...setup.args].join(" ");
}

describe("connector catalog integrity", () => {
  it("ships at least one connector", () => {
    expect(CONNECTOR_CATALOG.length).toBeGreaterThan(0);
  });

  it("has no duplicate ids", () => {
    const ids = CONNECTOR_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CONNECTOR_CATALOG.map((entry) => [entry.id, entry] as const))(
    "%s has a runnable endpoint with no placeholder syntax",
    (_id, entry) => {
      const endpoint = endpointText(entry);
      expect(endpoint.length).toBeGreaterThan(0);
      for (const marker of PLACEHOLDER_MARKERS) {
        expect(endpoint.toLowerCase()).not.toContain(marker.toLowerCase());
      }
    },
  );

  it.each(CONNECTOR_CATALOG.map((entry) => [entry.id, entry] as const))(
    "%s cites the vendor doc it was verified against",
    (_id, entry) => {
      // No citation, no entry. This is what makes re-verification possible
      // instead of a research project.
      expect(entry.source).toMatch(/^https:\/\//);
      expect(entry.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    },
  );

  it.each(
    CONNECTOR_CATALOG.filter((entry) => entry.setup.kind === "oauth").map(
      (entry) => [entry.id, entry] as const,
    ),
  )("%s signs in against an https endpoint", (_id, entry) => {
    if (entry.setup.kind !== "oauth") {
      throw new Error("filtered to oauth entries");
    }
    // http would put a bearer token on the wire in the clear.
    expect(entry.setup.url).toMatch(/^https:\/\//);
  });

  it.each(
    CONNECTOR_CATALOG.filter((entry) => entry.setup.kind === "token").map(
      (entry) => [entry.id, entry] as const,
    ),
  )("%s tells the user where to get its token", (_id, entry) => {
    if (entry.setup.kind !== "token") {
      throw new Error("filtered to token entries");
    }
    // Asking for a credential without saying where to get it is the failure
    // this catalog was rebuilt to remove.
    expect(entry.setup.credential.envVar.length).toBeGreaterThan(0);
    expect(entry.setup.credential.issueUrl).toMatch(/^https:\/\//);
  });

  it("never asks a user-mode connector to paste a command", () => {
    // User mode is the non-coder surface. A stdio command there is a leak of
    // implementation detail into an audience that cannot act on it.
    for (const entry of catalogForAudience("user")) {
      if (entry.setup.kind === "none") {
        expect(entry.setup.transport).toBe("stdio");
      }
    }
  });

  it("carries the connectors recovered after the over-aggressive cut", () => {
    // These were each wrongly recorded as "no official server" on the strength
    // of one broad sweep. Per-vendor checks found all of them. Pinning them here
    // means a future cleanup has to argue with a test rather than a comment.
    const recovered = [
      "slack",
      "hubspot",
      "monday",
      "box",
      "airtable",
      "dropbox",
      "clickup",
      "trello",
      "ahrefs",
      "netlify",
      "square",
    ];
    const ids = new Set(CONNECTOR_CATALOG.map((entry) => entry.id));
    for (const id of recovered) {
      expect(ids.has(id), `${id} is missing from the catalog`).toBe(true);
    }
  });

  it("prefers sign-in over pasted tokens", () => {
    // Not a hard rule, but a drift alarm: if this ratio inverts, the catalog is
    // sliding back toward "go find a token yourself".
    const oauth = CONNECTOR_CATALOG.filter((entry) => entry.setup.kind === "oauth").length;
    const token = CONNECTOR_CATALOG.filter((entry) => entry.setup.kind === "token").length;
    expect(oauth).toBeGreaterThan(token);
  });
});

describe("searchCatalog", () => {
  it("returns everything for an empty or whitespace query", () => {
    expect(searchCatalog(CONNECTOR_CATALOG, "")).toHaveLength(CONNECTOR_CATALOG.length);
    expect(searchCatalog(CONNECTOR_CATALOG, "   ")).toHaveLength(CONNECTOR_CATALOG.length);
  });

  it("finds a connector by name, case insensitively", () => {
    const hits = searchCatalog(CONNECTOR_CATALOG, "SLACK");
    expect(hits.map((entry) => entry.id)).toContain("slack");
  });

  it("finds connectors by what they do, not just their name", () => {
    // Someone looking for a place to put files should find Box and Dropbox
    // without knowing either brand is in the list.
    const hits = searchCatalog(CONNECTOR_CATALOG, "files").map((entry) => entry.id);
    expect(hits).toContain("dropbox");
    expect(hits).toContain("box");
  });

  it("finds connectors by category", () => {
    const hits = searchCatalog(CONNECTOR_CATALOG, "issues & projects");
    expect(hits.length).toBeGreaterThan(1);
  });

  it("does not match on endpoints", () => {
    // Every remote entry's URL contains "mcp". Matching it would make this
    // search return the whole catalog and be useless.
    expect(searchCatalog(CONNECTOR_CATALOG, "mcp.").length).toBe(0);
  });

  it("returns nothing for a query that matches no connector", () => {
    expect(searchCatalog(CONNECTOR_CATALOG, "zqxjkv")).toHaveLength(0);
  });
});
