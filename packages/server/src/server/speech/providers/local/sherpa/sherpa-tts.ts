import type pino from "pino";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";

import type {
  SpeechStreamResult,
  SpeechVoiceOverride,
  TextToSpeechProvider,
} from "../../../speech-provider.js";
import { chunkBuffer, float32ToPcm16le } from "../../../audio.js";
import { getSherpaOnnxTtsLayout, type LocalTtsModelId } from "./model-catalog.js";
import { listLocalTtsVoices, resolveLocalTtsSpeakerId } from "./tts-voices.js";
import { loadSherpaOnnxNode } from "./sherpa-onnx-node-loader.js";

export type SherpaTtsPreset = LocalTtsModelId;

// sherpa-onnx will crash the native worker on a nonsensical speed or an
// out-of-range speaker id. These bounds fence off bad persisted/env config
// (e.g. speed=0 or speakerId=999) before it reaches generate().
const MIN_TTS_SPEED = 0.5;
const MAX_TTS_SPEED = 2.0;

function clampTtsSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed)) {
    return 1.0;
  }
  return Math.min(MAX_TTS_SPEED, Math.max(MIN_TTS_SPEED, speed));
}

function resolveValidSpeakerId(
  preset: LocalTtsModelId,
  requested: number | undefined,
  fallback: number,
): number {
  if (requested === undefined) {
    return fallback;
  }
  const voiceCount = listLocalTtsVoices(preset).length;
  if (Number.isInteger(requested) && requested >= 0 && requested < voiceCount) {
    return requested;
  }
  return fallback;
}

export interface SherpaTtsConfig {
  preset: SherpaTtsPreset;
  modelDir: string;
  speakerId?: number;
  speed?: number;
  lengthScale?: number;
  numThreads?: number;
}

function assertFileExists(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

interface SherpaOfflineTtsNative {
  sampleRate?: number;
  generate: (args: {
    text: string;
    sid: number;
    speed: number;
    enableExternalBuffer: boolean;
  }) => { samples?: Float32Array | number[]; sampleRate?: number } | undefined;
  free?: () => void;
}

export class SherpaOnnxTTS implements TextToSpeechProvider {
  private readonly tts: SherpaOfflineTtsNative;
  private readonly preset: LocalTtsModelId;
  private readonly speakerId: number;
  private readonly speed: number;
  private readonly logger: pino.Logger;

  constructor(config: SherpaTtsConfig, logger: pino.Logger) {
    this.logger = logger.child({ module: "speech", provider: "local", component: "tts" });
    const layout = getSherpaOnnxTtsLayout(config.preset);
    this.preset = config.preset;
    this.speakerId = resolveValidSpeakerId(
      config.preset,
      config.speakerId,
      layout.defaultSpeakerId,
    );
    if (config.speakerId !== undefined && config.speakerId !== this.speakerId) {
      this.logger.warn(
        { requested: config.speakerId, fallback: this.speakerId, preset: config.preset },
        "Configured TTS speaker id is out of range; falling back to the model default",
      );
    }
    this.speed = clampTtsSpeed(config.speed);

    const sherpa = loadSherpaOnnxNode();
    if (typeof sherpa.OfflineTts !== "function") {
      throw new Error("sherpa-onnx-node OfflineTts is unavailable");
    }

    const modelPath = `${config.modelDir}/${layout.modelFile}`;
    const voicesPath = `${config.modelDir}/voices.bin`;
    const tokensPath = `${config.modelDir}/tokens.txt`;
    const dataDir = `${config.modelDir}/espeak-ng-data`;
    const lexiconPaths = layout.lexiconFiles.map((file) => `${config.modelDir}/${file}`);

    assertFileExists(modelPath, "TTS model");
    assertFileExists(voicesPath, "TTS voices");
    assertFileExists(tokensPath, "TTS tokens");
    assertFileExists(dataDir, "TTS espeak-ng dataDir");
    for (const lexiconPath of lexiconPaths) {
      assertFileExists(lexiconPath, "TTS lexicon");
    }

    const modelConfig = {
      kokoro: {
        model: modelPath,
        voices: voicesPath,
        tokens: tokensPath,
        dataDir,
        // Kokoro v1.x ships lexicons for EN/ZH; other languages fall back to
        // espeak-ng phonemes from dataDir. v0.19 has no lexicon files.
        ...(lexiconPaths.length > 0 ? { lexicon: lexiconPaths.join(",") } : {}),
        lengthScale: config.lengthScale ?? 1.0,
      },
    };

    const offlineTtsConfig = {
      model: modelConfig,
      numThreads: config.numThreads ?? 2,
      provider: "cpu",
      maxNumSentences: 1,
    };

    this.tts = new (
      sherpa as unknown as { OfflineTts: new (config: unknown) => SherpaOfflineTtsNative }
    ).OfflineTts(offlineTtsConfig);
    this.logger.info(
      { preset: config.preset, modelDir: config.modelDir },
      "Sherpa offline TTS initialized",
    );
  }

  // A personality voice only resolves to a speaker on THIS model. A voice bound
  // to a different model (or an unknown name) silently falls back to the host
  // default — the personality voice is a soft binding, never a hard failure.
  private resolveSpeakerId(voice?: SpeechVoiceOverride): number {
    if (!voice || (voice.model && voice.model !== this.preset)) {
      return this.speakerId;
    }
    return resolveLocalTtsSpeakerId(this.preset, voice.name) ?? this.speakerId;
  }

  async synthesizeSpeech(text: string, voice?: SpeechVoiceOverride): Promise<SpeechStreamResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Cannot synthesize empty text");
    }

    const audio = this.tts.generate({
      text: trimmed,
      sid: this.resolveSpeakerId(voice),
      speed: this.speed,
      // Electron rejects native external-backed typed arrays. Request a copied buffer
      // from sherpa itself instead of trying to clone after generate() returns.
      enableExternalBuffer: false,
    });
    let rawSamples: Float32Array | null = null;
    if (audio && audio.samples instanceof Float32Array) {
      rawSamples = audio.samples;
    } else if (audio && Array.isArray(audio.samples)) {
      rawSamples = Float32Array.from(audio.samples);
    }
    // Copy to avoid "External buffers are not allowed" when sherpa-onnx
    // returns a Float32Array backed by native memory.
    const samples = rawSamples ? Float32Array.from(rawSamples) : null;
    let sampleRate: number;
    if (
      audio &&
      typeof audio.sampleRate === "number" &&
      Number.isFinite(audio.sampleRate) &&
      audio.sampleRate > 0
    ) {
      sampleRate = audio.sampleRate;
    } else if (typeof this.tts.sampleRate === "number") {
      sampleRate = this.tts.sampleRate;
    } else {
      sampleRate = 24000;
    }

    if (!samples) {
      throw new Error("Unexpected sherpa TTS output: missing Float32 samples");
    }

    const pcm16 = float32ToPcm16le(samples);
    const chunkBytes = Math.max(2, Math.round(sampleRate * 0.05) * 2); // ~50ms
    const chunks = chunkBuffer(pcm16, chunkBytes);

    return {
      stream: Readable.from(chunks),
      format: `pcm;rate=${sampleRate}`,
    };
  }

  free(): void {
    try {
      this.tts?.free?.();
    } catch {
      // ignore
    }
  }
}
