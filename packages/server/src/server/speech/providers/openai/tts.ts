import type pino from "pino";
import { OpenAI } from "openai";
import { Readable } from "node:stream";
import type { SpeechStreamResult, TextToSpeechProvider } from "../../speech-provider.js";

export type { SpeechStreamResult };

export interface TTSConfig {
  apiKey: string;
  baseUrl?: string;
  model?: "tts-1" | "tts-1-hd" | (string & {});
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" | (string & {});
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  speed?: number; // OTTO(speech): preserve speaking speed through the existing API.
}

export class OpenAITTS implements TextToSpeechProvider {
  private readonly openaiClient: OpenAI;
  private readonly config: TTSConfig;
  private readonly logger: pino.Logger;

  constructor(ttsConfig: TTSConfig, parentLogger: pino.Logger) {
    this.config = {
      model: "tts-1",
      voice: "alloy",
      responseFormat: "pcm",
      ...ttsConfig,
    };
    this.logger = parentLogger.child({ module: "agent", provider: "openai", component: "tts" });
    this.openaiClient = new OpenAI({
      apiKey: ttsConfig.apiKey,
      ...(ttsConfig.baseUrl ? { baseURL: ttsConfig.baseUrl } : {}),
    });

    this.logger.info(
      { voice: this.config.voice, model: this.config.model, format: this.config.responseFormat },
      "TTS (OpenAI) initialized",
    );
  }

  public getConfig(): TTSConfig {
    return this.config;
  }

  public async synthesizeSpeech(
    text: string,
    options?: { signal?: AbortSignal },
  ): Promise<SpeechStreamResult> {
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot synthesize empty text");
    }

    const startTime = Date.now();

    try {
      // OTTO(speech): read-aloud content is private, including in debug logs.
      this.logger.debug({ textLength: text.length }, "Synthesizing speech");

      const response = await this.openaiClient.audio.speech.create(
        {
          model: this.config.model!,
          voice: this.config.voice!,
          input: text,
          ...(this.config.speed !== undefined ? { speed: this.config.speed } : {}), // OTTO(speech)
          response_format: this.config.responseFormat as
            | "mp3"
            | "opus"
            | "aac"
            | "flac"
            | "wav"
            | "pcm",
        },
        { signal: options?.signal },
      ); // OTTO(speech): an explicit Stop cancels the cloud request.

      // OTTO(speech): expose a real Node stream for shared playback lifetimes,
      // cancellation and first-chunk delivery; do not buffer the response body.
      if (!response.body) throw new Error("Speech response did not contain audio.");
      const audioStream = Readable.from(response.body);

      const duration = Date.now() - startTime;
      this.logger.debug({ duration }, "Speech synthesis stream ready");

      return {
        stream: audioStream,
        format: this.config.responseFormat || "mp3",
      };
    } catch (error) {
      this.logger.error({ err: error }, "Speech synthesis error");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`TTS synthesis failed: ${message}`, { cause: error });
    }
  }
}
