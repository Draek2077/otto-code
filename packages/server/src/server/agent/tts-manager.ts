import type pino from "pino";
import type { Readable } from "node:stream";
import { v4 as uuidv4 } from "uuid";
import type { SpeechVoiceOverride, TextToSpeechProvider } from "../speech/speech-provider.js";
import { toResolver, type Resolvable } from "../speech/provider-resolver.js";
import type { SessionOutboundMessage } from "../messages.js";

interface PendingPlayback {
  resolve: () => void;
  reject: (error: Error) => void;
  pendingChunks: number;
  streamEnded: boolean;
}

/** One `speak` call's playback: a group id, its pending-chunk accounting, and a
 * promise that settles when the client has confirmed the whole utterance. */
interface GroupPlayback {
  groupId: string;
  promise: Promise<void>;
  pending: PendingPlayback;
  /** Remove the abort listener registered for this group. */
  dispose: () => void;
}

interface TtsSegment {
  index: number;
  text: string;
}

type PreparedTtsSegment = TtsSegment & {
  format: string;
  stream: Readable;
};

type PreparedSegmentResult =
  | { kind: "prepared"; prepared: PreparedTtsSegment }
  | { kind: "aborted" }
  | { kind: "error"; error: unknown };

const MAX_TTS_SEGMENT_CHARS = 260;
const TTS_PREFETCH_SEGMENTS = 2;
const CLOSED_AUDIO_ID_TTL_MS = 10_000;

function splitOversizedFragment(fragment: string, maxChars: number): string[] {
  const trimmed = fragment.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const clauseChunks = trimmed.split(/(?<=[,;:])\s+/);
  if (clauseChunks.length > 1) {
    const parts: string[] = [];
    let current = "";

    const pushCurrent = () => {
      const value = current.trim();
      if (value) {
        parts.push(value);
      }
      current = "";
    };

    for (const clause of clauseChunks) {
      const clauseText = clause.trim();
      if (!clauseText) {
        continue;
      }

      if (clauseText.length > maxChars) {
        pushCurrent();
        parts.push(...splitOversizedFragment(clauseText, maxChars));
        continue;
      }

      if (!current) {
        current = clauseText;
        continue;
      }

      const candidate = `${current} ${clauseText}`;
      if (candidate.length <= maxChars) {
        current = candidate;
        continue;
      }

      pushCurrent();
      current = clauseText;
    }

    pushCurrent();
    if (parts.length > 1 || parts[0] !== trimmed) {
      return parts;
    }
  }

  const parts: string[] = [];
  let remaining = trimmed;
  while (remaining.length > maxChars) {
    let idx = remaining.lastIndexOf(" ", maxChars);
    if (idx < Math.floor(maxChars * 0.5)) {
      idx = maxChars;
    }
    parts.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  if (remaining.length > 0) {
    parts.push(remaining);
  }
  return parts;
}

function splitTextForTts(text: string): TtsSegment[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("Cannot synthesize empty text");
  }

  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const parts: TtsSegment[] = [];
  let segmentIndex = 0;

  for (const sentence of sentences) {
    const fragments = splitOversizedFragment(sentence, MAX_TTS_SEGMENT_CHARS);
    for (const fragment of fragments) {
      parts.push({ index: segmentIndex, text: fragment });
      segmentIndex += 1;
    }
  }

  return parts;
}

/**
 * Per-session TTS manager
 * Handles TTS audio generation and playback confirmation tracking
 */
export class TTSManager {
  private pendingPlaybacks: Map<string, PendingPlayback> = new Map();
  private readonly recentlyClosedAudioIds: Map<string, number> = new Map();
  private readonly logger: pino.Logger;
  private readonly resolveTts: () => TextToSpeechProvider | null;

  constructor(
    sessionId: string,
    logger: pino.Logger,
    tts: Resolvable<TextToSpeechProvider | null>,
  ) {
    this.logger = logger.child({ module: "agent", component: "tts-manager", sessionId });
    this.resolveTts = toResolver(tts);
  }

  /**
   * Generate TTS audio, emit to client, and wait for playback confirmation
   * Returns a Promise that resolves when the client confirms playback completed.
   *
   * A single `speak` call is ONE utterance. We split its text into synthesis
   * segments only to keep each provider request small and to start audio flowing
   * sooner, but all segments belong to a SINGLE playback group and are emitted as
   * contiguous chunks. Emission is pipelined — a segment ships the instant it is
   * synthesized, never waiting for the previous segment's playback to be
   * confirmed. That confirmation gate used to cost a full client round-trip
   * between every sentence, which is exactly the multi-sentence lag users heard;
   * the client already queues chunks and plays them back-to-back, so removing the
   * gate makes multi-sentence answers gapless. Playback state on the client
   * (start/finish, thinking-tone, barge-in) keys off the group, so it sees one
   * clean utterance instead of a stutter of per-sentence groups.
   */
  public async generateAndWaitForPlayback(
    text: string,
    emitMessage: (msg: SessionOutboundMessage) => void,
    abortSignal: AbortSignal,
    isVoiceMode: boolean,
    voice?: SpeechVoiceOverride,
  ): Promise<void> {
    const ttsStartMs = Date.now();
    this.logger.info(
      {
        isVoiceMode,
        textLength: text.length,
        text,
      },
      "TTS input text",
    );

    const segments = splitTextForTts(text);
    this.logger.info(
      {
        segmentCount: segments.length,
        segments: segments.map((s) => ({
          index: s.index,
          chars: s.text.length,
          text: s.text.slice(0, 80),
        })),
      },
      `TTS split into ${segments.length} segment(s)`,
    );

    const inflight = new Map<number, Promise<PreparedSegmentResult>>();
    let nextSegmentToSchedule = 0;

    const scheduleNextSegments = () => {
      while (nextSegmentToSchedule < segments.length && inflight.size < TTS_PREFETCH_SEGMENTS) {
        const segment = segments[nextSegmentToSchedule];
        inflight.set(segment.index, this.scheduleSegmentSynthesis(segment, abortSignal, voice));
        nextSegmentToSchedule += 1;
      }
    };

    scheduleNextSegments();

    const group = this.beginGroupPlayback(abortSignal);
    // Emit one chunk behind so the final emitted chunk — whichever segment it
    // turns out to be — is the one flagged `isLastChunk`, and chunk indices stay
    // contiguous even if a segment yields no audio (the client plays indices in
    // strict +1 order and would otherwise stall on a gap).
    let held: { buffer: Buffer; format: string } | null = null;
    let nextChunkIndex = 0;
    const flushHeld = (isLast: boolean): void => {
      if (!held) {
        return;
      }
      this.emitGroupChunk({
        group,
        chunkIndex: nextChunkIndex,
        isLastChunk: isLast,
        buffer: held.buffer,
        format: held.format,
        isVoiceMode,
        emitMessage,
      });
      nextChunkIndex += 1;
      held = null;
    };

    try {
      for (const segment of segments) {
        if (abortSignal.aborted) {
          this.logger.debug("Aborted before emitting segmented audio");
          return;
        }

        const synthWaitStart = Date.now();
        const result = await inflight.get(segment.index)!;
        const synthWaitMs = Date.now() - synthWaitStart;
        inflight.delete(segment.index);
        scheduleNextSegments();

        if (result.kind === "aborted") {
          return;
        }

        if (result.kind === "error") {
          throw result.error;
        }

        const buffer = await this.collectSegmentBuffer(result.prepared.stream, abortSignal);
        if (abortSignal.aborted) {
          return;
        }

        this.logger.info(
          {
            segmentIndex: segment.index,
            synthWaitMs,
            totalElapsedMs: Date.now() - ttsStartMs,
            chars: segment.text.length,
          },
          `TTS segment ${segment.index} synthesis ready (waited ${synthWaitMs}ms, total ${Date.now() - ttsStartMs}ms)`,
        );

        if (buffer && buffer.length > 0) {
          // The previously held segment is now known not to be the last — ship it.
          flushHeld(false);
          held = { buffer, format: result.prepared.format };
        }

        scheduleNextSegments();
      }

      if (abortSignal.aborted) {
        return;
      }

      // Ship the final held segment as the terminal chunk, then wait for the
      // client to confirm every chunk in the group has played.
      flushHeld(true);
      this.finalizeGroupEmission(group);
      await group.promise;
    } catch (error) {
      this.failGroupPlayback(group, error);
      throw error;
    } finally {
      group.dispose();
      this.cleanupPrefetchedSegments(inflight);
      this.logger.info(
        { totalMs: Date.now() - ttsStartMs },
        `TTS generateAndWaitForPlayback done (${Date.now() - ttsStartMs}ms)`,
      );
    }
  }

  /**
   * Stream arbitrary text aloud on demand (the per-message playback button),
   * outside any agent turn. Same sentence-splitting and prefetch pipeline as
   * `generateAndWaitForPlayback`, but each synthesis segment is emitted as its
   * OWN single-chunk playback group with `isVoiceMode: false`. That matters
   * because the client's non-voice audio path buffers a group until its final
   * chunk before playing (it does not stream chunks within a group the way voice
   * mode does) — one group per sentence makes each sentence play the moment it
   * synthesizes, while the next is already prefetching, so audio starts after the
   * first sentence instead of the whole message. The client's serial playback
   * queue keeps the sentences in order. Resolves once every emitted sentence has
   * been confirmed played (or the signal aborts).
   */
  public async speakStreaming(
    text: string,
    emitMessage: (msg: SessionOutboundMessage) => void,
    abortSignal: AbortSignal,
    voice?: SpeechVoiceOverride,
  ): Promise<void> {
    const segments = splitTextForTts(text);
    const inflight = new Map<number, Promise<PreparedSegmentResult>>();
    let nextSegmentToSchedule = 0;
    const scheduleNextSegments = () => {
      while (nextSegmentToSchedule < segments.length && inflight.size < TTS_PREFETCH_SEGMENTS) {
        const segment = segments[nextSegmentToSchedule];
        inflight.set(segment.index, this.scheduleSegmentSynthesis(segment, abortSignal, voice));
        nextSegmentToSchedule += 1;
      }
    };
    scheduleNextSegments();

    const groupPromises: Promise<void>[] = [];
    try {
      for (const segment of segments) {
        if (abortSignal.aborted) {
          return;
        }
        const result = await inflight.get(segment.index)!;
        inflight.delete(segment.index);
        scheduleNextSegments();

        if (result.kind === "aborted") {
          return;
        }
        if (result.kind === "error") {
          throw result.error;
        }

        const buffer = await this.collectSegmentBuffer(result.prepared.stream, abortSignal);
        if (abortSignal.aborted) {
          return;
        }
        if (buffer && buffer.length > 0) {
          const group = this.beginGroupPlayback(abortSignal);
          this.emitGroupChunk({
            group,
            chunkIndex: 0,
            isLastChunk: true,
            buffer,
            format: result.prepared.format,
            isVoiceMode: false,
            emitMessage,
          });
          this.finalizeGroupEmission(group);
          groupPromises.push(group.promise.finally(() => group.dispose()));
        }
        scheduleNextSegments();
      }
      await Promise.all(groupPromises);
    } finally {
      this.cleanupPrefetchedSegments(inflight);
    }
  }

  private async synthesizeSegment(
    segment: TtsSegment,
    abortSignal: AbortSignal,
    voice?: SpeechVoiceOverride,
  ): Promise<PreparedTtsSegment> {
    const resolveStart = Date.now();
    const tts = this.resolveTts();
    if (!tts) {
      throw new Error("TTS not configured");
    }
    const resolveMs = Date.now() - resolveStart;

    if (abortSignal.aborted) {
      throw new Error("TTS synthesis aborted");
    }

    const synthStart = Date.now();
    const { stream, format } = await tts.synthesizeSpeech(segment.text, voice);
    this.logger.info(
      {
        segmentIndex: segment.index,
        resolveMs,
        synthMs: Date.now() - synthStart,
        chars: segment.text.length,
      },
      `TTS segment ${segment.index} synthesized (resolve=${resolveMs}ms, synth=${Date.now() - synthStart}ms, ${segment.text.length} chars)`,
    );

    if (abortSignal.aborted) {
      this.destroySpeechStream(stream);
      throw new Error("TTS synthesis aborted");
    }

    return {
      ...segment,
      stream,
      format,
    };
  }

  private scheduleSegmentSynthesis(
    segment: TtsSegment,
    abortSignal: AbortSignal,
    voice?: SpeechVoiceOverride,
  ): Promise<PreparedSegmentResult> {
    return this.synthesizeSegment(segment, abortSignal, voice).then(
      (prepared) => {
        if (abortSignal.aborted) {
          this.destroySpeechStream(prepared.stream);
          return { kind: "aborted" };
        }
        return { kind: "prepared", prepared };
      },
      (error) => {
        if (abortSignal.aborted) {
          return { kind: "aborted" };
        }
        return { kind: "error", error };
      },
    );
  }

  private cleanupPrefetchedSegments(inflight: Map<number, Promise<PreparedSegmentResult>>): void {
    if (inflight.size === 0) {
      return;
    }

    for (const pending of inflight.values()) {
      void pending.then((result) => {
        if (result.kind === "prepared") {
          this.destroySpeechStream(result.prepared.stream);
        }
        return;
      });
    }
  }

  private destroySpeechStream(stream: Readable): void {
    if (typeof stream.destroy === "function" && !stream.destroyed) {
      stream.destroy();
    }
  }

  private pruneRecentlyClosedAudioIds(now: number): void {
    for (const [audioId, expiresAt] of this.recentlyClosedAudioIds.entries()) {
      if (expiresAt <= now) {
        this.recentlyClosedAudioIds.delete(audioId);
      }
    }
  }

  private rememberClosedAudioId(audioId: string): void {
    const now = Date.now();
    this.pruneRecentlyClosedAudioIds(now);
    this.recentlyClosedAudioIds.set(audioId, now + CLOSED_AUDIO_ID_TTL_MS);
  }

  /**
   * Register a single playback group and the promise that resolves once the
   * client has confirmed every chunk in it (or the turn is aborted). One group
   * per `speak` call; chunks are added by `emitGroupChunk` as segments synthesize.
   */
  private beginGroupPlayback(abortSignal: AbortSignal): GroupPlayback {
    const groupId = uuidv4();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const pending: PendingPlayback = {
      resolve,
      reject,
      pendingChunks: 0,
      streamEnded: false,
    };
    this.pendingPlaybacks.set(groupId, pending);

    const onAbort = () => {
      this.logger.debug("Aborted while waiting for group playback");
      pending.streamEnded = true;
      pending.pendingChunks = 0;
      this.pendingPlaybacks.delete(groupId);
      this.rememberClosedAudioId(groupId);
      resolve();
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });

    return {
      groupId,
      promise,
      pending,
      dispose: () => abortSignal.removeEventListener("abort", onAbort),
    };
  }

  /** Emit one already-buffered segment as the next chunk of its playback group. */
  private emitGroupChunk(params: {
    group: GroupPlayback;
    chunkIndex: number;
    isLastChunk: boolean;
    buffer: Buffer;
    format: string;
    isVoiceMode: boolean;
    emitMessage: (msg: SessionOutboundMessage) => void;
  }): void {
    const { group, chunkIndex, isLastChunk, buffer, format, isVoiceMode, emitMessage } = params;
    group.pending.pendingChunks += 1;
    emitMessage({
      type: "audio_output",
      payload: {
        id: `${group.groupId}:${chunkIndex}`,
        groupId: group.groupId,
        chunkIndex,
        isLastChunk,
        audio: buffer.toString("base64"),
        format,
        isVoiceMode,
      },
    });
  }

  /**
   * Mark the group as fully emitted. If every emitted chunk has already been
   * confirmed (or none were emitted at all), resolve immediately; otherwise
   * `confirmAudioPlayed` resolves once the last confirmation lands.
   */
  private finalizeGroupEmission(group: GroupPlayback): void {
    group.pending.streamEnded = true;
    if (group.pending.pendingChunks === 0) {
      this.pendingPlaybacks.delete(group.groupId);
      this.rememberClosedAudioId(group.groupId);
      group.pending.resolve();
    }
  }

  /**
   * Tear down a group whose synthesis errored. The caller rethrows so the
   * `speak` promise rejects; here we just drop the pending entry (settling its
   * promise so it never dangles) so a late confirmation is ignored quietly.
   */
  private failGroupPlayback(group: GroupPlayback, error: unknown): void {
    if (this.pendingPlaybacks.delete(group.groupId)) {
      this.rememberClosedAudioId(group.groupId);
    }
    group.pending.resolve();
    this.logger.debug({ err: error }, "Group playback failed");
  }

  /**
   * Drain a synthesized segment's stream into a single buffer. Returns null when
   * the turn was aborted mid-stream or the stream produced no audio. A genuine
   * stream error (not an abort) is rethrown so the caller can fail the group.
   */
  private async collectSegmentBuffer(
    stream: Readable,
    abortSignal: AbortSignal,
  ): Promise<Buffer | null> {
    try {
      const buffers: Buffer[] = [];
      for await (const chunk of stream) {
        if (abortSignal.aborted) {
          this.logger.debug("Aborted during stream collection");
          return null;
        }
        buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (abortSignal.aborted || buffers.length === 0) {
        return null;
      }
      return Buffer.concat(buffers);
    } catch (error) {
      if (abortSignal.aborted) {
        this.logger.debug("Audio stream closed after abort");
        return null;
      }
      this.logger.error({ err: error }, "Error streaming audio");
      throw error;
    } finally {
      this.destroySpeechStream(stream);
    }
  }

  /**
   * Called when client confirms audio playback completed
   * Resolves the corresponding promise
   */
  public confirmAudioPlayed(chunkId: string): void {
    const [audioId] = chunkId.includes(":") ? chunkId.split(":") : [chunkId];
    const pending = this.pendingPlaybacks.get(audioId);

    if (!pending) {
      const now = Date.now();
      this.pruneRecentlyClosedAudioIds(now);
      const expiresAt = this.recentlyClosedAudioIds.get(audioId);
      if (expiresAt && expiresAt > now) {
        this.logger.debug({ chunkId }, "Ignoring late confirmation for recently closed audio ID");
        return;
      }
      this.logger.warn({ chunkId }, "Received confirmation for unknown audio ID");
      return;
    }

    pending.pendingChunks = Math.max(0, pending.pendingChunks - 1);

    if (pending.pendingChunks === 0 && pending.streamEnded) {
      pending.resolve();
      this.pendingPlaybacks.delete(audioId);
      this.rememberClosedAudioId(audioId);
    }
  }

  /**
   * Cancel all pending playbacks (e.g., user interrupted audio)
   */
  public cancelPendingPlaybacks(reason: string): void {
    if (this.pendingPlaybacks.size === 0) {
      return;
    }

    this.logger.debug(
      { count: this.pendingPlaybacks.size, reason },
      "Cancelling pending playbacks",
    );

    for (const [audioId, pending] of this.pendingPlaybacks.entries()) {
      pending.resolve();
      this.pendingPlaybacks.delete(audioId);
      this.rememberClosedAudioId(audioId);
      this.logger.debug({ audioId }, "Cleared pending playback");
    }
  }

  /**
   * Cleanup all pending playbacks
   */
  public cleanup(): void {
    // Reject all pending playbacks
    for (const [audioId, pending] of this.pendingPlaybacks.entries()) {
      pending.reject(new Error("Session closed"));
      this.pendingPlaybacks.delete(audioId);
      this.rememberClosedAudioId(audioId);
    }
  }
}
