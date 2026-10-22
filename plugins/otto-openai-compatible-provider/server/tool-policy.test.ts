import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { AgentTool } from "./tools.js";
import { toolDecision, isToolAvailable } from "./tool-policy.js";

it("auto-accepts workspace edits only after resolving the real parent, and withholds writes in Read only mode", async () => {
  const root = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(path.join(root, "provider-policy-"));
  try {
    const cwd = path.join(scratch, "workspace");
    const outside = path.join(scratch, "outside");
    await mkdir(cwd);
    await mkdir(outside);
    await writeFile(path.join(outside, "file.txt"), "unchanged");
    await symlink(
      outside,
      path.join(cwd, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const tool: AgentTool = {
      access: "write",
      definition: {
        type: "function",
        function: { name: "otto_write_file", description: "write", parameters: {} },
      },
      detail: () => ({ type: "write", filePath: "unused" }),
      execute: async () => "unused",
    };
    expect(
      await toolDecision(
        "acceptEdits",
        tool,
        { type: "write", filePath: path.join(cwd, "file.txt") },
        cwd,
      ),
    ).toBe("allow");
    expect(
      await toolDecision(
        "acceptEdits",
        tool,
        { type: "write", filePath: path.join(cwd, "linked", "file.txt") },
        cwd,
      ),
    ).toBe("ask");
    expect(
      await toolDecision(
        "dontAsk",
        tool,
        { type: "write", filePath: path.join(cwd, "file.txt") },
        cwd,
      ),
    ).toBe("deny");
    expect(
      await toolDecision(
        "bypassPermissions",
        tool,
        { type: "write", filePath: path.join(outside, "file.txt") },
        cwd,
      ),
    ).toBe("allow");
    expect(isToolAvailable("plan", tool)).toBe(false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
