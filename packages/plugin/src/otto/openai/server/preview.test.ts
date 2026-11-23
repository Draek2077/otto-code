import { afterEach, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PreviewStartGate, type PreviewCommandApproval } from "../../preview/server/start-gate.js";
import { preparePreviewCall, acceptPreviewCall, previewPermissionDecision } from "./preview.js";
import type { AgentTool } from "./tools.js";
import { z } from "zod";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const entry = { name: "web", runtimeExecutable: "npm", runtimeArgs: ["run", "dev"], port: 8200 };
const approval: PreviewCommandApproval = {
  name: "web",
  revision: "revision",
  command: "npm run dev",
  cwd: "/fixture",
  changed: false,
};
function tool(server = "otto"): AgentTool {
  return {
    preapproval: { server, tool: "preview_start" },
    access: "unknown",
    definition: {
      type: "function",
      function: { name: "fixture", description: "Preview", parameters: {} },
    },
    detail: (input) => ({
      type: "unknown",
      input: z.record(z.string(), z.json()).parse(input),
      output: null,
    }),
    execute: vi.fn(async () => "not executed by approval"),
  };
}
async function fixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "otto-preview-policy-"));
  roots.push(cwd);
  await mkdir(path.join(cwd, ".claude"));
  const file = path.join(cwd, ".claude", "launch.json");
  await writeFile(file, JSON.stringify({ configurations: [entry] }));
  const gate = new PreviewStartGate(cwd);
  await gate.capture();
  return { gate, file };
}
test.each([
  ["default", false, "ask"],
  ["default", true, "ask"],
  ["acceptEdits", false, "ask"],
  ["acceptEdits", true, "ask"],
  ["dontAsk", false, "deny"],
  ["dontAsk", true, "deny"],
  ["plan", false, "deny"],
  ["bypassPermissions", true, "allow"],
] as const)("Preview %s changed=%s follows %s", (mode, changed, decision) => {
  expect(previewPermissionDecision(mode, { ...approval, changed })).toBe(decision);
});
test("unrelated MCP tools keep ordinary policy without reading Preview configuration", async () => {
  const gate = new PreviewStartGate("/nonexistent-not-read");
  const other = tool("another-server");
  const input = { name: "not-a-project-server", commandRevision: "unrelated" };
  expect(await preparePreviewCall(gate, other, input)).toEqual({
    input,
    detail: other.detail(input),
  });
  expect(previewPermissionDecision("acceptEdits", undefined)).toBeUndefined();
});
test.each(["default", "acceptEdits", "dontAsk"] as const)(
  "%s preserves only an unchanged exact MCP grant",
  (mode) => {
    expect(previewPermissionDecision(mode, approval, true)).toBe("allow");
    expect(previewPermissionDecision(mode, { ...approval, changed: true }, true)).toBe(
      mode === "dontAsk" ? "deny" : "ask",
    );
    expect(previewPermissionDecision("plan", approval, true)).toBe("deny");
  },
);
test("the prepared call shows the real argv and pins the daemon's matching command digest", async () => {
  const f = await fixture();
  const preview = tool();
  const prepared = await preparePreviewCall(f.gate, preview, {
    name: "web",
    commandRevision: "model-supplied",
  });
  expect(prepared.detail).toMatchObject({ type: "shell", command: '"npm" "run" "dev"' });
  expect(prepared.input.commandRevision).toMatch(/^[0-9a-f]{64}$/);
  expect(prepared.approval?.changed).toBe(false);
  expect(preview.execute).not.toHaveBeenCalled();
  await expect(
    acceptPreviewCall(f.gate, prepared, { ...prepared.input, name: "other" }),
  ).rejects.toThrow("target changed");
  await writeFile(f.file, JSON.stringify({ configurations: [{ ...entry, env: { TASK: "new" } }] }));
  await expect(acceptPreviewCall(f.gate, prepared, prepared.input)).rejects.toThrow(
    "changed during approval",
  );
  expect((await f.gate.resolve("web")).changed).toBe(true);
});
test("only accepting the exact changed command restores later automatic launch permission", async () => {
  const f = await fixture();
  await writeFile(
    f.file,
    JSON.stringify({ configurations: [{ ...entry, runtimeArgs: ["run", "reviewed"] }] }),
  );
  const prepared = await preparePreviewCall(f.gate, tool(), { name: "web" });
  expect(previewPermissionDecision("acceptEdits", prepared.approval, true)).toBe("ask");
  await acceptPreviewCall(f.gate, prepared, prepared.input);
  expect(
    previewPermissionDecision(
      "acceptEdits",
      (await preparePreviewCall(f.gate, tool(), { name: "web" })).approval,
      true,
    ),
  ).toBe("allow");
});
