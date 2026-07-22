import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { Readable } from "node:stream";

import { TTSManager } from "./tts-manager.js";
import type { TextToSpeechProvider } from "../speech/speech-provider.js";
import type { SessionOutboundMessage } from "../messages.js";

type AudioOutputMessage = Extract<SessionOutboundMessage, { type: "audio_output" }>;

function isAudioOutputMessage(message: SessionOutboundMessage): message is AudioOutputMessage {
  return message.type === "audio_output";
}

class FakeTts implements TextToSpeechProvider {
  async synthesizeSpeech(): Promise<{ stream: Readable; format: string }> {
    return {
      stream: Readable.from([Buffer.from("a"), Buffer.from("b")]),
      format: "pcm;rate=24000",
    };
  }
}

describe("TTSManager", () => {
  it("emits chunks and resolves once confirmed", async () => {
    const manager = new TTSManager("s1", pino({ level: "silent" }), new FakeTts());
    const abort = new AbortController();
    const emitted: SessionOutboundMessage[] = [];

    const task = manager.generateAndWaitForPlayback(
      "hello",
      (msg) => {
        emitted.push(msg);
        if (msg.type === "audio_output") {
          manager.confirmAudioPlayed(msg.payload.id);
        }
      },
      abort.signal,
      true,
    );

    await task;

    const audioMsgs = emitted.filter((m) => m.type === "audio_output");
    expect(audioMsgs).toHaveLength(1);
    const audioMessage = emitted.find(isAudioOutputMessage);
    expect(audioMessage).toBeDefined();
    expect(audioMessage?.payload.groupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(audioMessage?.payload.chunkIndex).toBe(0);
    expect(audioMessage?.payload.isLastChunk).toBe(true);
  });

  it("speakStreaming emits one non-voice group per sentence over the full text", async () => {
    const synthesized: string[] = [];
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech(text: string): Promise<{ stream: Readable; format: string }> {
        synthesized.push(text);
        return { stream: Readable.from([Buffer.from("x")]), format: "pcm;rate=24000" };
      },
    };
    const manager = new TTSManager("s1", pino({ level: "silent" }), tts);
    const abort = new AbortController();
    const emitted: AudioOutputMessage[] = [];

    await manager.speakStreaming(
      "First sentence. Second sentence. Third sentence.",
      (msg) => {
        if (isAudioOutputMessage(msg)) {
          emitted.push(msg);
          manager.confirmAudioPlayed(msg.payload.id);
        }
      },
      abort.signal,
    );

    // Three sentences => three distinct single-chunk groups, all non-voice.
    expect(synthesized).toEqual(["First sentence.", "Second sentence.", "Third sentence."]);
    expect(emitted).toHaveLength(3);
    const groupIds = new Set(emitted.map((m) => m.payload.groupId));
    expect(groupIds.size).toBe(3);
    for (const message of emitted) {
      expect(message.payload.isVoiceMode).toBe(false);
      expect(message.payload.chunkIndex).toBe(0);
      expect(message.payload.isLastChunk).toBe(true);
    }
  });

  it("speakStreaming stops emitting once aborted", async () => {
    const synthesized: string[] = [];
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech(text: string): Promise<{ stream: Readable; format: string }> {
        synthesized.push(text);
        return { stream: Readable.from([Buffer.from("x")]), format: "pcm;rate=24000" };
      },
    };
    const manager = new TTSManager("s1", pino({ level: "silent" }), tts);
    const abort = new AbortController();
    const emitted: AudioOutputMessage[] = [];

    // Abort after the first group is emitted; the loop must not emit further
    // groups and the call must resolve rather than hang.
    await manager.speakStreaming(
      "One. Two. Three. Four.",
      (msg) => {
        if (isAudioOutputMessage(msg)) {
          emitted.push(msg);
          abort.abort();
        }
      },
      abort.signal,
    );

    expect(emitted.length).toBeLessThan(4);
  });

  it("splits long text into safe synthesis segments", async () => {
    const calls: string[] = [];
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech(text: string): Promise<{ stream: Readable; format: string }> {
        calls.push(text);
        return {
          stream: Readable.from([Buffer.from("x")]),
          format: "pcm;rate=24000",
        };
      },
    };

    const manager = new TTSManager("s1", pino({ level: "silent" }), tts);
    const abort = new AbortController();
    const longText = Array.from({ length: 180 })
      .map((_, i) => `Sentence ${i + 1}.`)
      .join(" ");

    await manager.generateAndWaitForPlayback(
      longText,
      (msg) => {
        if (msg.type === "audio_output") {
          manager.confirmAudioPlayed(msg.payload.id);
        }
      },
      abort.signal,
      true,
    );

    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((text) => text.length <= 260)).toBe(true);
    expect(calls[0].length).toBeLessThanOrEqual(120);
    expect(calls.slice(1).some((text) => text.length > calls[0].length)).toBe(true);
  });

  it("prefetches synthesis and emits one gapless group without gating on acks", async () => {
    const started: string[] = [];
    const gateResolvers = new Map<string, () => void>();
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech(text: string): Promise<{ stream: Readable; format: string }> {
        started.push(text);
        await new Promise<void>((resolve) => {
          gateResolvers.set(text, resolve);
        });
        return {
          stream: Readable.from([Buffer.from(text)]),
          format: "pcm;rate=24000",
        };
      },
    };

    const manager = new TTSManager("s1", pino({ level: "silent" }), tts);
    const abort = new AbortController();
    const segments = [
      "One sentence that stands alone as the first voice chunk.",
      "Two sentence that is a second separately synthesized segment.",
      "Three sentence that is the final segment of this single utterance.",
    ];
    const text = segments.join(" ");
    const chunks: AudioOutputMessage["payload"][] = [];

    const task = manager.generateAndWaitForPlayback(
      text,
      (msg) => {
        if (msg.type === "audio_output") {
          // Deliberately do NOT confirm here: emission must not depend on acks.
          chunks.push(msg.payload);
        }
      },
      abort.signal,
      true,
    );

    // Prefetch: two segments are synthesizing before any audio has been emitted.
    await vi.waitFor(() => {
      expect(started).toEqual([segments[0], segments[1]]);
    });
    expect(chunks).toHaveLength(0);

    // Release synthesis in order; the third is scheduled only once the first is
    // consumed, so wait for each gate to register before releasing it. All three
    // ship without a single playback confirmation.
    for (const segment of segments) {
      await vi.waitFor(() => {
        expect(gateResolvers.has(segment)).toBe(true);
      });
      gateResolvers.get(segment)!();
    }

    await vi.waitFor(() => {
      expect(chunks).toHaveLength(3);
    });

    // Everything is one group, indices are contiguous, only the last is final.
    const groupIds = new Set(chunks.map((chunk) => chunk.groupId));
    expect(groupIds.size).toBe(1);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks.map((chunk) => chunk.isLastChunk)).toEqual([false, false, true]);

    // The call resolves only once the client confirms the whole group.
    for (const chunk of chunks) {
      manager.confirmAudioPlayed(chunk.id);
    }
    await task;
  });

  it("destroys prefetched streams after abort", async () => {
    const destroyed: string[] = [];
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech(text: string): Promise<{ stream: Readable; format: string }> {
        const stream = new Readable({
          read() {
            this.push(Buffer.from(text));
            this.push(null);
          },
        });
        const destroySpy = vi.spyOn(stream, "destroy").mockImplementation(function (
          this: Readable,
          error?: Error,
        ) {
          destroyed.push(text);
          return Readable.prototype.destroy.call(this, error);
        });
        void destroySpy;
        return {
          stream,
          format: "pcm;rate=24000",
        };
      },
    };

    const manager = new TTSManager("s1", pino({ level: "silent" }), tts);
    const abort = new AbortController();
    let firstChunkId: string | null = null;

    const task = manager.generateAndWaitForPlayback(
      [
        "First sentence that is long enough to stand alone in the first synthesized group.",
        "Second sentence that should be prefetched and then discarded after abort is requested.",
        "Third sentence that should also be cleaned up if it was prefetched before the abort.",
      ].join(" "),
      (msg) => {
        if (msg.type === "audio_output" && firstChunkId === null) {
          firstChunkId = msg.payload.id;
        }
      },
      abort.signal,
      true,
    );

    await vi.waitFor(() => {
      expect(firstChunkId).not.toBeNull();
    });

    abort.abort();

    await task;
    await vi.waitFor(() => {
      expect(destroyed.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("does not emit unhandled rejections when stream iteration fails", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const tts: TextToSpeechProvider = {
        async synthesizeSpeech(): Promise<{ stream: Readable; format: string }> {
          const stream = Readable.from(
            (async function* () {
              yield Buffer.from("a");
              throw new Error("stream exploded");
            })(),
          );
          return {
            stream,
            format: "pcm;rate=24000",
          };
        },
      };

      const manager = new TTSManager("s1", pino({ level: "silent" }), tts);
      const abort = new AbortController();

      await expect(
        manager.generateAndWaitForPlayback(
          "hello",
          (msg) => {
            if (msg.type === "audio_output") {
              manager.confirmAudioPlayed(msg.payload.id);
            }
          },
          abort.signal,
          true,
        ),
      ).rejects.toThrow("stream exploded");

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("ignores late confirmations for recently closed audio IDs", async () => {
    const logger = pino({ level: "silent" });
    const warnSpy = vi.spyOn(logger, "warn");
    const manager = new TTSManager("s1", logger, new FakeTts());
    const abort = new AbortController();
    const emitted: SessionOutboundMessage[] = [];

    await manager.generateAndWaitForPlayback(
      "hello",
      (msg) => {
        emitted.push(msg);
        if (msg.type === "audio_output") {
          manager.confirmAudioPlayed(msg.payload.id);
        }
      },
      abort.signal,
      true,
    );

    const firstAudio = emitted.find((msg) => msg.type === "audio_output");
    expect(firstAudio?.type).toBe("audio_output");

    manager.confirmAudioPlayed(
      (firstAudio as Extract<SessionOutboundMessage, { type: "audio_output" }>).payload.id,
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
