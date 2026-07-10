import { describe, expect, it, vi, beforeEach } from "vitest";
import pino from "pino";

const generate = vi.fn();
const free = vi.fn();
const constructedConfigs: unknown[] = [];

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock("./sherpa-onnx-node-loader.js", () => ({
  loadSherpaOnnxNode: () => ({
    OfflineTts: class {
      public readonly sampleRate = 24000;

      generate = generate;
      free = free;

      constructor(config: unknown) {
        constructedConfigs.push(config);
      }
    },
  }),
}));

describe("SherpaOnnxTTS", () => {
  beforeEach(() => {
    generate.mockReset();
    free.mockReset();
    constructedConfigs.length = 0;
  });

  it("disables external buffers when calling sherpa generate", async () => {
    generate.mockReturnValue({
      samples: Float32Array.from([0, 0.5, -0.5, 0.25]),
      sampleRate: 24000,
    });

    const { SherpaOnnxTTS } = await import("./sherpa-tts.js");
    const tts = new SherpaOnnxTTS(
      {
        preset: "kokoro-en-v0_19",
        modelDir: "/tmp/fake-model",
      },
      pino({ level: "silent" }),
    );

    const result = await tts.synthesizeSpeech("hello");

    expect(generate).toHaveBeenCalledWith({
      text: "hello",
      sid: 0,
      speed: 1,
      enableExternalBuffer: false,
    });
    expect(result.format).toBe("pcm;rate=24000");
  });

  it("configures kokoro v1.0 with lexicons and the af_heart default speaker", async () => {
    generate.mockReturnValue({
      samples: Float32Array.from([0, 0.5]),
      sampleRate: 24000,
    });

    const { SherpaOnnxTTS } = await import("./sherpa-tts.js");
    const tts = new SherpaOnnxTTS(
      {
        preset: "kokoro-multi-lang-v1_0",
        modelDir: "/tmp/kokoro-v1",
      },
      pino({ level: "silent" }),
    );

    expect(constructedConfigs).toHaveLength(1);
    expect(constructedConfigs[0]).toMatchObject({
      model: {
        kokoro: {
          model: "/tmp/kokoro-v1/model.onnx",
          voices: "/tmp/kokoro-v1/voices.bin",
          tokens: "/tmp/kokoro-v1/tokens.txt",
          dataDir: "/tmp/kokoro-v1/espeak-ng-data",
          lexicon: "/tmp/kokoro-v1/lexicon-us-en.txt,/tmp/kokoro-v1/lexicon-zh.txt",
        },
      },
    });

    await tts.synthesizeSpeech("hello");
    expect(generate).toHaveBeenCalledWith({
      text: "hello",
      sid: 3,
      speed: 1,
      enableExternalBuffer: false,
    });
  });

  it("uses the int8 model file for the int8 v1.0 preset", async () => {
    const { SherpaOnnxTTS } = await import("./sherpa-tts.js");
    const tts = new SherpaOnnxTTS(
      {
        preset: "kokoro-int8-multi-lang-v1_0",
        modelDir: "/tmp/kokoro-v1-int8",
      },
      pino({ level: "silent" }),
    );

    expect(tts).toBeDefined();
    expect(constructedConfigs).toHaveLength(1);
    expect(constructedConfigs[0]).toMatchObject({
      model: {
        kokoro: {
          model: "/tmp/kokoro-v1-int8/model.int8.onnx",
        },
      },
    });
  });
});
