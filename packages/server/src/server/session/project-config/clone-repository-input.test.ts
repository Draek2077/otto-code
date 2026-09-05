import { describe, expect, it } from "vitest";
import { normalizeCloneRepository } from "./clone-repository-input.js";

describe("clone repository input", () => {
  it("preserves an explicit non-GitHub remote", () => {
    expect(
      normalizeCloneRepository({ repo: " https://git.example.org/team/project.git " }),
    ).toEqual({
      name: "project",
      displayName: "team/project",
      cloneUrl: "https://git.example.org/team/project.git",
    });
  });
  it("uses the selected protocol for a GitHub shorthand", () => {
    expect(normalizeCloneRepository({ repo: "owner/project.git", cloneProtocol: "ssh" })).toEqual({
      name: "project",
      displayName: "owner/project",
      cloneUrl: "git@github.com:owner/project.git",
    });
  });
  it("does not guess a transport for a shorthand", () => {
    expect(() => normalizeCloneRepository({ repo: "owner/project" })).toThrow(
      "Clone protocol is required",
    );
  });
  it("rejects a malformed repository name", () => {
    expect(() =>
      normalizeCloneRepository({ repo: "owner/bad name", cloneProtocol: "https" }),
    ).toThrow("invalid characters");
  });
});
