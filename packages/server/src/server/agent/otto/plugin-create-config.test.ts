import { expect, test } from "vitest";
import { createOttoApi } from "@otto-code/client";
import { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { PluginRuntime } from "../../plugins/runtime.js";
import { PluginHookHandlers, validateBeforeRequest } from "../../plugins/lifecycle/index.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentSessionConfig } from "../agent-sdk-types.js";
import { applyPluginCreateConfig } from "./plugin-create-config.js";

function config(): AgentSessionConfig {
  return {
    provider: "codex",
    cwd: "/workspace",
    model: "original",
    modeId: "plan",
    profileSnapshot: {
      profileId: "vera",
      name: "Vera",
      provider: "codex",
      model: "original",
      modeId: "plan",
      effortDegraded: false,
      roles: [],
      respectGlobalAppendPrompt: false,
    },
    teamSnapshot: { teamId: "team", name: "Team", teamPrompt: "Born team prompt" },
    workspaceAccess: "read",
    unattended: true,
    observable: true,
    internal: false,
    daemonAppendSystemPrompt: "Daemon-owned instructions",
  };
}

const otto = createOttoApi(
  new DaemonClient({ url: "ws://127.0.0.1:1/ws", clientId: "create-config-unit" }),
);

test("empty stable runtime cannot erase daemon-owned creation metadata", async () => {
  const original = config();
  const runtime = new PluginRuntime(createTestLogger(), "0.9.10");
  const result = await applyPluginCreateConfig(original, { ORIGINAL: "yes" }, runtime);
  expect(result).toEqual({ config: original, env: { ORIGINAL: "yes" } });
});

test("registered transforms own public settings and clearing, never frozen identity or policy", async () => {
  const original = config();
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("agent.create", ({ request }) => {
    expect(request.config).not.toHaveProperty("profileSnapshot");
    expect(request.config).not.toHaveProperty("workspaceAccess");
    const { modeId: _removed, ...settings } = request.config;
    return {
      config: { ...settings, provider: "claude", model: "replacement" },
      env: { TRANSFORMED: "yes" },
    };
  });
  const result = await applyPluginCreateConfig(
    original,
    { ORIGINAL: "yes" },
    {
      before: async (name, input) =>
        validateBeforeRequest(name, await hooks.invoke("create", "before", name, input, otto)),
    },
  );
  expect(result.config).toEqual({
    ...original,
    provider: "claude",
    model: "replacement",
    modeId: undefined,
  });
  expect(result.env).toEqual({ TRANSFORMED: "yes" });
  expect(original.provider).toBe("codex");
  expect(original.modeId).toBe("plan");
});

test("stable workspace-directory protection still rejects a creation transform", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("agent.create", ({ request }) => ({
    ...request,
    config: { ...request.config, cwd: "/elsewhere" },
  }));
  await expect(
    applyPluginCreateConfig(config(), undefined, {
      before: async (name, input) =>
        validateBeforeRequest(name, await hooks.invoke("create", "before", name, input, otto)),
    }),
  ).rejects.toThrow("agent.create hooks cannot change the workspace directory");
});
