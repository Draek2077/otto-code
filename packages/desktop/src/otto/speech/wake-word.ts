import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadSherpaOnnxNode } from "@getpaseo/server";
import { resolveWakeWordModelDir } from "./wake-word-model-path.js";
import { resolveWakeWordDetectorTuning } from "./wake-word-tuning.js";
import {
  decodeWakePcm,
  type NativeKeywordSpotter,
  type NativeKeywordStream,
} from "./wake-decoder.js";

const SAMPLE_RATE = 16_000;
const MODEL_FILES = [
  "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
  "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "tokens.txt",
  "keywords.txt",
];
const DEFAULT_PHRASE = "Hey Otto";

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
  try {
    const manifest: unknown = JSON.parse(readFileSync(path.join(modelDir, "model.json"), "utf8"));
    if (!manifest || typeof manifest !== "object") return false;
    const digests: unknown = Reflect.get(manifest, "assetSha256");
    if (!digests || typeof digests !== "object") return false;
    return MODEL_FILES.every((file) => {
      const expected: unknown = Reflect.get(digests, file);
      return (
        typeof expected === "string" &&
        createHash("sha256")
          .update(readFileSync(path.join(modelDir, file)))
          .digest("hex") === expected
      );
    });
  } catch {
    return false;
  }
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
const trackedSenders = new Set<number>();

function requireAppSender(event: Electron.IpcMainInvokeEvent): void {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    window.webContents !== event.sender ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("Wake-word control is restricted to the Otto app renderer.");
  }
}

function stopSender(senderId: number): void {
  const session = sessions.get(senderId);
  sessions.delete(senderId);
  if (session && !session.sender.isDestroyed()) session.sender.setBackgroundThrottling(true);
}

export function registerWakeWordHandlers(): void {
  ipcMain.handle("otto:wake-word:capabilities", (event) => {
    requireAppSender(event);
    const available = Boolean(getModule().KeywordSpotter) && hasModel(getModelDir());
    return {
      available,
      safePhraseSupported: available,
      modelVersion: "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01",
      reason: available
        ? undefined
        : "The local detector runtime or verified model is unavailable. Reinstall Otto to restore it.",
    };
  });

  ipcMain.handle("otto:wake-word:start", (event, rawArgs?: unknown) => {
    requireAppSender(event);
    if (!rawArgs || typeof rawArgs !== "object") throw new Error("Invalid wake-word settings.");
    const phrase: unknown = Reflect.get(rawArgs, "phrase");
    const sensitivity: unknown = Reflect.get(rawArgs, "sensitivity");
    if (
      typeof phrase !== "string" ||
      phrase.length > 64 ||
      typeof sensitivity !== "number" ||
      !Number.isFinite(sensitivity) ||
      sensitivity < 0 ||
      sensitivity > 1
    ) {
      throw new Error("Invalid wake-word phrase or sensitivity.");
    }
    stopSender(event.sender.id);
    try {
      const session = createSession(phrase, sensitivity, event.sender);
      event.sender.setBackgroundThrottling(false);
      sessions.set(event.sender.id, session);
      if (!trackedSenders.has(event.sender.id)) {
        trackedSenders.add(event.sender.id);
        event.sender.once("destroyed", () => {
          trackedSenders.delete(event.sender.id);
          stopSender(event.sender.id);
        });
      }
    } catch (error) {
      log.error(`[wake-word] failed to start detector for renderer ${event.sender.id}`, error);
      throw error;
    }
  });

  ipcMain.handle("otto:wake-word:audio", (event, rawArgs?: unknown) => {
    requireAppSender(event);
    try {
      const session = sessions.get(event.sender.id);
      if (!session || session.detected || !rawArgs || typeof rawArgs !== "object") return;
      const encoded: unknown = Reflect.get(rawArgs, "pcm");
      if (typeof encoded !== "string") throw new Error("Invalid detector PCM chunk.");
      if (decodeWakePcm(session.spotter, session.stream, encoded)) {
        session.detected = true;
        log.info(`[wake-word] detected Hey Otto for renderer ${event.sender.id}`);
        event.sender.send("paseo:event:wake-word-detected", { phrase: DEFAULT_PHRASE });
      }
    } catch (error) {
      log.error(`[wake-word] audio processing failed for renderer ${event.sender.id}`, error);
      throw error;
    }
  });

  ipcMain.handle("otto:wake-word:stop", (event) => {
    requireAppSender(event);
    stopSender(event.sender.id);
  });

  app.on("window-all-closed", () => {
    for (const senderId of sessions.keys()) stopSender(senderId);
  });
}
