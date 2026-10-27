import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

// CI-only native evidence. Echo is local: no credentials or model request.
if (process.env.CI !== "true") throw new Error("Native contract probes run only in CI.");
const root = path.resolve(process.env.RUNNER_TEMP, "native-context-contracts");
const home = process.env.HOME;
const binary = path.join(home, "bin", "muse");
const workspace = path.join(root, "workspace");
const settings = path.join(home, ".config", "muse");
await mkdir(workspace, { recursive: true });
await mkdir(settings, { recursive: true });
const marker = path.join(root, "hook-ran");
const mcpMarker = path.join(root, "mcp-ran");
const managedMarker = path.join(root, "managed-hook-ran");
const sentinel = path.join(root, "sentinel.mjs");
await writeFile(sentinel, 'import fs from "node:fs"; fs.writeFileSync(process.argv[2], "ran");\n');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const hook = (target) => ({
  SessionStart: [
    {
      hooks: [
        {
          type: "command",
          command: `${quote(process.execPath)} ${quote(sentinel)} ${quote(target)}`,
          timeout: 5,
        },
      ],
    },
  ],
});
const managed = path.join(settings, "managed-hooks.json");
await writeFile(managed, JSON.stringify({ hooks: hook(managedMarker) }));
await writeFile(
  path.join(settings, "settings.json"),
  JSON.stringify({
    schema_version: 1,
    hooks: hook(marker),
    managed_hooks_path: managed,
    mcp_servers: {
      sentinel: {
        transport: "stdio",
        command: process.execPath,
        args: [sentinel, mcpMarker],
        enabled: true,
        mode: "required",
      },
    },
  }),
);
const base = [
  "exec",
  "--provider",
  "echo",
  "--preset",
  "empty",
  "--no-session-log",
  "--json",
  "--workspace",
  workspace,
];
const policy = [
  "--permission-profile",
  ":read-only",
  "--disable-write",
  "--disable-shell",
  "--disable-web-tools",
  "--disable-reminders",
  "--disable-request-user-input",
  "--no-foreign-personal-context",
  "--contributor-mode",
  "off",
  "-c",
  "hooks={}",
  "-c",
  'managed_hooks_path=""',
  "-c",
  "mcp_servers={}",
];
async function probe(name, args) {
  for (const target of [marker, mcpMarker, managedMarker])
    await unlink(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  let result;
  try {
    result = {
      code: 0,
      stdout: execFileSync(binary, args, {
        cwd: workspace,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 1048576,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    result = {
      code: error.status,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    };
  }
  result.effects = {};
  for (const [label, target] of Object.entries({
    userHook: marker,
    managedHook: managedMarker,
    mcp: mcpMarker,
  })) {
    result.effects[label] = await readFile(target, "utf8").then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
  }
  await writeFile(path.join(root, `${name}.json`), JSON.stringify({ args, ...result }, null, 2));
}
await probe("muse-configured-control", [...base, "fixture"]);
await probe("muse-read-only-empty", [...base, ...policy, "fixture"]);
await probe("muse-read-only-named-mcp", [
  ...base,
  ...policy.slice(0, -2),
  "-c",
  "mcpServers.sentinel.enabled=false",
  "fixture",
]);
await probe("muse-read-only-server-object", [
  ...base,
  ...policy.slice(0, -2),
  "-c",
  'mcpServers.sentinel={"enabled":false}',
  "fixture",
]);
await probe("muse-read-only-snake-field", [
  ...base,
  ...policy.slice(0, -2),
  "-c",
  "mcp_servers.sentinel.enabled=false",
  "fixture",
]);
const fixtureSettings = JSON.parse(await readFile(path.join(settings, "settings.json"), "utf8"));
fixtureSettings.mcp_servers = {};
await writeFile(path.join(settings, "settings.json"), JSON.stringify(fixtureSettings));
await probe("muse-read-only-without-mcp", [...base, ...policy.slice(0, -2), "fixture"]);
// Agent discovery is not a model turn. Check the documented empty-tool primary
// agent format without granting access to a real project or native account.
await mkdir(path.join(workspace, ".agents", "agents"), { recursive: true });
await writeFile(
  path.join(workspace, ".agents", "agents", "otto-context-proposal.md"),
  `---
name: otto-context-proposal
description: Context proposal fixture
mainAgent: true
subagent: false
tools: []
commandExecutionPolicy: off
mcpServers: []
skills: []
plugins: []
---
Return only supplied prose. Do not perform actions.
`,
);
const result = spawnSync(path.join(home, "bin", "agy"), ["--add-dir", workspace, "agents"], {
  cwd: workspace,
  encoding: "utf8",
  timeout: 30000,
  maxBuffer: 1048576,
  stdio: ["ignore", "pipe", "pipe"],
});
const agents = {
  code: result.status,
  stdout: result.stdout,
  stderr: result.stderr,
  failed: Boolean(result.error),
};
await writeFile(path.join(root, "agy-agents.json"), JSON.stringify(agents, null, 2));
