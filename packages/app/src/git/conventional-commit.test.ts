import { describe, expect, it } from "vitest";

import { formatConventionalCommitMessage, NO_COMMIT_TYPE } from "./conventional-commit";

describe("formatConventionalCommitMessage", () => {
  it("returns the trimmed subject unchanged when no type is selected", () => {
    expect(formatConventionalCommitMessage(NO_COMMIT_TYPE, "  add parser  ")).toBe("add parser");
  });

  it("prefixes the subject with the chosen type in Conventional Commits syntax", () => {
    expect(formatConventionalCommitMessage("fix", "handle null cursor")).toBe(
      "fix: handle null cursor",
    );
    expect(formatConventionalCommitMessage("feat", "add parser")).toBe("feat: add parser");
    expect(formatConventionalCommitMessage("revert", "undo the merge")).toBe(
      "revert: undo the merge",
    );
  });

  it("trims the subject before prefixing", () => {
    expect(formatConventionalCommitMessage("chore", "   tidy imports   ")).toBe(
      "chore: tidy imports",
    );
  });

  it("does not double-prefix a message that already carries the same type", () => {
    expect(formatConventionalCommitMessage("fix", "fix: already written")).toBe(
      "fix: already written",
    );
  });

  it("does not double-prefix a message that carries a different type", () => {
    expect(formatConventionalCommitMessage("feat", "fix: typed by hand")).toBe(
      "fix: typed by hand",
    );
  });

  it("does not double-prefix a scoped or breaking header", () => {
    expect(formatConventionalCommitMessage("fix", "fix(api): scoped")).toBe("fix(api): scoped");
    expect(formatConventionalCommitMessage("feat", "feat!: breaking")).toBe("feat!: breaking");
    expect(formatConventionalCommitMessage("perf", "perf(core)!: hot path")).toBe(
      "perf(core)!: hot path",
    );
  });

  it("treats a bare `word:` with no space as plain text and still prefixes it", () => {
    expect(formatConventionalCommitMessage("docs", "notes:")).toBe("docs: notes:");
  });

  it("returns an empty string for an empty or whitespace-only message", () => {
    expect(formatConventionalCommitMessage("fix", "")).toBe("");
    expect(formatConventionalCommitMessage("fix", "   ")).toBe("");
  });
});
