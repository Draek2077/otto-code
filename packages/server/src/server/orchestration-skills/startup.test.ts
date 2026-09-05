import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSkillSelection } from "@otto-code/protocol/messages";
import { DaemonConfigStore } from "../daemon-config-store";
import { loadPersistedConfig } from "../persisted-config";
import { createStartupOrchestrationSkills, SkillMaintenanceStoppedError } from "./startup";
import type { SkillTargets } from "./internal/operations";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function harness(selection?: AgentSkillSelection, desktopManaged = true) {
  const scratch = fileURLToPath(new URL("../../../../../.tmp/agent-02/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "skills-startup-"));
  roots.push(root);
  const targets: SkillTargets = {
    sourceDir: path.join(root, "bundle"),
    agentsDir: path.join(root, "home", ".agents", "skills"),
    claudeDir: path.join(root, "home", ".claude", "skills"),
    codexDir: path.join(root, "home", ".codex", "skills"),
  };
  for (const name of ["otto", "otto-advisor"]) {
    await mkdir(path.join(targets.sourceDir, name), { recursive: true });
    await writeFile(path.join(targets.sourceDir, name, "SKILL.md"), `${name}-new`);
  }
  for (const directory of [targets.agentsDir, targets.claudeDir, targets.codexDir]) {
    await mkdir(path.join(directory, "otto"), { recursive: true });
    await writeFile(path.join(directory, "otto", "SKILL.md"), "old");
  }
  const config = new DaemonConfigStore(root, {
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  });
  if (selection) config.setAgentSkillSelection(selection);
  let resolutions = 0;
  const skills = createStartupOrchestrationSkills(config, {
    desktopManaged,
    logger: pino({ level: "silent" }),
    resolveTargets() {
      resolutions += 1;
      return targets;
    },
  });
  return { root, targets, config, skills, resolutions: () => resolutions };
}

async function installed(targets: SkillTargets) {
  return Promise.all(
    [targets.agentsDir, targets.claudeDir, targets.codexDir].map(async (directory) =>
      (await readdir(directory)).sort(),
    ),
  );
}

describe("desktop skill maintenance barrier", () => {
  it("settles pending maintenance on shutdown without touching skills", async () => {
    const h = await harness();
    const maintenance = h.skills.autoUpdate();
    const stopped = expect(maintenance).rejects.toBeInstanceOf(SkillMaintenanceStoppedError);
    await h.skills.dispose();
    await stopped;
    h.config.setAgentSkillSelection({ mode: "all" });
    expect(h.resolutions()).toBe(0);
    expect(await installed(h.targets)).toEqual([["otto"], ["otto"], ["otto"]]);
  });
  it("holds every automatic caller outside the import queue until durable selection", async () => {
    const h = await harness();
    const first = h.skills.autoUpdate();
    expect(h.skills.autoUpdate()).toBe(first);
    const maintenance = first;
    await Promise.resolve();
    expect(h.resolutions()).toBe(0);
    expect(await installed(h.targets)).toEqual([["otto"], ["otto"], ["otto"]]);
    expect(
      await h.skills.importLegacySelectionIfUnset({ mode: "custom", skills: ["otto"] }),
    ).toEqual({ imported: true, selection: { mode: "custom", skills: ["otto"] } });
    await maintenance;
    expect(loadPersistedConfig(h.root).agents?.skills?.selection).toEqual({
      mode: "custom",
      skills: ["otto"],
    });
    expect(await readFile(path.join(h.targets.agentsDir, "otto", "SKILL.md"), "utf8")).toBe(
      "otto-new",
    );
    expect(await installed(h.targets)).toEqual([["otto"], ["otto"], ["otto"]]);
  });

  it("retains the barrier after persistence failure and accepts a durable retry", async () => {
    const h = await harness();
    await rm(path.join(h.root, "config.json"));
    await mkdir(path.join(h.root, "config.json"));
    const maintenance = h.skills.autoUpdate();
    await expect(
      h.skills.importLegacySelectionIfUnset({ mode: "custom", skills: ["otto"] }),
    ).rejects.toThrow();
    expect(h.config.get().skills?.selection).toBeUndefined();
    expect(h.resolutions()).toBe(0);
    await rm(path.join(h.root, "config.json"), { recursive: true });
    await h.skills.importLegacySelectionIfUnset({ mode: "custom", skills: ["otto"] });
    await maintenance;
    expect(await installed(h.targets)).toEqual([["otto"], ["otto"], ["otto"]]);
  });

  it.each([
    { mode: "all" },
    { mode: "custom", skills: ["otto"] },
    { mode: "custom", skills: [] },
  ] satisfies AgentSkillSelection[])("preserves explicit selection %j", async (selection) => {
    const h = await harness(selection);
    await h.skills.autoUpdate();
    expect(
      await h.skills.importLegacySelectionIfUnset({ mode: "custom", skills: ["otto-advisor"] }),
    ).toEqual({ imported: false, selection });
    expect(loadPersistedConfig(h.root).agents?.skills?.selection).toEqual(selection);
    expect(await installed(h.targets)).toEqual(
      selection.mode === "all"
        ? [
            ["otto", "otto-advisor"],
            ["otto", "otto-advisor"],
            ["otto", "otto-advisor"],
          ]
        : [["otto"], ["otto"], ["otto"]],
    );
  });

  it("keeps unmanaged default-all maintenance immediate", async () => {
    const h = await harness(undefined, false);
    await h.skills.autoUpdate();
    expect(await installed(h.targets)).toEqual([
      ["otto", "otto-advisor"],
      ["otto", "otto-advisor"],
      ["otto", "otto-advisor"],
    ]);
    expect(loadPersistedConfig(h.root).agents?.skills?.selection).toBeUndefined();
  });

  it("allows an explicit save to persist and release waiting automatic maintenance", async () => {
    const h = await harness();
    const maintenance = h.skills.autoUpdate();
    const saved = await h.skills.saveSelection({ mode: "custom", skills: ["otto"] });
    expect(saved.confirmationRequired).toBe(null);
    await maintenance;
    expect(await installed(h.targets)).toEqual([["otto"], ["otto"], ["otto"]]);
  });

  it("does not turn an automatic maintenance failure into an import failure", async () => {
    const h = await harness();
    await rm(h.targets.agentsDir, { recursive: true });
    await writeFile(h.targets.agentsDir, "not a directory");
    const maintenance = h.skills.autoUpdate();
    const failed = expect(maintenance).rejects.toThrow();
    await expect(
      h.skills.importLegacySelectionIfUnset({ mode: "custom", skills: ["otto"] }),
    ).resolves.toEqual({ imported: true, selection: { mode: "custom", skills: ["otto"] } });
    await failed;
    expect(loadPersistedConfig(h.root).agents?.skills?.selection).toEqual({
      mode: "custom",
      skills: ["otto"],
    });
    await rm(h.targets.agentsDir);
    await h.skills.autoUpdate();
    expect(await installed(h.targets)).toEqual([["otto"], ["otto"], ["otto"]]);
  });
});
