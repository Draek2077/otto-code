import { describe, expect, it } from "vitest";
import {
  CONNECTOR_CATALOG,
  catalogForAudience,
  groupCatalogByCategory,
  searchCatalog,
} from "./catalog.js";
import { GOOGLE_CONNECTOR_SERVICES, googleConnectorForConfig } from "./google.js";

const roster = [
  "google-drive",
  "gmail",
  "google-calendar",
  "notion",
  "atlassian",
  "box",
  "dropbox",
  "slack",
  "linear",
  "monday",
  "clickup",
  "trello",
  "asana",
  "canva",
  "webflow",
  "intercom",
  "hubspot",
  "stripe",
  "square",
  "airtable",
  "ahrefs",
  "github",
  "sentry",
  "supabase",
  "cloudflare",
  "netlify",
  "vercel",
  "deepwiki",
  "filesystem",
  "memory",
];

describe("restored Connector catalog", () => {
  it("retains the exact frozen 0.9 roster, including all three native Google services", () => {
    expect(CONNECTOR_CATALOG.map((row) => row.id).sort()).toEqual(roster.toSorted());
    expect(new Set(roster).size).toBe(30);
  });

  it.each(CONNECTOR_CATALOG)(
    "$id retains a vendor citation and an explicit historical verification date",
    (row) => {
      expect(new URL(row.source).protocol).toBe("https:");
      expect(row.verifiedOn).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(new Date(row.verifiedOn).toISOString().slice(0, 10)).toBe(row.verifiedOn);
      // A source citation describes the setup contract, not a successful account grant.
      expect(row).not.toHaveProperty("connected");
      const setup = row.setup;
      const endpoint = "url" in setup ? setup.url : [setup.command, ...setup.args].join(" ");
      expect(endpoint).not.toMatch(/[<>]|TODO|FIXME|example\.com|changeme/);
      if ("url" in setup) {
        const url = new URL(setup.url);
        expect(url.protocol).toBe("https:");
        expect(url.username || url.password || url.hash).toBe("");
      }
      if (setup.kind === "token")
        expect(new URL(setup.credential.issueUrl).protocol).toBe("https:");
    },
  );

  it("searches names, descriptions and categories, independently of endpoint syntax", () => {
    expect(searchCatalog(CONNECTOR_CATALOG, " SLACK ").map((row) => row.id)).toEqual(["slack"]);
    expect(searchCatalog(CONNECTOR_CATALOG, "files").map((row) => row.id)).toContain("box");
    expect(searchCatalog(CONNECTOR_CATALOG, "mcp.box.com")).toEqual([]);
    expect(searchCatalog(CONNECTOR_CATALOG, " ")).toBe(CONNECTOR_CATALOG);
    expect(catalogForAudience("user").every((row) => row.audience === "user")).toBe(true);
    expect(
      groupCatalogByCategory(CONNECTOR_CATALOG).flatMap((group) => group.entries),
    ).toHaveLength(30);
  });

  it.each(GOOGLE_CONNECTOR_SERVICES)(
    "$id binds native identity to its exact API endpoint",
    (service) => {
      expect(
        googleConnectorForConfig({
          builtin: service.id,
          server: { type: "http", url: service.url },
        }),
      ).toBe(service);
      expect(
        googleConnectorForConfig({
          builtin: service.id,
          server: { type: "http", url: "https://foreign.invalid" },
        }),
      ).toBeUndefined();
      expect(
        googleConnectorForConfig({ server: { type: "http", url: service.url } }),
      ).toBeUndefined();
      expect(
        googleConnectorForConfig({ builtin: service.id, server: { type: "stdio" } }),
      ).toBeUndefined();
    },
  );
});
