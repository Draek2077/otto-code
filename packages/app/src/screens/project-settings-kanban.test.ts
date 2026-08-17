import { describe, expect, it } from "vitest";
import { resolveKanbanTargetDraft } from "./project-settings-kanban-section";

describe("resolveKanbanTargetDraft", () => {
  it("saves null for the none adapter, regardless of leftover board text", () => {
    expect(resolveKanbanTargetDraft({ adapter: "none", boardId: "123" })).toEqual({
      kind: "save",
      target: null,
    });
    expect(resolveKanbanTargetDraft({ adapter: "none", boardId: "" })).toEqual({
      kind: "save",
      target: null,
    });
  });

  it("saves a github target with a null board id when the field is empty", () => {
    expect(resolveKanbanTargetDraft({ adapter: "github", boardId: "" })).toEqual({
      kind: "save",
      target: { adapter: "github", boardId: null },
    });
    expect(resolveKanbanTargetDraft({ adapter: "github", boardId: "   " })).toEqual({
      kind: "save",
      target: { adapter: "github", boardId: null },
    });
  });

  it("saves a github target with the trimmed board value when one is given", () => {
    expect(resolveKanbanTargetDraft({ adapter: "github", boardId: "  PVT_kwDO  " })).toEqual({
      kind: "save",
      target: { adapter: "github", boardId: "PVT_kwDO" },
    });
  });

  it("blocks a jira target without a board id", () => {
    expect(resolveKanbanTargetDraft({ adapter: "jira", boardId: "" })).toEqual({
      kind: "blocked",
      reason: "jiraBoardRequired",
    });
    expect(resolveKanbanTargetDraft({ adapter: "jira", boardId: "   " })).toEqual({
      kind: "blocked",
      reason: "jiraBoardRequired",
    });
  });

  it("saves a jira target with the trimmed board value", () => {
    expect(resolveKanbanTargetDraft({ adapter: "jira", boardId: "  100  " })).toEqual({
      kind: "save",
      target: { adapter: "jira", boardId: "100" },
    });
  });
});
