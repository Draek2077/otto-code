import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { SpeechReadinessSnapshot, SpeechService } from "../../speech/speech-runtime.js";
import { ManagedSpeechRuntime, type SpeechRuntimeConfiguration } from "./managed-runtime.js";

const logger = pino({ level: "silent" });
const ready = {
  enabled: true,
  available: true,
  reasonCode: "ready",
  message: "Ready",
  retryable: false,
  missingModelIds: [],
} as const;
function readiness(): SpeechReadinessSnapshot {
  const state = { ...ready, missingModelIds: [] };
  return {
    generatedAt: "fixture",
    requiredLocalModelIds: [],
    missingLocalModelIds: [],
    download: { inProgress: false, error: null },
    realtimeVoice: state,
    dictation: state,
    voiceFeature: state,
  };
}
class Session extends EventEmitter {
  requiredSampleRate = 16000;
  closes = 0;
  async connect() {}
  appendPcm16() {}
  commit() {}
  clear() {}
  flush() {}
  reset() {}
  close() {
    this.closes++;
  }
}
function fixture() {
  const services: {
    stops: number;
    starts: number;
    configuration: SpeechRuntimeConfiguration;
    stream: Readable;
    session: Session;
  }[] = [];
  const runtime = new ManagedSpeechRuntime({}, logger, (configuration): SpeechService => {
    const state = {
      stops: 0,
      starts: 0,
      configuration,
      stream: new Readable({ read() {} }),
      session: new Session(),
    };
    services.push(state);
    const provider = { id: "local", createSession: () => state.session };
    return {
      ready: Promise.resolve(),
      getReadiness: readiness,
      resolveStt: () => provider,
      resolveDictationStt: () => provider,
      resolveTurnDetection: () => provider,
      resolveTts: () => ({
        synthesizeSpeech: async () => ({ stream: state.stream, format: "pcm;rate=24000" }),
      }),
      resolveSttLanguage: () => "en",
      resolveDictationSttLanguage: () => "en",
      onReadinessChange: () => () => {},
      start() {
        state.starts++;
      },
      async stop() {
        state.stops++;
      },
    };
  });
  return { runtime, services };
}
async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("speech configuration lifetime", () => {
  it("passes disabled intent through the production Paseo service factory", async () => {
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
    expect(runtime.getReadiness().dictation.enabled).toBe(false);
    expect(runtime.getReadiness().realtimeVoice.enabled).toBe(false);
    expect(runtime.resolveTts()).toBeNull();
    await runtime.stop();
  });
  it("waits for the active recording and coalesces later settings", async () => {
    const { runtime, services } = fixture();
    runtime.start();
    const session = runtime.resolveStt()!.createSession({ logger });
    await session.connect();
    await runtime.update({ openai: { tts: { model: "first" } } });
    await runtime.update({ openai: { tts: { model: "latest" } } });
    expect(runtime.changeState().pending).toBe(true);
    expect(services).toHaveLength(1);
    expect(services[0].stops).toBe(0);
    session.close();
    session.close();
    await settle();
    expect(services).toHaveLength(2);
    expect(services[0].stops).toBe(1);
    expect(services[0].session.closes).toBe(1);
    expect(services[1].configuration.openai?.tts?.model).toBe("latest");
    expect(services[1].starts).toBe(1);
    await runtime.stop();
  });
  it("keeps a model alive until its returned audio stream drains", async () => {
    const { runtime, services } = fixture();
    const audio = await runtime.resolveTts()!.synthesizeSpeech("speech");
    await runtime.update({});
    expect(services[0].stops).toBe(0);
    services[0].stream.push(Buffer.from([1, 2]));
    services[0].stream.push(null);
    for await (const chunk of audio.stream) expect(Buffer.from(chunk)).toEqual(Buffer.from([1, 2]));
    await settle();
    expect(services[0].stops).toBe(1);
    expect(services).toHaveLength(2);
    await runtime.stop();
  });
  it("also leases turn detection rather than interrupting an active microphone", async () => {
    const { runtime, services } = fixture();
    const session = runtime.resolveTurnDetection()!.createSession({ logger });
    await runtime.update({});
    expect(services).toHaveLength(1);
    session.close();
    await settle();
    expect(services).toHaveLength(2);
    await runtime.stop();
  });
  it("refuses a stale captured provider after configuration replacement", async () => {
    const { runtime } = fixture();
    const stale = runtime.resolveTts()!;
    await runtime.update({});
    await expect(stale.synthesizeSpeech("old")).rejects.toThrow("settings changed");
    await runtime.stop();
  });
  it("does not start an unused replacement after shutdown", async () => {
    const { runtime, services } = fixture();
    const session = runtime.resolveDictationStt()!.createSession({ logger });
    await runtime.update({});
    await runtime.stop();
    session.close();
    await settle();
    expect(services).toHaveLength(1);
    expect(services[0].stops).toBe(1);
    expect(runtime.resolveTts()).toBeNull();
  });
});
