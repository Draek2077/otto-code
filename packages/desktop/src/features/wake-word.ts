import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadSherpaOnnxNode } from "@otto-code/server";
import { resolveWakeWordModelDir } from "./wake-word-model-path.js";
import { resolveWakeWordDetectorTuning } from "./wake-word-tuning.js";

const SAMPLE_RATE = 16_000;
const MODEL_FILES = [
  "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
  "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "tokens.txt",
  "keywords.txt",
];
const DEFAULT_PHRASE = "Hey Otto";

interface NativeKeywordSpotter {
  createStream(): NativeKeywordStream;
  isReady(stream: NativeKeywordStream): boolean;
  decode(stream: NativeKeywordStream): void;
  getResult(stream: NativeKeywordStream): { keyword?: string };
}

interface NativeKeywordStream {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
}

interface WakeWordSession {
  spotter: NativeKeywordSpotter;
  stream: NativeKeywordStream;
  modelDir: string;
  detected: boolean;
  sender: Electron.WebContents;
}

function getModelDir(): string {
  return resolveWakeWordModelDir({
    configured: process.env.OTTO_WAKE_WORD_MODEL_DIR,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
}

function hasModel(modelDir: string): boolean {
  return MODEL_FILES.every((file) => existsSync(path.join(modelDir, file)));
}

function getModule(): { KeywordSpotter?: new (config: unknown) => NativeKeywordSpotter } {
  try {
    return loadSherpaOnnxNode() as unknown as {
      KeywordSpotter?: new (config: unknown) => NativeKeywordSpotter;
    };
  } catch {
    return {};
  }
}

function createSession(
  phrase: string,
  sensitivity: number,
  sender: Electron.WebContents,
): WakeWordSession {
  if (phrase.trim().toLocaleLowerCase() !== DEFAULT_PHRASE.toLocaleLowerCase()) {
    throw new Error(`This desktop model only supports the wake phrase “${DEFAULT_PHRASE}”.`);
  }

  const modelDir = getModelDir();
  if (!hasModel(modelDir)) {
    throw new Error(
      `Desktop wake-word model is missing or incomplete at ${modelDir}. Reinstall Otto or set OTTO_WAKE_WORD_MODEL_DIR to a verified model directory.`,
    );
  }

  const KeywordSpotter = getModule().KeywordSpotter;
  if (!KeywordSpotter) {
    throw new Error("This desktop build does not include the local sherpa-onnx runtime.");
  }

  const tuning = resolveWakeWordDetectorTuning(sensitivity);
  const spotter = new KeywordSpotter({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(modelDir, MODEL_FILES[0]),
        decoder: path.join(modelDir, MODEL_FILES[1]),
        joiner: path.join(modelDir, MODEL_FILES[2]),
      },
      tokens: path.join(modelDir, "tokens.txt"),
      provider: "cpu",
      numThreads: 1,
    },
    maxActivePaths: tuning.maxActivePaths,
    numTrailingBlanks: tuning.numTrailingBlanks,
    keywordsFile: path.join(modelDir, "keywords.txt"),
    keywordsThreshold: tuning.keywordsThreshold,
    keywordsScore: tuning.keywordsScore,
  });
  return {
    spotter,
    stream: spotter.createStream(),
    modelDir,
    detected: false,
    sender,
  };
}

const sessions = new Map<number, WakeWordSession>();

export function registerWakeWordHandlers(): void {
  ipcMain.handle("otto:wake-word:capabilities", () => ({
    available: Boolean(getModule().KeywordSpotter) && hasModel(getModelDir()),
    safePhraseSupported: false,
    modelVersion: "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01",
  }));

  ipcMain.handle("otto:wake-word:start", (event, rawArgs?: unknown) => {
    const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
    const phrase = typeof args.phrase === "string" ? args.phrase : DEFAULT_PHRASE;
    const sensitivity = typeof args.sensitivity === "number" ? args.sensitivity : 0.7;
    const existing = sessions.get(event.sender.id);
    if (existing) {
      sessions.delete(event.sender.id);
    }
    try {
      const session = createSession(phrase, sensitivity, event.sender);
      event.sender.setBackgroundThrottling(false);
      sessions.set(event.sender.id, session);
    } catch (error) {
      log.error(`[wake-word] failed to start detector for renderer ${event.sender.id}`, error);
      throw error;
    }
  });

  ipcMain.handle("otto:wake-word:audio", (event, rawArgs?: unknown) => {
    try {
      const session = sessions.get(event.sender.id);
      if (!session || session.detected || !rawArgs || typeof rawArgs !== "object") return;
      const encoded = (rawArgs as { pcm?: unknown }).pcm;
      if (typeof encoded !== "string") return;
      const bytes = Buffer.from(encoded, "base64");
      const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
      for (let i = 0; i < samples.length; i += 1) {
        let value = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
        if (value & 0x8000) value -= 0x10000;
        const sample = value / 0x8000;
        samples[i] = sample;
      }
      session.stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
      let detectedKeyword = "";
      while (session.spotter.isReady(session.stream)) {
        session.spotter.decode(session.stream);
        detectedKeyword = session.spotter.getResult(session.stream).keyword ?? "";
        if (detectedKeyword) break;
      }
      if (detectedKeyword) {
        session.detected = true;
        log.info(
          `[wake-word] detected ${JSON.stringify(detectedKeyword)} for renderer ${event.sender.id}`,
        );
        event.sender.send("otto:event:wake-word-detected", { phrase: DEFAULT_PHRASE });
      }
    } catch (error) {
      log.error(`[wake-word] audio processing failed for renderer ${event.sender.id}`, error);
      throw error;
    }
  });

  ipcMain.handle("otto:wake-word:stop", (event) => {
    const session = sessions.get(event.sender.id);
    sessions.delete(event.sender.id);
    session?.sender.setBackgroundThrottling(true);
  });

  app.on("window-all-closed", () => {
    for (const session of sessions.values()) {
      session.sender.setBackgroundThrottling(true);
    }
    sessions.clear();
  });
}

export function stopWakeWordSessionForWindow(window: BrowserWindow): void {
  const session = sessions.get(window.webContents.id);
  sessions.delete(window.webContents.id);
  session?.sender.setBackgroundThrottling(true);
}
