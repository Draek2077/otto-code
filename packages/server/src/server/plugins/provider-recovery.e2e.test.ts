import { PASEO_PLUGIN_API_VERSION } from "@otto-code/protocol/plugin-compatibility";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestOttoDaemon, type TestOttoDaemon } from "../test-utils/otto-daemon.js";

const execFileAsync = promisify(execFile);

interface FixtureEvent {
  kind: "boot" | "open" | "prompt";
  bootId: string;
  pid: number;
  sessionId?: string;
  history?: "replay" | "skip";
  persistence?: { version: number; data: { token: string; prompts: string[] } };
  text?: string;
}

function providerSource(witnessPath: string): string {
  return `import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PROVIDER_PROTOCOL_VERSION, type ProviderEvent, type ProviderRegistration } from "@getpaseo/plugin/server/provider";

const bootId = randomUUID();
const witness = (event: Record<string, unknown>) =>
  appendFileSync(${JSON.stringify(witnessPath)}, JSON.stringify({ ...event, bootId, pid: process.pid }) + "\\n");
const capabilities = ["prompt.message", "session.persistence", "session.configure"];
const config = {
  model: "recovery-model", models: [{ id: "recovery-model", label: "Recovery model" }],
  modes: [], thinkingOptions: [], settings: [],
};
const provider: ProviderRegistration = {
  id: "recovery-fixture", label: "Recovery fixture",
  async connect() {
    const listeners = new Set<(event: ProviderEvent) => void>();
    const sessions = new Map<string, string[]>();
    const emit = (event: ProviderEvent) => { for (const listener of listeners) listener(event); };
    const persistence = (prompts: string[]) => ({ version: 1, data: { token: "fixture-session", prompts: [...prompts] } });
    const replay = (sessionId: string, prompts: string[]) => {
      prompts.forEach((text, index) => {
        emit({ type: "timeline.item", sessionId, item: { type: "user_message", id: "user-" + index, text } });
        emit({ type: "timeline.item", sessionId, item: { type: "assistant_message", id: "answer-" + index, text: "Answer: " + text } });
      });
    };
    return {
      version: PROVIDER_PROTOCOL_VERSION, capabilities,
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async close() { sessions.clear(); listeners.clear(); },
      async send(input) {
        if (input.type === "catalog") {
          emit({ type: "catalog", requestId: input.requestId, catalog: { models: config.models, modes: [], thinkingOptions: [], defaultModel: config.model } });
          return;
        }
        if (input.type === "session.open") {
          witness({ kind: "open", sessionId: input.sessionId, history: input.history, persistence: input.persistence });
          const restored = input.persistence?.data as { token: string; prompts: string[] } | undefined;
          if (input.history === "replay" && (!restored || restored.token !== "fixture-session")) {
            throw new Error("Reopen must use the previously emitted persistence handle");
          }
          const prompts = [...(restored?.prompts ?? [])];
          sessions.set(input.sessionId, prompts);
          emit({ type: "session.opened", requestId: input.requestId, sessionId: input.sessionId,
            capabilities, restoration: "core", persistence: persistence(prompts), cwd: input.config.cwd });
          emit({ type: "session.config", sessionId: input.sessionId, config });
          if (input.history === "replay") replay(input.sessionId, prompts);
          emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
          return;
        }
        if (input.type === "session.prompt") {
          if (input.prompt.input.type !== "message") throw new Error("Only fixture messages are supported");
          const prompts = sessions.get(input.sessionId);
          if (!prompts) throw new Error("Prompt requires an opened session");
          const text = input.prompt.input.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
          witness({ kind: "prompt", sessionId: input.sessionId, text });
          const index = prompts.length;
          const turnId = "turn-" + index;
          emit({ type: "session.prompt_result", sessionId: input.sessionId, clientMessageId: input.prompt.clientMessageId, result: { type: "turn", turnId } });
          emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "started" });
          emit({ type: "timeline.item", sessionId: input.sessionId, item: { type: "user_message", id: "user-" + index, text, clientMessageId: input.prompt.clientMessageId } });
          emit({ type: "timeline.item", sessionId: input.sessionId, item: { type: "assistant_message", id: "answer-" + index, text: "Answer: " + text } });
          prompts.push(text);
          emit({ type: "session.persistence", sessionId: input.sessionId, persistence: persistence(prompts) });
          emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "completed" });
          return;
        }
        if (input.type === "session.close") {
          sessions.delete(input.sessionId);
          emit({ type: "session.closed", sessionId: input.sessionId });
        }
        if ("requestId" in input) emit({ type: "request.completed", requestId: input.requestId });
      },
    };
  },
};
export default function contribute(server: PluginServerContext) {
  witness({ kind: "boot" });
  server.registerProvider(provider);
  return () => undefined;
}
`;
}

test("reloaded plugin provider reopens an existing agent from persistence and accepts one new prompt", async () => {
  // The lead scopes TEMP/TMP to this worktree's .tmp for serialized E2E runs.
  const root = await mkdtemp(path.join(tmpdir(), "otto-provider-recovery-"));
  const pluginDirectory = path.join(root, "plugin");
  const cwd = path.join(root, "workspace");
  const witnessPath = path.join(root, "witness.jsonl");
  let daemon: TestOttoDaemon | undefined;
  let client: DaemonClient | undefined;
  try {
    await Promise.all([
      mkdir(pluginDirectory),
      mkdir(cwd),
      mkdir(path.join(root, "static")),
      writeFile(witnessPath, ""),
    ]);
    // TEMP may live inside a worktree; give the fixture its own repository root
    // so workspace discovery cannot normalize to the user's enclosing checkout.
    await execFileAsync("git", ["-c", "core.fsmonitor=false", "init", cwd]);
    await writeFile(
      path.join(pluginDirectory, "otto-plugin.json"),
      JSON.stringify({
        id: "provider-recovery",
        requirements: { paseo: `>=${PASEO_PLUGIN_API_VERSION}` },
      }),
    );
    await writeFile(path.join(pluginDirectory, "index.server.ts"), providerSource(witnessPath));
    daemon = await createTestOttoDaemon({
      ottoHomeRoot: path.join(root, "daemon"),
      staticDir: path.join(root, "static"),
      relayEnabled: false,
      mcpEnabled: false,
      cleanup: false,
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
      id: "provider-recovery",
      status: "running",
    });
    const createdWorkspace = await client.createWorkspace({
      source: { kind: "directory", path: cwd },
      title: "Recovery workspace",
    });
    if (!createdWorkspace.workspace) {
      throw new Error(createdWorkspace.error ?? "Workspace creation failed");
    }
    const workspace = createdWorkspace.workspace;
    expect(path.resolve(workspace.projectRootPath)).toBe(path.resolve(cwd));
    expect(path.resolve(workspace.workspaceDirectory)).toBe(path.resolve(cwd));
    const agent = await client.createAgent({
      provider: "recovery-fixture",
      model: "recovery-model",
      title: "Keep this agent",
      cwd,
      workspaceId: workspace.id,
    });
    expect(path.resolve(agent.cwd)).toBe(path.resolve(cwd));
    const connectedClient = client;
    const readEvents = async (): Promise<FixtureEvent[]> =>
      (await readFile(witnessPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FixtureEvent);
    const transcript = async () =>
      (
        await connectedClient.fetchAgentTimeline(agent.id, { projection: "projected" })
      ).entries.flatMap(({ item }) =>
        item.type === "user_message" || item.type === "assistant_message" ? [item.text] : [],
      );
    const waitForIdle = async () => {
      await expect
        .poll(
          async () =>
            (await connectedClient.fetchAgents()).entries.find(
              (entry) => entry.agent.id === agent.id,
            )?.agent.status,
          { timeout: 15_000 },
        )
        .toBe("idle");
    };
    await client.sendMessage(agent.id, "before reload");
    await expect
      .poll(transcript, { timeout: 15_000 })
      .toEqual(["before reload", "Answer: before reload"]);
    await waitForIdle();
    const before = await readEvents();
    expect(before.filter((event) => event.kind === "open")).toEqual([
      expect.objectContaining({ history: "skip" }),
    ]);
    expect(before.find((event) => event.kind === "open")?.persistence).toBeUndefined();

    await expect(client.reloadPlugin("provider-recovery")).resolves.toMatchObject({
      status: "running",
    });
    // No direct registry update, manual AgentManager reload, or replacement agent.
    await client.sendMessage(agent.id, "after reload");
    await expect
      .poll(transcript, { timeout: 30_000 })
      .toEqual(["before reload", "Answer: before reload", "after reload", "Answer: after reload"]);
    await waitForIdle();
    const after = await readEvents();
    const boots = after.filter((event) => event.kind === "boot");
    const opens = after.filter((event) => event.kind === "open");
    const prompts = after.filter((event) => event.kind === "prompt");
    expect(boots).toHaveLength(2);
    expect(boots[1]?.bootId).not.toBe(boots[0]?.bootId);
    expect(boots[1]?.pid).not.toBe(boots[0]?.pid);
    expect(opens).toHaveLength(2);
    expect(opens[1]).toMatchObject({
      bootId: boots[1]?.bootId,
      history: "replay",
      persistence: { version: 1, data: { token: "fixture-session", prompts: ["before reload"] } },
    });
    expect(opens[1]?.sessionId).not.toBe(opens[0]?.sessionId);
    expect(prompts).toEqual([
      expect.objectContaining({
        bootId: boots[0]?.bootId,
        text: "before reload",
        sessionId: opens[0]?.sessionId,
      }),
      expect.objectContaining({
        bootId: boots[1]?.bootId,
        text: "after reload",
        sessionId: opens[1]?.sessionId,
      }),
    ]);
    const agents = (await client.fetchAgents()).entries.map((entry) => entry.agent);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: agent.id,
      workspaceId: workspace.id,
      title: "Keep this agent",
      model: "recovery-model",
      provider: "recovery-fixture",
      persistence: {
        provider: "recovery-fixture",
        metadata: {
          pluginProviderPersistence: {
            version: 1,
            data: { token: "fixture-session", prompts: ["before reload", "after reload"] },
          },
        },
      },
    });
  } finally {
    try {
      await client?.close();
    } finally {
      try {
        await daemon?.close();
      } finally {
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  }
}, 90_000);
