import { describe, expect, it } from "vitest";
import { matchesAgentDeleteScope, resolveAgentDeleteScope } from "./delete.js";

describe("resolveAgentDeleteScope", () => {
  it("defaults to active-only so bare --all keeps its old meaning", () => {
    expect(resolveAgentDeleteScope({})).toBe("active");
  });

  it("returns archived-only for --archived", () => {
    expect(resolveAgentDeleteScope({ archived: true })).toBe("archived");
  });

  it("returns both for --include-archived", () => {
    expect(resolveAgentDeleteScope({ includeArchived: true })).toBe("both");
  });

  it("refuses the contradictory pair instead of guessing", () => {
    expect(() => resolveAgentDeleteScope({ archived: true, includeArchived: true })).toThrow(
      /cannot be combined/,
    );
  });
});

describe("matchesAgentDeleteScope", () => {
  const active = { archivedAt: null };
  const missing = {};
  const blank = { archivedAt: "" };
  const archived = { archivedAt: new Date("2026-01-01T00:00:00.000Z") };
  const archivedString = { archivedAt: "2026-01-01T00:00:00.000Z" };

  it("active scope keeps unarchived agents and drops archived ones", () => {
    expect(matchesAgentDeleteScope(active, "active")).toBe(true);
    expect(matchesAgentDeleteScope(missing, "active")).toBe(true);
    expect(matchesAgentDeleteScope(blank, "active")).toBe(true);
    expect(matchesAgentDeleteScope(archived, "active")).toBe(false);
    expect(matchesAgentDeleteScope(archivedString, "active")).toBe(false);
  });

  it("archived scope keeps only archived agents", () => {
    expect(matchesAgentDeleteScope(active, "archived")).toBe(false);
    expect(matchesAgentDeleteScope(missing, "archived")).toBe(false);
    expect(matchesAgentDeleteScope(blank, "archived")).toBe(false);
    expect(matchesAgentDeleteScope(archived, "archived")).toBe(true);
    expect(matchesAgentDeleteScope(archivedString, "archived")).toBe(true);
  });

  it("both scope keeps everything", () => {
    expect(matchesAgentDeleteScope(active, "both")).toBe(true);
    expect(matchesAgentDeleteScope(archived, "both")).toBe(true);
  });
});
