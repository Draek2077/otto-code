import { describe, expect, it } from "vitest";
import {
  buildProjectScaffoldStepPlan,
  deriveFolderNameFromRepositoryUrl,
  getGitignoreTemplateContent,
  resolveProjectFolderName,
  validateProjectFolderName,
} from "./project-scaffold-plan.js";

describe("validateProjectFolderName", () => {
  it("accepts the names people actually type", () => {
    expect(validateProjectFolderName("my-app")).toBeNull();
    expect(validateProjectFolderName("My App")).toBeNull();
    expect(validateProjectFolderName("api_v2")).toBeNull();
    expect(validateProjectFolderName("otto.code")).toBeNull();
  });

  it("rejects anything that would escape the parent directory", () => {
    expect(validateProjectFolderName("../etc")).toBe("path_separator");
    expect(validateProjectFolderName("a/b")).toBe("path_separator");
    expect(validateProjectFolderName("a\\b")).toBe("path_separator");
    expect(validateProjectFolderName("..")).toBe("relative_segment");
    expect(validateProjectFolderName(".")).toBe("relative_segment");
  });

  it("rejects names that are unusable on Windows", () => {
    expect(validateProjectFolderName("what?")).toBe("reserved_character");
    expect(validateProjectFolderName('say "hi"')).toBe("reserved_character");
    expect(validateProjectFolderName("a:b")).toBe("reserved_character");
    expect(validateProjectFolderName("con")).toBe("reserved_name");
    expect(validateProjectFolderName("LPT1")).toBe("reserved_name");
    expect(validateProjectFolderName("trailing.")).toBe("trailing_dot_or_space");
    expect(validateProjectFolderName("trailing ")).toBe("trailing_dot_or_space");
  });

  it("is reached after trimming, so a typed trailing space is not an error", () => {
    expect(resolveProjectFolderName({ folderName: "my-app ", git: { kind: "none" } })).toEqual({
      folderName: "my-app",
      error: null,
    });
  });

  it("rejects control characters without a regex over literal bytes", () => {
    expect(validateProjectFolderName(`a${String.fromCodePoint(0)}b`)).toBe("reserved_character");
    expect(validateProjectFolderName(`a${String.fromCodePoint(0x1f)}b`)).toBe("reserved_character");
  });
});

describe("deriveFolderNameFromRepositoryUrl", () => {
  it("matches what plain `git clone <url>` would name the directory", () => {
    expect(deriveFolderNameFromRepositoryUrl("https://github.com/otto/otto-code.git")).toBe(
      "otto-code",
    );
    expect(deriveFolderNameFromRepositoryUrl("https://github.com/otto/otto-code")).toBe(
      "otto-code",
    );
    expect(deriveFolderNameFromRepositoryUrl("git@github.com:otto/otto-code.git")).toBe(
      "otto-code",
    );
    expect(deriveFolderNameFromRepositoryUrl("ssh://git@host/team/thing")).toBe("thing");
    expect(deriveFolderNameFromRepositoryUrl("https://bitbucket.org/team/thing/")).toBe("thing");
  });

  it("handles a local path source, including a Windows one", () => {
    expect(deriveFolderNameFromRepositoryUrl("/home/me/src/thing")).toBe("thing");
    expect(deriveFolderNameFromRepositoryUrl("C:\\Users\\me\\src\\thing")).toBe("thing");
    expect(deriveFolderNameFromRepositoryUrl("C:\\Users\\me\\src\\thing\\")).toBe("thing");
  });

  it("returns null when there is nothing to derive", () => {
    expect(deriveFolderNameFromRepositoryUrl("")).toBeNull();
    expect(deriveFolderNameFromRepositoryUrl("   ")).toBeNull();
  });
});

describe("resolveProjectFolderName", () => {
  it("prefers an explicit name over the clone URL", () => {
    expect(
      resolveProjectFolderName({
        folderName: "custom",
        git: { kind: "clone", url: "https://github.com/otto/otto-code.git" },
      }),
    ).toEqual({ folderName: "custom", error: null });
  });

  it("falls back to the clone URL when no name was given", () => {
    expect(
      resolveProjectFolderName({
        folderName: undefined,
        git: { kind: "clone", url: "https://github.com/otto/otto-code.git" },
      }),
    ).toEqual({ folderName: "otto-code", error: null });
  });

  it("requires an explicit name for every non-clone path", () => {
    expect(resolveProjectFolderName({ folderName: "  ", git: { kind: "none" } })).toEqual({
      folderName: null,
      error: "empty",
    });
    expect(resolveProjectFolderName({ folderName: undefined, git: { kind: "init" } })).toEqual({
      folderName: null,
      error: "empty",
    });
  });

  it("reports the validation error rather than a usable name", () => {
    expect(resolveProjectFolderName({ folderName: "a/b", git: { kind: "none" } })).toEqual({
      folderName: null,
      error: "path_separator",
    });
  });
});

describe("buildProjectScaffoldStepPlan", () => {
  it("creates nothing but the directory for a plain folder", () => {
    expect(buildProjectScaffoldStepPlan({ kind: "none" })).toEqual([
      "create_directory",
      "register_project",
    ]);
  });

  it("lets clone create its own directory", () => {
    expect(buildProjectScaffoldStepPlan({ kind: "clone", url: "https://host/a/b.git" })).toEqual([
      "git_clone",
      "register_project",
    ]);
  });

  it("skips the starter-files step when no starter files were asked for", () => {
    expect(buildProjectScaffoldStepPlan({ kind: "init" })).toEqual([
      "create_directory",
      "git_init",
      "register_project",
    ]);
  });

  it("includes starter files and a commit when both are requested", () => {
    expect(
      buildProjectScaffoldStepPlan({
        kind: "init",
        addReadme: true,
        gitignoreTemplate: "node",
        initialCommit: true,
      }),
    ).toEqual([
      "create_directory",
      "git_init",
      "starter_files",
      "initial_commit",
      "register_project",
    ]);
  });

  it("implies a commit when a remote is requested, so the push has something to push", () => {
    expect(
      buildProjectScaffoldStepPlan({
        kind: "init",
        addReadme: true,
        initialCommit: false,
        remote: {
          providerId: "github",
          owner: null,
          name: "thing",
          visibility: "private",
        },
      }),
    ).toEqual([
      "create_directory",
      "git_init",
      "starter_files",
      "initial_commit",
      "create_remote",
      "push",
      "register_project",
    ]);
  });
});

describe("getGitignoreTemplateContent", () => {
  it("returns a trailing-newline template for a known id", () => {
    const content = getGitignoreTemplateContent("node");
    expect(content).toContain("node_modules/");
    expect(content?.endsWith("\n")).toBe(true);
  });

  it("returns null for an id this daemon does not know", () => {
    expect(getGitignoreTemplateContent("cobol")).toBeNull();
  });
});
