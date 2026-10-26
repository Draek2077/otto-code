import { expect, test } from "vitest";
import {
  nativeReadOnlyConfig,
  readOnlyClaudeOptions,
  readOnlyCodexConfig,
  readOnlyPiArgs,
} from "./native-generation-policy.js";
import { buildPiLaunch } from "../../agent/providers/pi/runtime.js";
import { buildOmpLaunch } from "../../agent/providers/omp/runtime.js";

test.each(["claude", "codex", "opencode", "pi", "omp"])(
  "%s utility configuration cannot inherit a tool catalog or mutate its source",
  (family) => {
    const original = {
      provider: family,
      cwd: "/fixture",
      modeId: "full",
      systemPrompt: "original",
      mcpServers: { local: { type: "stdio" as const, command: "never-run" } },
      providerOptions: { native: "preserved" },
    };
    const config = nativeReadOnlyConfig(family, original);
    expect(config).toMatchObject({
      internal: true,
      mcpServers: {},
      toolPolicy: { preapproved: [] },
    });
    expect(config.systemPrompt).toContain("Do not modify files");
    expect(original.systemPrompt).toBe("original");
    expect(original.mcpServers.local.command).toBe("never-run");
  },
);
test("Claude options override even a previously permissive native/profile configuration", async () => {
  const options = readOnlyClaudeOptions({
    cwd: "/fixture",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: ["Bash"],
    mcpServers: { dangerous: { command: "never-run" } },
    settingSources: ["project", "user"],
    extraArgs: { tools: "Bash" },
  });
  expect(options).toMatchObject({
    tools: [],
    allowedTools: [],
    mcpServers: {},
    strictMcpConfig: true,
    permissionMode: "plan",
    allowDangerouslySkipPermissions: false,
    settingSources: [],
    settings: { disableAllHooks: true },
    hooks: {},
    agents: {},
    plugins: [],
    persistSession: false,
    extraArgs: {},
  });
  const controller = new AbortController();
  await expect(
    options.canUseTool?.(
      "Bash",
      {},
      { signal: controller.signal, toolUseID: "fixture", requestId: "fixture", suggestions: [] },
    ),
  ).resolves.toMatchObject({ behavior: "deny" });
});
test("Codex disables native AND profile MCP identities after custom options", () => {
  expect(
    readOnlyCodexConfig(
      {
        approval_policy: "never",
        sandbox_mode: "danger-full-access",
        mcp_servers: { profile: { enabled: true } },
        web_search: "live",
      },
      ["global"],
    ),
  ).toMatchObject({
    sandbox_mode: "read-only",
    web_search: "disabled",
    mcp_servers: { global: { enabled: false }, profile: { enabled: false } },
  });
});
test("Pi/OMP flags remove named tool/extension enablement while preserving model and command inputs", () => {
  expect(
    readOnlyPiArgs([
      "native-cli.js",
      "--tools",
      "bash,edit",
      "--extension=unsafe.js",
      "--hooks",
      "hook.js",
      "--model",
      "selected",
    ]),
  ).toEqual([
    "native-cli.js",
    "--model",
    "selected",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
  ]);
});
test.each([buildPiLaunch, buildOmpLaunch])(
  "the final native launch applies restrictions after replacement command arguments",
  (build) => {
    const launch = build({
      command: ["unused"],
      runtimeSettings: {
        command: {
          mode: "replace",
          argv: ["configured", "--tools", "bash", "--extension", "unsafe"],
        },
      },
      session: {
        cwd: "/fixture",
        model: "selected",
        noSession: true,
        ottoReadOnlyGeneration: true,
      },
    });
    expect(launch.argv[0]).toBe("configured");
    expect(launch.argv).toContain("--no-tools");
    expect(launch.argv).toContain("--no-extensions");
    expect(launch.argv).toContain("selected");
    expect(launch.argv).not.toContain("bash");
    expect(launch.argv).not.toContain("unsafe");
  },
);
test("unknown native families cannot silently become writable generation sessions", () => {
  expect(() =>
    nativeReadOnlyConfig("unreviewed", { provider: "unreviewed", cwd: "/fixture" }),
  ).toThrow("no enforced read-only");
});
