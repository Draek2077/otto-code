import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { SherpaOnnxTTS } from "../../speech/providers/local/sherpa/sherpa-tts.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const scratch = path.resolve("../../.tmp/speech-fixtures");
  await mkdir(scratch, { recursive: true });
  const modelDir = await mkdtemp(path.join(scratch, "native-tts-"));
  roots.push(modelDir);
  for (const file of [
    "model.int8.onnx",
    "voices.bin",
    "tokens.txt",
    "lexicon-us-en.txt",
    "lexicon-zh.txt",
  ])
    await writeFile(path.join(modelDir, file), "fixture");
  await mkdir(path.join(modelDir, "espeak-ng-data"));
  return modelDir;
}

it("uses the quantized model and required lexicons while serializing per-request voices", async () => {
  const modelDir = await fixture();
  let configuration: unknown;
  let nativeHandles = 0;
  const calls: { text: string; sid: number; speed: number; enableExternalBuffer: boolean }[] = [];
  const tts = new SherpaOnnxTTS(
    { preset: "kokoro-int8-multi-lang-v1_0", modelDir },
    pino({ level: "silent" }),
    () => ({
      OfflineTts: class {
        constructor(config: unknown) {
          configuration = config;
          nativeHandles++;
        }
        async generateAsync(args: (typeof calls)[number]) {
          calls.push(args);
          return { samples: new Float32Array([0, 0.5]), sampleRate: 24000 };
        }
      },
    }),
  );
  const first = tts.synthesizeSpeech("First", { speakerId: 3, speed: 0.75 });
  const second = tts.synthesizeSpeech("Second", { speakerId: 52, speed: 1.5 });
  const results = await Promise.all([first, second]);
  expect(nativeHandles).toBe(1);
  expect(configuration).toMatchObject({
    model: {
      kokoro: {
        model: `${modelDir}/model.int8.onnx`,
        lexicon: `${modelDir}/lexicon-us-en.txt,${modelDir}/lexicon-zh.txt`,
      },
    },
  });
  expect(calls).toEqual([
    { text: "First", sid: 3, speed: 0.75, enableExternalBuffer: false },
    { text: "Second", sid: 52, speed: 1.5, enableExternalBuffer: false },
  ]);
  for (const result of results) {
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 0, 0, 64]));
    expect(result.format).toBe("pcm;rate=24000");
  }
  tts.free();
});

it("rejects invalid voice configuration before allocating native state", async () => {
  const modelDir = await fixture();
  let loaded = false;
  expect(
    () =>
      new SherpaOnnxTTS(
        { preset: "kokoro-int8-multi-lang-v1_0", modelDir, speakerId: 53 },
        pino({ level: "silent" }),
        () => {
          loaded = true;
          throw new Error("must not load");
        },
      ),
  ).toThrow("speaker");
  expect(loaded).toBe(false);
});
