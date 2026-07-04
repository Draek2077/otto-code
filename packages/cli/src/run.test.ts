import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCliParseArgv } from "./run";

describe("runCli", () => {
  it("defaults an empty CLI invocation to onboard", () => {
    expect(
      createCliParseArgv({
        argv: [],
        cwd: process.cwd(),
        nodeArgv: ["node", "otto"],
      }),
    ).toEqual(["node", "otto", "onboard"]);
  });

  it("preserves known CLI command argv", () => {
    expect(
      createCliParseArgv({
        argv: ["daemon", "set-password"],
        cwd: process.cwd(),
        nodeArgv: ["node", "otto"],
      }),
    ).toEqual(["node", "otto", "daemon", "set-password"]);
  });

  it("preserves the hooks command argv", () => {
    expect(
      createCliParseArgv({
        argv: ["hooks", "claude", "UserPromptSubmit"],
        cwd: process.cwd(),
        nodeArgv: ["node", "otto"],
      }),
    ).toEqual(["node", "otto", "hooks", "claude", "UserPromptSubmit"]);
  });

  it("classifies existing unknown directories as open-project invocations", () => {
    const root = mkdtempSync(path.join(tmpdir(), "otto-cli-run-"));
    const project = path.join(root, "project");
    mkdirSync(project);

    try {
      expect(
        createCliParseArgv({
          argv: ["project"],
          cwd: root,
          nodeArgv: ["node", "otto"],
        }),
      ).toEqual({
        kind: "open-project",
        resolvedPath: project,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
