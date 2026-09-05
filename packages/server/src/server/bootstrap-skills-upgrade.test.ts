/** Regression: startup used default-all before Electron could import a custom
 * selection, adding excluded skills. Exercise real config loading, bootstrap,
 * availability, WebSocket import, and persisted restart with isolated targets. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AgentSkillSelection } from "@otto-code/protocol/messages";
import { createOttoDaemon } from "./bootstrap";
import { loadConfig } from "./config";
import { loadPersistedConfig } from "./persisted-config";
import { createTestAgentClients } from "./test-utils/fake-agent-client";
import { DaemonClient } from "./test-utils/daemon-client";
import type { SkillTargets } from "./orchestration-skills/internal/operations";

async function fixture(selection?: AgentSkillSelection) {
  const scratch = fileURLToPath(new URL("../../../../.tmp/agent-02/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "bootstrap-skills-"));
  const home = path.join(root, "daemon");
  await mkdir(home);
  await writeFile(
    path.join(home, "config.json"),
    JSON.stringify({
      version: 1,
      daemon: {
        listen: "127.0.0.1:0",
        relay: { enabled: false },
        mcp: { enabled: false, injectIntoAgents: false },
        agentProfiles: [],
      },
      agents: { ...(selection ? { skills: { selection } } : {}), agentTeams: { teams: [] } },
    }),
  );
  const targets: SkillTargets = {
    sourceDir: path.join(root, "bundle"),
    agentsDir: path.join(root, "user", ".agents", "skills"),
    claudeDir: path.join(root, "user", ".claude", "skills"),
    codexDir: path.join(root, "user", ".codex", "skills"),
  };
  for (const name of ["otto", "otto-advisor"]) {
    await mkdir(path.join(targets.sourceDir, name), { recursive: true });
    await writeFile(path.join(targets.sourceDir, name, "SKILL.md"), `${name}-new`);
  }
  for (const target of [targets.agentsDir, targets.claudeDir, targets.codexDir]) {
    await mkdir(path.join(target, "otto"), { recursive: true });
    await writeFile(path.join(target, "otto", "SKILL.md"), "old");
  }
  return { root, home, targets };
}

async function start(f: Awaited<ReturnType<typeof fixture>>) {
  const config = loadConfig(f.home, {
    env: {
      OTTO_DESKTOP_MANAGED: "1",
      OTTO_DICTATION_ENABLED: "0",
      OTTO_VOICE_MODE_ENABLED: "0",
    },
  });
  config.agentClients = createTestAgentClients();
  config.staticDir = path.join(f.root, "static");
  let resolutions = 0;
  const daemon = await createOttoDaemon(config, pino({ level: "silent" }), {
    resolveSkillTargets() {
      resolutions += 1;
      return f.targets;
    },
  });
  let client: DaemonClient | undefined;
  try {
    await daemon.start();
    const listen = daemon.getListenTarget();
    if (!listen || listen.type !== "tcp") throw new Error("Missing test TCP listener");
    client = new DaemonClient({ url: `ws://127.0.0.1:${listen.port}/ws`, appVersion: "0.9.0" });
    await client.connect();
    return {
      daemon,
      client,
      resolutions: () => resolutions,
      async close() {
        await client?.close();
        await daemon.stop();
      },
    };
  } catch (error) {
    await client?.close();
    await daemon.stop();
    throw error;
  }
}

async function installed(f: Awaited<ReturnType<typeof fixture>>) {
  return Promise.all(
    [f.targets.agentsDir, f.targets.claudeDir, f.targets.codexDir].map(async (directory) =>
      (await readdir(directory)).sort(),
    ),
  );
}

describe("desktop skill selection through daemon startup", () => {
  it("is reachable before import, then maintains only the durable custom selection across restart", async () => {
    const f = await fixture();
    try {
      const first = await start(f);
      try {
        expect(first.client.getLastServerInfoMessage()?.desktopManaged).toBe(true);
        expect(first.resolutions()).toBe(0);
        expect(await installed(f)).toEqual([["otto"], ["otto"], ["otto"]]);
        expect(
          await first.client.importLegacyAgentSkillsSelection({ mode: "custom", skills: ["otto"] }),
        ).toMatchObject({ imported: true, selection: { mode: "custom", skills: ["otto"] } });
        const status = await first.client.getAgentSkillsStatus();
        expect(status.selection).toEqual({ mode: "custom", skills: ["otto"] });
        expect(await installed(f)).toEqual([["otto"], ["otto"], ["otto"]]);
        expect(await readFile(path.join(f.targets.agentsDir, "otto", "SKILL.md"), "utf8")).toBe(
          "otto-new",
        );
        expect(loadPersistedConfig(f.home).agents?.skills?.selection).toEqual(status.selection);
      } finally {
        await first.close();
      }
      const second = await start(f);
      try {
        expect(await second.client.importLegacyAgentSkillsSelection({ mode: "all" })).toMatchObject(
          { imported: false, selection: { mode: "custom", skills: ["otto"] } },
        );
        await second.client.getAgentSkillsStatus();
        expect(await installed(f)).toEqual([["otto"], ["otto"], ["otto"]]);
      } finally {
        await second.close();
      }
    } finally {
      await rm(f.root, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it.each([
    { mode: "all" },
    { mode: "custom", skills: [] },
    { mode: "custom", skills: ["otto"] },
  ] satisfies AgentSkillSelection[])(
    "preserves prelaunch daemon selection %j over legacy import",
    async (selection) => {
      const f = await fixture(selection);
      try {
        const running = await start(f);
        try {
          expect(
            await running.client.importLegacyAgentSkillsSelection({
              mode: "custom",
              skills: ["otto-advisor"],
            }),
          ).toMatchObject({ imported: false, selection });
          expect((await running.client.getAgentSkillsStatus()).selection).toEqual(selection);
          expect(loadPersistedConfig(f.home).agents?.skills?.selection).toEqual(selection);
          expect(await installed(f)).toEqual(
            selection.mode === "all"
              ? [
                  ["otto", "otto-advisor"],
                  ["otto", "otto-advisor"],
                  ["otto", "otto-advisor"],
                ]
              : [["otto"], ["otto"], ["otto"]],
          );
        } finally {
          await running.close();
        }
      } finally {
        await rm(f.root, { recursive: true, force: true, maxRetries: 3 });
      }
    },
  );

  it("stops promptly before a renderer has resolved its selection", async () => {
    const f = await fixture();
    try {
      const running = await start(f);
      expect(running.resolutions()).toBe(0);
      await running.close();
      expect(loadPersistedConfig(f.home).agents?.skills?.selection).toBeUndefined();
      expect(await installed(f)).toEqual([["otto"], ["otto"], ["otto"]]);
    } finally {
      await rm(f.root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
