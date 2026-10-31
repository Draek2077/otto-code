import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pino from "pino";
import {
  savePersistedConfig,
  loadPersistedConfig,
  type PersistedConfig,
} from "../../persisted-config.js";
import { SpeechHost } from "./host.js";
import { ManagedSpeechRuntime } from "./managed-runtime.js";
import { patchSpeechSettings, speechSettings, speechCredential } from "./settings.js";
import { readSpeech, saveSpeech, SpeechSnapshotSchema } from "@getpaseo/plugin/otto/speech";

const homes: string[] = [];
const runtimes: ManagedSpeechRuntime[] = [];
const logger = pino({ level: "silent" });
const keep = { stt: { kind: "keep" }, tts: { kind: "keep" } } as const;
function fixture(config: PersistedConfig = {}, env: NodeJS.ProcessEnv = {}) {
  const root = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
  mkdirSync(root, { recursive: true });
  const home = mkdtempSync(path.join(root, "speech-settings-"));
  homes.push(home);
  savePersistedConfig(home, config);
  const disabled = { provider: "local", explicit: true, enabled: false } as const;
  const runtime = new ManagedSpeechRuntime(
    {
      speech: {
        providers: {
          dictationStt: disabled,
          voiceStt: disabled,
          voiceTts: disabled,
          voiceTurnDetection: disabled,
        },
      },
    },
    logger,
  );
  runtimes.push(runtime);
  const host = new SpeechHost({ hostId: "host", home, env, runtime, logger });
  return { home, host };
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("host speech settings", () => {
  it("round-trips an enabled custom API selection through real host saves and subsequent migration reads", async () => {
    const { host, home } = fixture({
      features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
    });
    const initial = await host.read();
    const settings = structuredClone(initial.settings);
    settings.voice = {
      enabled: true,
      turnDetection: "openai",
      stt: { provider: "openai", model: "CustomWhisper", language: "en" },
      tts: { provider: "openai", model: "FixtureModel", voice: "FixtureVoice", speed: 0.75 },
    };
    const saved = SpeechSnapshotSchema.parse(
      await host.invoke(
        saveSpeech.name,
        {
          hostId: "host",
          expectedRevision: initial.revision,
          settings,
          credentials: {
            stt: { kind: "replace", value: "stt-fixture" },
            tts: { kind: "replace", value: "tts-fixture" },
          },
        },
        "client",
      ),
    );
    expect(saved.settings.voice).toEqual(settings.voice);
    expect((await host.read()).settings.voice).toEqual(settings.voice);
    expect(loadPersistedConfig(home).features?.voiceMode?.tts?.model).toBe("FixtureModel");
    expect(JSON.stringify(saved)).not.toContain("tts-fixture");
  });
  it("ignores blank endpoint environment placeholders exactly like the existing provider resolver", () => {
    const { home } = fixture();
    const settings = speechSettings(
      home,
      {
        OPENAI_STT_BASE_URL: " ",
        OPENAI_TTS_BASE_URL: "",
        OPENAI_BASE_URL: "https://fixture.example/v1",
      },
      loadPersistedConfig(home),
    );
    expect(settings.openai).toEqual({
      sttBaseUrl: "https://fixture.example/v1",
      ttsBaseUrl: "https://fixture.example/v1",
    });
  });
  it("recomputes environment ownership when changing from a cloud model to local speech", async () => {
    const { host, home } = fixture(
      {
        providers: { openai: { apiKey: "isolated-fixture" } },
        features: {
          dictation: { enabled: false },
          voiceMode: {
            enabled: true,
            stt: { provider: "openai" },
            turnDetection: { provider: "openai" },
            tts: { provider: "openai", model: "SavedCloudModel" },
          },
        },
      },
      { TTS_MODEL: "EnvironmentModel" },
    );
    const initial = await host.read();
    expect(initial.settings.voice.tts.model).toBe("EnvironmentModel");
    expect(initial.overrides).toContain("features.voiceMode.tts.model");
    const settings = structuredClone(initial.settings);
    settings.voice.tts = { provider: "local", model: "kokoro-en-v0_19", voice: "af", speed: 1 };
    const saved = SpeechSnapshotSchema.parse(
      await host.invoke(
        saveSpeech.name,
        { hostId: "host", expectedRevision: initial.revision, settings, credentials: keep },
        "client",
      ),
    );
    expect(saved.settings.voice.tts.provider).toBe("local");
    expect(saved.settings.voice.tts.model).toBe("kokoro-en-v0_19");
    expect(saved.overrides).not.toContain("features.voiceMode.tts.model");
    expect(loadPersistedConfig(home).features?.voiceMode?.tts?.model).toBe("kokoro-en-v0_19");
  });
  it("round-trips the public contract without exposing a saved endpoint or shared key", async () => {
    const { host } = fixture({
      providers: {
        openai: { apiKey: "shared-fixture-secret", tts: { apiKey: "tts-fixture-secret" } },
      },
    });
    const snapshot = SpeechSnapshotSchema.parse(
      await host.invoke(readSpeech.name, { hostId: "host" }, "client"),
    );
    expect(snapshot.credentials).toEqual({
      stt: { stored: false, effectiveSource: "shared" },
      tts: { stored: true, effectiveSource: "stored" },
    });
    expect(JSON.stringify(snapshot)).not.toContain("fixture-secret");
    expect(snapshot.choices.ttsModels.map((entry) => entry.voices.length)).toEqual([53, 53, 11]);
  });
  it("keeps shared credentials, unrelated settings, thresholds and inactive provider fields", async () => {
    const { home } = fixture({
      daemon: { appendSystemPrompt: "Retain this prompt" },
      providers: {
        openai: { apiKey: "shared", stt: { apiKey: "old-stt" }, tts: { apiKey: "old-tts" } },
      },
      features: {
        dictation: { stt: { confidenceThreshold: 0.25 } },
        voiceMode: {
          llm: { provider: "custom", model: "custom-model" },
          tts: { voice: "CloudCaseSensitive" },
        },
      },
    });
    const persisted = loadPersistedConfig(home);
    const previous = speechSettings(home, {}, persisted);
    const next = structuredClone(previous);
    next.voice.tts.speed = 0.75;
    const result = patchSpeechSettings({
      persisted,
      previous,
      next,
      credentials: { stt: { kind: "remove" }, tts: { kind: "replace", value: "new-tts" } },
      overrides: [],
    });
    expect(result.providers?.openai).toEqual({
      apiKey: "shared",
      stt: {},
      tts: { apiKey: "new-tts" },
    });
    expect(result.features?.dictation?.stt?.confidenceThreshold).toBe(0.25);
    expect(result.features?.voiceMode?.llm).toEqual({ provider: "custom", model: "custom-model" });
    expect(result.features?.voiceMode?.tts).toEqual({ voice: "CloudCaseSensitive", speed: 0.75 });
    expect(result.daemon?.appendSystemPrompt).toBe("Retain this prompt");
    expect(speechCredential(result, {}, "stt")).toEqual({
      stored: false,
      effectiveSource: "shared",
    });
  });
  it("refuses a stale form without changing either credential or config bytes", async () => {
    const { host, home } = fixture();
    const opened = await host.read();
    savePersistedConfig(home, { daemon: { appendSystemPrompt: "peer edit" } });
    const file = path.join(home, "config.json");
    const before = readFileSync(file, "utf8");
    expect(() =>
      host.invoke(
        saveSpeech.name,
        {
          hostId: "host",
          expectedRevision: opened.revision,
          settings: opened.settings,
          credentials: keep,
        },
        "client",
      ),
    ).toThrow("Host settings changed");
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("saves a local model and exact voice index through the existing config schema", async () => {
    const { host, home } = fixture({
      features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
    });
    const opened = await host.read();
    const next = structuredClone(opened.settings);
    next.voice.tts = {
      provider: "local",
      model: "kokoro-int8-multi-lang-v1_0",
      voice: "zm_yunyang",
      speed: 0.75,
    };
    const saved = SpeechSnapshotSchema.parse(
      await host.invoke(
        saveSpeech.name,
        { hostId: "host", expectedRevision: opened.revision, settings: next, credentials: keep },
        "client",
      ),
    );
    expect(saved.settings.voice.tts).toEqual(next.voice.tts);
    expect(loadPersistedConfig(home).features?.voiceMode?.tts).toMatchObject({
      model: "kokoro-int8-multi-lang-v1_0",
      speakerId: 52,
      speed: 0.75,
    });
    expect(saved.settings.voice.enabled).toBe(false);
  });
  it("validates voice and endpoint identity without rewriting a bad request", () => {
    const { home } = fixture();
    const persisted = loadPersistedConfig(home);
    const previous = speechSettings(home, {}, persisted);
    const invalid = structuredClone(previous);
    invalid.voice.tts.voice = "not-a-local-speaker";
    expect(() =>
      patchSpeechSettings({ persisted, previous, next: invalid, credentials: keep, overrides: [] }),
    ).toThrow("selected voice");
    const url = structuredClone(previous);
    url.openai.ttsBaseUrl = "https://user:secret@example.test/v1";
    expect(() =>
      patchSpeechSettings({ persisted, previous, next: url, credentials: keep, overrides: [] }),
    ).toThrow("without credentials");
  });
  it("keeps environment-owned model settings off disk and rejects attempts to change them", () => {
    const { home } = fixture({ features: { voiceMode: { tts: { provider: "openai" } } } });
    const persisted = loadPersistedConfig(home);
    const previous = speechSettings(
      home,
      { TTS_MODEL: "EnvironmentModel", OPENAI_API_KEY: "fixture" },
      persisted,
    );
    const next = structuredClone(previous);
    next.dictation.enabled = false;
    const result = patchSpeechSettings({
      persisted,
      previous,
      next,
      credentials: keep,
      overrides: ["features.voiceMode.tts.model"],
    });
    expect(result.features?.voiceMode?.tts?.model).toBeUndefined();
    next.voice.tts.model = "OtherModel";
    expect(() =>
      patchSpeechSettings({
        persisted,
        previous,
        next,
        credentials: keep,
        overrides: ["features.voiceMode.tts.model"],
      }),
    ).toThrow("controlled by the host environment");
  });
});
