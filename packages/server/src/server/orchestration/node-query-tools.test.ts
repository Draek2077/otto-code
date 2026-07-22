import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { executeQueryTool, queryToolName } from "./node-query-tools.js";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "otto-query-tools-"));
}

describe("queryToolName", () => {
  test("namespaces so a query tool can never shadow a built-in", () => {
    expect(queryToolName({ name: "create_agent", description: "d", kind: "command" })).toBe(
      "query_create_agent",
    );
  });
});

describe("command query tools", () => {
  test("runs an argv command in the workspace and returns its output", async () => {
    const cwd = await makeWorkspace();
    const result = await executeQueryTool({
      tool: {
        name: "echo",
        description: "Echo",
        kind: "command",
        parameters: [{ key: "word", type: "string" }],
        command: [process.execPath, "-e", "console.log(process.argv[1])", "{{word}}"],
      },
      args: { word: "hello" },
      cwd,
    });
    expect(result.isError).toBeUndefined();
    expect(result.text.trim()).toBe("hello");
  });

  test("a parameter with shell metacharacters stays one argument", async () => {
    // The security property: there is no shell, so this is data, not syntax.
    const cwd = await makeWorkspace();
    const injection = "; rm -rf / && echo pwned";
    const result = await executeQueryTool({
      tool: {
        name: "echo",
        description: "Echo",
        kind: "command",
        parameters: [{ key: "word", type: "string" }],
        command: [process.execPath, "-e", "console.log(process.argv[1])", "{{word}}"],
      },
      args: { word: injection },
      cwd,
    });
    expect(result.text.trim()).toBe(injection);
  });

  test("a non-zero exit is reported, not thrown", async () => {
    const cwd = await makeWorkspace();
    const result = await executeQueryTool({
      tool: {
        name: "fail",
        description: "Fail",
        kind: "command",
        command: [process.execPath, "-e", "process.exit(3)"],
      },
      args: {},
      cwd,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("3");
  });
});

describe("file-read query tools", () => {
  test("reads a file inside the workspace", async () => {
    const cwd = await makeWorkspace();
    await writeFile(path.join(cwd, "notes.md"), "the contents", "utf8");
    const result = await executeQueryTool({
      tool: { name: "notes", description: "Notes", kind: "file-read", path: "notes.md" },
      args: {},
      cwd,
    });
    expect(result.text).toBe("the contents");
  });

  test("refuses to escape the workspace", async () => {
    const cwd = await makeWorkspace();
    const result = await executeQueryTool({
      tool: {
        name: "escape",
        description: "Escape",
        kind: "file-read",
        path: "../../{{name}}",
      },
      args: { name: "secrets.txt" },
      cwd,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("outside this orchestration's workspace");
  });
});

describe("http-get query tools", () => {
  test("refuses a non-http protocol", async () => {
    const result = await executeQueryTool({
      tool: { name: "f", description: "F", kind: "http-get", url: "file:///etc/passwd" },
      args: {},
      cwd: await makeWorkspace(),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("http(s)");
  });
});

describe("unknown kinds", () => {
  test("report rather than execute anything", async () => {
    const result = await executeQueryTool({
      tool: { name: "x", description: "X", kind: "sudo" },
      args: {},
      cwd: await makeWorkspace(),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("unknown kind");
  });
});
