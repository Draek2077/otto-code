import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPersistedConfig,
  readPersistedConfig,
  savePersistedConfig,
} from "../persisted-config.js";
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
  it("preserves prototype-named JSON settings as data", () => {
    const home = homeWithConfig(JSON.parse('{"version":1,"__proto__":{"legacySetting":true}}'));
    loadPersistedConfig(home);
    expect(readJson(path.join(home, OTTO_CONFIG_FILENAME))).toEqual(
      JSON.parse('{"__proto__":{"legacySetting":true}}'),
    );
    expect(Object.hasOwn(Object.prototype, "legacySetting")).toBe(false);
  });
  it("normalizes a read without rewriting or initializing the home", () => {
    const home = homeWithConfig(otto09Config);
    expect(readPersistedConfig(home).daemon?.listen).toBe("127.0.0.1:6788");
    expect(readJson(path.join(home, "config.json"))).toEqual(otto09Config);
    expect(existsSync(path.join(home, "otto-0.9-backup"))).toBe(false);
    expect(existsSync(path.join(home, OTTO_CONFIG_FILENAME))).toBe(false);
  });

  it("preserves Otto settings when a config save happens before startup", () => {
    const home = homeWithConfig(otto09Config);
    const config = readPersistedConfig(home);
    savePersistedConfig(home, {
      ...config,
      daemon: { ...config.daemon, listen: "127.0.0.1:6999" },
    });
    expect(readJson(path.join(home, OTTO_CONFIG_BACKUP_FILENAME))).toEqual(otto09Config);
    expect(readJson(path.join(home, OTTO_CONFIG_FILENAME))).toHaveProperty("gitHosting");
    expect(readPersistedConfig(home).daemon?.listen).toBe("127.0.0.1:6999");
  });

  it("moves Otto's daemon and public relay endpoints to Paseo with TLS", () => {
    const original = {
      version: 1,
      daemon: {
        relay: {
          enabled: false,
          endpoint: "relay.otto-code.me:443",
          publicEndpoint: "relay.otto-code.me:443",
          useTls: false,
          publicUseTls: false,
        },
      },
    };
    const home = homeWithConfig(original);
    const config = loadPersistedConfig(home);
    expect(config.daemon?.relay).toEqual({
      enabled: false,
      endpoint: "relay.paseo.sh:443",
      publicEndpoint: "relay.paseo.sh:443",
      useTls: true,
      publicUseTls: true,
    });
    expect(readJson(path.join(home, "config.json"))).toEqual(config);
    expect(readJson(path.join(home, OTTO_CONFIG_BACKUP_FILENAME))).toEqual(original);
  });

  it("preserves self-hosted relays and their TLS settings", () => {
    const original = {
      version: 1,
      daemon: { relay: { endpoint: "my-relay.example:8080", useTls: false } },
    };
    const home = homeWithConfig(original);
    expect(loadPersistedConfig(home)).toEqual(original);
    expect(existsSync(path.join(home, OTTO_CONFIG_BACKUP_FILENAME))).toBe(false);
  });

  it("enables public TLS when the migrated endpoint is also the implicit public endpoint", () => {
    const home = homeWithConfig({
      version: 1,
      daemon: { relay: { endpoint: "relay.otto-code.me", publicUseTls: false } },
    });
    expect(loadPersistedConfig(home).daemon?.relay).toEqual({
      endpoint: "relay.paseo.sh:443",
      useTls: true,
      publicUseTls: true,
    });
  });

  it("keeps a custom public endpoint when migrating the daemon's old Otto endpoint", () => {
    const home = homeWithConfig({
      version: 1,
      daemon: {
        relay: {
          endpoint: "relay.otto-code.me:443",
          publicEndpoint: "custom.example:8080",
          publicUseTls: false,
        },
      },
    });
    expect(loadPersistedConfig(home).daemon?.relay).toEqual({
      endpoint: "relay.paseo.sh:443",
      useTls: true,
      publicEndpoint: "custom.example:8080",
      publicUseTls: false,
    });
  });

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
  it("preserves free-form API recognition and speech IDs and keys without a migration rewrite", () => {
    const original = {
      version: 1,
      features: {
        dictation: { stt: { provider: "openai", model: "CustomWhisper" } },
        voiceMode: {
          stt: { provider: "openai", model: "CustomWhisper" },
          tts: { provider: "openai", model: "FixtureModel", voice: "FixtureVoice", speed: 0.75 },
        },
      },
      providers: { openai: { apiKey: "preserved-fixture-key" } },
    };
    const home = homeWithConfig(original);
    const before = readFileSync(path.join(home, "config.json"));
    expect(loadPersistedConfig(home)).toEqual(original);
    expect(readFileSync(path.join(home, "config.json"))).toEqual(before);
    expect(existsSync(path.join(home, OTTO_CONFIG_FILENAME))).toBe(false);
  });
  it("recovers only missing API IDs proven by both preserved data and the original API config", () => {
    const current = {
      version: 1,
      features: {
        dictation: { stt: { provider: "openai" } },
        voiceMode: {
          stt: { provider: "openai" },
          tts: { provider: "openai", voice: "FixtureVoice" },
        },
      },
    };
    const home = homeWithConfig(current);
    const original = {
      version: 1,
      features: {
        dictation: { stt: { provider: "openai", model: "CustomWhisper" } },
        voiceMode: {
          stt: { provider: "openai", model: "CustomWhisper" },
          tts: { provider: "openai", model: "FixtureModel", voice: "FixtureVoice" },
        },
      },
    };
    const preserved = {
      features: {
        dictation: { stt: { model: "CustomWhisper" } },
        voiceMode: { stt: { model: "CustomWhisper" }, tts: { model: "FixtureModel" } },
      },
    };
    const backupFile = path.join(home, OTTO_CONFIG_BACKUP_FILENAME);
    const preservedFile = path.join(home, OTTO_CONFIG_FILENAME);
    writeFileSync(backupFile, JSON.stringify(original));
    writeFileSync(preservedFile, JSON.stringify(preserved));
    const backup = readFileSync(backupFile);
    const dormant = readFileSync(preservedFile);
    expect(readPersistedConfig(home)).toEqual(original);
    expect(readJson(path.join(home, "config.json"))).toEqual(current);
    expect(loadPersistedConfig(home)).toEqual(original);
    expect(readJson(path.join(home, "config.json"))).toEqual(original);
    expect(readFileSync(backupFile)).toEqual(backup);
    expect(readFileSync(preservedFile)).toEqual(dormant);
    expect(loadPersistedConfig(home)).toEqual(original);
  });
  it.each(["local-provider", "mismatched-model", "malformed-backup", "explicit-current"])(
    "refuses ambiguous preserved API recovery: %s",
    (scenario) => {
      const tts = {
        provider: "openai",
        ...(scenario === "explicit-current" ? { model: "CurrentModel" } : {}),
      };
      const current = { version: 1, features: { voiceMode: { tts } } };
      const home = homeWithConfig(current);
      const original = {
        features: {
          voiceMode: {
            tts: {
              provider: scenario === "local-provider" ? "local" : "openai",
              model: "PriorModel",
            },
          },
        },
      };
      writeFileSync(
        path.join(home, OTTO_CONFIG_BACKUP_FILENAME),
        scenario === "malformed-backup" ? "broken" : JSON.stringify(original),
      );
      writeFileSync(
        path.join(home, OTTO_CONFIG_FILENAME),
        JSON.stringify({
          features: {
            voiceMode: {
              tts: { model: scenario === "mismatched-model" ? "DifferentModel" : "PriorModel" },
            },
          },
        }),
      );
      const before = readFileSync(path.join(home, "config.json"));
      expect(loadPersistedConfig(home)).toEqual(current);
      expect(readFileSync(path.join(home, "config.json"))).toEqual(before);
    },
  );
  it("keeps an unsupported future TTS model and its speaker dormant", () => {
    const home = homeWithConfig({
      version: 1,
      features: {
        voiceMode: {
          enabled: true,
          tts: { provider: "local", model: "kokoro-future-v9", speakerId: 9, speed: 1 },
        },
      },
    });
    const config = loadPersistedConfig(home);
    expect(config.features?.voiceMode?.tts).toEqual({ provider: "local", speed: 1 });
    expect(readJson(path.join(home, OTTO_CONFIG_FILENAME))).toEqual({
      features: { voiceMode: { tts: { model: "kokoro-future-v9", speakerId: 9 } } },
    });
  });
  it.each(["kokoro-multi-lang-v1_0", "kokoro-int8-multi-lang-v1_0"])(
    "keeps restored %s and its speaker in the active config",
    (model) => {
      const tts = { provider: "local", model, speakerId: 9, speed: 1.25 };
      const home = homeWithConfig({ version: 1, features: { voiceMode: { tts } } });
      expect(loadPersistedConfig(home).features?.voiceMode?.tts).toEqual(tts);
    },
  );
});
