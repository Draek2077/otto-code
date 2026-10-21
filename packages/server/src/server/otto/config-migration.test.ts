import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPersistedConfig } from "../persisted-config.js";
import { OTTO_CONFIG_BACKUP_FILENAME, OTTO_CONFIG_FILENAME } from "./config-migration.js";

const homes: string[] = [];

function homeWithConfig(config: unknown): string {
  const home = mkdtempSync(path.join(tmpdir(), "otto-config-migration-"));
  homes.push(home);
  writeFileSync(path.join(home, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  return home;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

// The shape Otto 0.9 writes: Paseo keys mixed with Otto-only daemon settings,
// Otto-only agent settings, Otto providers, and an Otto-only root section.
const otto09Config = {
  version: 1,
  daemon: {
    listen: "127.0.0.1:6788",
    gitFetch: { mode: "auto" },
    terminalTitleMode: "process",
  },
  agents: {
    agentTeams: [{ id: "team-1" }],
    providers: {
      "openai-compatible": { extends: "openai-compatible", label: "LM Studio" },
    },
  },
  gitHosting: { github: { enabled: true } },
};

describe("Otto 0.9 config migration", () => {
  it("loads a 0.9 config and keeps the Paseo settings", () => {
    const home = homeWithConfig(otto09Config);
    const config = loadPersistedConfig(home);
    expect(config.daemon?.listen).toBe("127.0.0.1:6788");
  });

  it("moves every Otto-only value into otto-config.json", () => {
    const home = homeWithConfig(otto09Config);
    loadPersistedConfig(home);
    expect(readJson(path.join(home, OTTO_CONFIG_FILENAME))).toEqual({
      daemon: { gitFetch: { mode: "auto" }, terminalTitleMode: "process" },
      agents: {
        agentTeams: [{ id: "team-1" }],
        providers: {
          "openai-compatible": { extends: "openai-compatible", label: "LM Studio" },
        },
      },
      gitHosting: { github: { enabled: true } },
    });
  });

  it("keeps the original file as a backup and rewrites config.json once", () => {
    const home = homeWithConfig(otto09Config);
    loadPersistedConfig(home);
    expect(readJson(path.join(home, OTTO_CONFIG_BACKUP_FILENAME))).toEqual(otto09Config);
    const rewritten = readJson(path.join(home, "config.json"));
    expect(rewritten).not.toHaveProperty("gitHosting");
    expect(rewritten.daemon).toEqual({ listen: "127.0.0.1:6788" });

    loadPersistedConfig(home);
    expect(readJson(path.join(home, OTTO_CONFIG_BACKUP_FILENAME))).toEqual(otto09Config);
  });

  it("leaves a config Paseo already accepts untouched", () => {
    const home = homeWithConfig({ version: 1, daemon: { listen: "127.0.0.1:6788" } });
    loadPersistedConfig(home);
    expect(existsSync(path.join(home, OTTO_CONFIG_FILENAME))).toBe(false);
    expect(existsSync(path.join(home, OTTO_CONFIG_BACKUP_FILENAME))).toBe(false);
  });

  it("still reports a genuine Paseo config error", () => {
    const home = homeWithConfig({ version: 1, daemon: { listen: 42 } });
    expect(() => loadPersistedConfig(home)).toThrow(/Invalid config/);
  });
});

describe("Otto 0.9 speech model selections", () => {
  it("moves an Otto-only TTS model and its speaker out so Paseo's default applies", () => {
    const home = homeWithConfig({
      version: 1,
      features: {
        voiceMode: {
          enabled: true,
          tts: { provider: "local", model: "kokoro-multi-lang-v1_0", speakerId: 9, speed: 1 },
        },
      },
    });
    const config = loadPersistedConfig(home);
    expect(config.features?.voiceMode?.tts).toEqual({ provider: "local", speed: 1 });
    expect(readJson(path.join(home, OTTO_CONFIG_FILENAME))).toEqual({
      features: { voiceMode: { tts: { model: "kokoro-multi-lang-v1_0", speakerId: 9 } } },
    });
  });
});
