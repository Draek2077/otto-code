import { describe, test, expect } from "vitest";
import type { AgentSessionConfig, AgentLaunchContext } from "../../agent/agent-sdk-types.js";
import type { WorkflowAgentBinding } from "./runtime-ports.js";
import {
  attachWorkflowLaunchOwner,
  prepareWorkflowLaunch,
  workflowClaudeOptions,
  supportsWorkflowAccess,
} from "./provider-policy.js";
const config: AgentSessionConfig = { provider: "claude", model: "model", cwd: "/fixture" };
const binding: WorkflowAgentBinding = {
  ref: {
    scope: { hostId: "host", projectId: "project" },
    kind: "run",
    id: "run",
    location: "repository",
  },
  role: "worker",
  request: {
    agentId: "worker",
    runId: "run",
    ownerInstance: "instance",
    workspace: { workspaceId: "workspace", projectId: "project", cwd: "/fixture" },
    seat: { provider: "claude", model: "model" },
    role: "worker",
    title: "Work",
    access: "read",
  },
};
describe("Workflow launch ceilings", () => {
  test("unowned Paseo launch and Claude SDK options are returned by identity", () => {
    const manager = {};
    expect(prepareWorkflowLaunch(manager, config, {})).toBe(config);
    const sdk = { cwd: "/fixture" };
    expect(workflowClaudeOptions(sdk, undefined)).toBe(sdk);
  });
  test("revoked startup rejects before a provider session can begin", () => {
    const manager = {};
    const detach = attachWorkflowLaunchOwner(manager, {
      binding: () => binding,
      active: () => false,
      family: () => "claude",
    });
    try {
      expect(() => prepareWorkflowLaunch(manager, config, { agentId: "worker" })).toThrow(
        "revoked",
      );
    } finally {
      detach();
    }
  });
  test.each(["provider", "model", "cwd"] as const)(
    "launch customizations cannot replace captured %s",
    (key) => {
      const manager = {};
      const detach = attachWorkflowLaunchOwner(manager, {
        binding: () => binding,
        active: () => true,
        family: () => "claude",
      });
      try {
        expect(() =>
          prepareWorkflowLaunch(manager, { ...config, [key]: "changed" }, { agentId: "worker" }),
        ).toThrow("captured");
      } finally {
        detach();
      }
    },
  );
  test("read access drops unknown MCP authority and exposes a runtime-only ceiling", () => {
    const manager = {};
    const detach = attachWorkflowLaunchOwner(manager, {
      binding: () => binding,
      active: () => true,
      family: () => "claude",
    });
    const context: AgentLaunchContext = { agentId: "worker" };
    try {
      const launch = prepareWorkflowLaunch(
        manager,
        {
          ...config,
          mcpServers: {
            paseo: { type: "http", url: "http://fixture" },
            unknown: { type: "http", url: "http://unknown" },
          },
        },
        context,
      );
      expect(Object.keys(launch.mcpServers ?? {})).toEqual(["paseo"]);
      expect(context.ottoWorkflowPolicy).toEqual({ access: "read" });
      expect(config).not.toHaveProperty("ottoWorkflowPolicy");
    } finally {
      detach();
    }
  });
  test("Claude read mode cannot regain writes/native delegation through permissive defaults", async () => {
    const options = workflowClaudeOptions(
      {
        permissionMode: "bypassPermissions",
        allowedTools: ["*"],
        canUseTool: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
      },
      { access: "read" },
    );
    const context = {
      signal: new AbortController().signal,
      toolUseID: "tool",
      requestId: "request",
    };
    expect(options.tools).toEqual(expect.arrayContaining(["Read", "Grep"]));
    expect(options.allowDangerouslySkipPermissions).toBe(false);
    for (const name of [
      "Write",
      "Edit",
      "Bash",
      "Agent",
      "Task",
      "ExitPlanMode",
      "mcp__external__write",
    ])
      expect(await options.canUseTool!(name, {}, context)).toMatchObject({ behavior: "deny" });
    expect(await options.canUseTool!("Read", {}, context)).toMatchObject({ behavior: "allow" });
    expect(await options.canUseTool!("mcp__paseo__submit_output", {}, context)).toMatchObject({
      behavior: "allow",
    });
  });
  test("None has no native read or execution tools", async () => {
    const options = workflowClaudeOptions({}, { access: "none" });
    expect(options.tools).toEqual([]);
    expect(
      await options.canUseTool!(
        "Read",
        {},
        { signal: new AbortController().signal, toolUseID: "read", requestId: "request" },
      ),
    ).toMatchObject({ behavior: "deny" });
  });
  test("unknown access adapters fail closed instead of treating a prompt as a sandbox", () => {
    expect(supportsWorkflowAccess("unrecognized", "read")).toBe(false);
    expect(supportsWorkflowAccess("codex", "none")).toBe(false);
    expect(supportsWorkflowAccess("otto-openai", "read")).toBe(true);
    expect(supportsWorkflowAccess("otto-openai", "none")).toBe(true);
  });
});
