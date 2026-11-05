import { describe, test, expect } from "vitest";
import { workflowNativeTools, workflowMcpAccess } from "./workflow-access.js";
import { nativeTools } from "./tools.js";
import type { ProviderSessionConfig } from "../../../server/provider.js";
const config: ProviderSessionConfig = {
  cwd: "/workspace",
  model: "model",
  settings: {},
  mcpServers: {},
  env: {},
  persist: false,
};
describe("Workflow native harness ceilings", () => {
  test("private managed control is distinct from arbitrary MCP mutation", () => {
    const context = { providerOptions: { ottoWorkflowWorkspaceAccess: "read" } };
    expect(workflowMcpAccess(context, "paseo", "delegate_workflow_task", false)).toBe("read");
    expect(workflowMcpAccess(context, "external", "delegate_workflow_task", false)).toBe("unknown");
    expect(workflowMcpAccess(context, "external", "writes_despite_annotation", true)).toBe(
      "unknown",
    );
    expect(workflowMcpAccess({}, "external", "ordinary_read_hint", true)).toBe("read");
    expect(workflowMcpAccess(context, "paseo", "create_agent", false)).toBe("unknown");
    expect(workflowMcpAccess({}, "paseo", "delegate_workflow_task", false)).toBe("unknown");
  });
  test("ordinary sessions preserve their exact native catalog", () => {
    const tools = nativeTools(config);
    expect(workflowNativeTools(config, tools)).toBe(tools);
  });
  test("none withholds filesystem and command tools while private control MCP stays daemon-owned", () => {
    expect(
      workflowNativeTools(
        { ...config, providerOptions: { ottoWorkflowWorkspaceAccess: "none" } },
        nativeTools(config),
      ),
    ).toEqual([]);
  });
  test("read offers only native reads regardless of the interactive permission mode", () => {
    const tools = workflowNativeTools(
      {
        ...config,
        mode: "bypassPermissions",
        providerOptions: { ottoWorkflowWorkspaceAccess: "read" },
      },
      nativeTools(config),
    );
    expect(tools.map((t) => t.definition.function.name)).toEqual(["otto_read_file"]);
  });
});
