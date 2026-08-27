import { describe, expect, it } from "vitest";
import { normalizeKanbanProjectTarget } from "./project-target.js";

describe("normalizeKanbanProjectTarget", () => {
  it("treats an empty GitHub board as derive-from-the-repo", () => {
    // The zero-configuration case: a repo-scoped board needs no input at all.
    expect(normalizeKanbanProjectTarget({ adapter: "github", boardId: "" })).toEqual({
      ok: true,
      target: { adapter: "github", boardId: null },
    });
    expect(normalizeKanbanProjectTarget({ adapter: "github", boardId: null })).toEqual({
      ok: true,
      target: { adapter: "github", boardId: null },
    });
  });

  it("requires a board id for Jira", () => {
    // A Jira board is site-addressed; there is nothing to derive it from.
    const result = normalizeKanbanProjectTarget({ adapter: "jira", boardId: "  " });
    expect(result).toEqual({ ok: false, error: "Enter a Jira board id." });
  });

  it("parses a GitHub org project URL down to its number", () => {
    expect(
      normalizeKanbanProjectTarget({
        adapter: "github",
        boardId: "https://github.com/orgs/acme/projects/12",
      }),
    ).toEqual({
      ok: true,
      target: { adapter: "github", boardId: "12", boardOwner: "acme" },
    });
  });

  it("parses a GitHub user project URL down to its number", () => {
    expect(
      normalizeKanbanProjectTarget({
        adapter: "github",
        boardId: "https://github.com/users/draekz/projects/3/views/1",
      }),
    ).toEqual({
      ok: true,
      target: { adapter: "github", boardId: "3", boardOwner: "draekz" },
    });
  });

  it("passes a GitHub GraphQL node id through untouched", () => {
    expect(
      normalizeKanbanProjectTarget({ adapter: "github", boardId: " PVT_kwDOABCD123 " }),
    ).toEqual({ ok: true, target: { adapter: "github", boardId: "PVT_kwDOABCD123" } });
  });

  it("parses Jira board URLs in each shape Jira produces", () => {
    for (const url of [
      "https://acme.atlassian.net/jira/software/projects/ENG/boards/100",
      "https://acme.atlassian.net/secure/RapidBoard.jspa?rapidView=100",
      "https://acme.atlassian.net/b/100/backlog",
    ]) {
      expect(normalizeKanbanProjectTarget({ adapter: "jira", boardId: url })).toEqual({
        ok: true,
        target: { adapter: "jira", boardId: "100" },
      });
    }
  });

  it("rejects a Jira board id that is not a number", () => {
    expect(normalizeKanbanProjectTarget({ adapter: "jira", boardId: "ENG" })).toEqual({
      ok: false,
      error: "Enter a Jira board id.",
    });
  });

  it("rejects values that look like access tokens", () => {
    // This field is persisted unmasked, so a pasted credential must never land
    // in it - the guardrail belongs here, not in the UI alone.
    for (const token of [
      "ghp_16CharsOfNonsense0000000000000000000000",
      "github_pat_11ABCDEFG0abcdefghijklmn",
      "ATATT3xFfGF0abcdefghijklmnop",
      "xoxb-1234-5678-abcdefg",
    ]) {
      const result = normalizeKanbanProjectTarget({ adapter: "github", boardId: token });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toMatch(/access token/i);
    }
  });

  it("rejects an implausibly long identifier", () => {
    const result = normalizeKanbanProjectTarget({
      adapter: "github",
      boardId: "x".repeat(201),
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/too long/i);
  });
});
