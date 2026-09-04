import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentHooksAreInstalled,
  buildAgentHookWindowsCommand,
  installAgentHooks,
  uninstallAgentHooks,
} from "../agent-hook-installer.js";
import { resolveOttoCliExecutablePath } from "../../terminal.js";
import { codexAgentHookProvider } from "./codex.js";

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

interface TestCodexHooksFile {
  hooks?: Record<string, unknown>;
}

interface TestCodexCommandHook {
  command?: string;
  commandWindows?: string;
}

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

function readHooksFile(configDir: string): TestCodexHooksFile {
  return JSON.parse(readFileSync(join(configDir, "hooks.json"), "utf8")) as TestCodexHooksFile;
}

async function createActivityRecorder(): Promise<{
  server: ReturnType<typeof createServer>;
  posts: unknown[];
  url: string;
}> {
  const posts: unknown[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      posts.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      response.writeHead(204);
      response.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { server, posts, url: `http://127.0.0.1:${address.port}` };
}

function commandHooks(config: TestCodexHooksFile, event: string): TestCodexCommandHook[] {
  const entries = config.hooks?.[event];
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      return [];
    }
    return entry.hooks.filter(isRecord).map((hook) => ({
      command: typeof hook.command === "string" ? hook.command : undefined,
      commandWindows: typeof hook.commandWindows === "string" ? hook.commandWindows : undefined,
    }));
  });
}

function decodeWindowsHook(command: string | undefined): string | null {
  const encoded = command?.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/)?.[1];
  return encoded ? Buffer.from(encoded, "base64").toString("utf16le") : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Codex terminal agent hooks", () => {
  it("installs POSIX and Windows hook commands idempotently", () => {
    const configDir = createTempDir("otto-codex-config-");

    installAgentHooks(codexAgentHookProvider, { configDir });
    const secondInstall = installAgentHooks(codexAgentHookProvider, { configDir });

    const config = readHooksFile(configDir);
    for (const event of codexAgentHookProvider.events) {
      const hooks = commandHooks(config, event.event);
      expect(hooks).toHaveLength(1);
      expect(hooks[0]?.command).toBe(
        `if [ -n "$OTTO_TERMINAL_ID" ]; then "\${OTTO_HOOK_CLI:-otto}" hooks codex ${event.event}; fi`,
      );
      expect(hooks[0]?.commandWindows).toMatch(
        /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
      );
      expect(decodeWindowsHook(hooks[0]?.commandWindows)).toBe(
        `if ($env:OTTO_TERMINAL_ID) { if ($env:OTTO_HOOK_CLI) { & $env:OTTO_HOOK_CLI hooks codex ${event.event} } else { & otto hooks codex ${event.event} } }`,
      );
    }
    expect(secondInstall.changed).toBe(false);
    expect(agentHooksAreInstalled(codexAgentHookProvider, { configDir })).toBe(true);
  });

  it.skipIf(process.platform !== "win32").each([
    ["cmd.exe", ["/d", "/s", "/c"]],
    ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command"]],
  ])("runs the Windows hook from %s and reports terminal activity", async (shell, shellArgs) => {
    const recorder = await createActivityRecorder();

    try {
      const cliPath = resolveOttoCliExecutablePath();
      expect(cliPath).not.toBeNull();
      const command = buildAgentHookWindowsCommand(
        codexAgentHookProvider,
        codexAgentHookProvider.events[0],
      );
      const child = spawn(shell, [...shellArgs, command], {
        env: {
          ...process.env,
          OTTO_TERMINAL_ID: "terminal-id",
          OTTO_ACTIVITY_TOKEN: "activity-token",
          OTTO_TERMINAL_ACTIVITY_URL: recorder.url,
          OTTO_HOOK_CLI: cliPath ?? "",
        },
        stdio: "ignore",
      });
      const [exitCode] = (await once(child, "exit")) as [number | null];

      expect(exitCode).toBe(0);
      expect(recorder.posts).toEqual([
        { terminalId: "terminal-id", token: "activity-token", state: "running" },
      ]);
    } finally {
      recorder.server.close();
      await once(recorder.server, "close");
    }
  });

  it("preserves unrelated user hooks", () => {
    const configDir = createTempDir("otto-codex-config-preserve-");
    writeFileSync(
      join(configDir, "hooks.json"),
      `${JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                matcher: "",
                hooks: [{ type: "command", command: "say codex done", timeout: 5 }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    installAgentHooks(codexAgentHookProvider, { configDir });

    const stopCommands = commandHooks(readHooksFile(configDir), "Stop").map((hook) => hook.command);
    expect(stopCommands).toEqual([
      "say codex done",
      'if [ -n "$OTTO_TERMINAL_ID" ]; then "${OTTO_HOOK_CLI:-otto}" hooks codex Stop; fi',
    ]);
  });

  it("uninstalls only marker-matched hooks", () => {
    const configDir = createTempDir("otto-codex-config-uninstall-");
    installAgentHooks(codexAgentHookProvider, { configDir });
    const config = readHooksFile(configDir);
    config.hooks = {
      ...config.hooks,
      Stop: [
        ...(Array.isArray(config.hooks?.Stop) ? config.hooks.Stop : []),
        {
          matcher: "",
          hooks: [{ type: "command", command: "say still-here", timeout: 5 }],
        },
      ],
    };
    writeFileSync(join(configDir, "hooks.json"), `${JSON.stringify(config, null, 2)}\n`);

    uninstallAgentHooks(codexAgentHookProvider, { configDir });

    expect(commandHooks(readHooksFile(configDir), "Stop").map((hook) => hook.command)).toEqual([
      "say still-here",
    ]);
    expect(agentHooksAreInstalled(codexAgentHookProvider, { configDir })).toBe(false);
  });

  it.each([
    ["UserPromptSubmit", "running"],
    ["PreToolUse", "running"],
    ["PostToolUse", "running"],
    ["PermissionRequest", "needs-input"],
    ["Stop", "idle"],
  ] as const)("maps %s to %s", async (event, state) => {
    await expect(
      codexAgentHookProvider.resolveActivity({
        event,
        input: { read: async () => null },
      }),
    ).resolves.toBe(state);
  });
});
