// Auto-speech — read incoming assistant prose aloud, in order, as it lands.
//
// The composer's speaker toggle turns it on. From then on every assistant bubble
// segment is queued the moment it is FINAL (the model has moved past it and the
// typewriter reveal has caught up) and spoken one after another. Synthesis is
// slower than generation, so the queue IS the feature: playback falls behind and
// drains at its own pace instead of dropping lines or talking over itself.
//
// Why a module singleton rather than a hook or a store slice: there is exactly
// one speaker on the device. Two chats streaming side by side have to share one
// serial queue or they talk over each other — and the call sites that must reach
// it (a message row deep in a virtualized list, the composer toggle, the
// per-bubble playback button) share no React ancestor short of the app root.
//
// This module holds no way to make a sound. `registerSpeaker` — one per
// connected host, from auto-speech-host.tsx — injects that: the runtime client,
// the shared audio engine, the agent's personality voice. What is left here is
// pure control flow, which is what makes the interruption rules testable.
//
// The interruption rules, which are the whole design:
//   * Toggling auto-speech off aborts the current utterance and empties the
//     queue. Immediately — a mode you turned off must go quiet at once.
//   * Pressing Play on any message TAKES OVER: the queue is emptied and auto
//     playback is held until that manual playback ends, then resumes with
//     whatever arrives next. Deliberately not with the backlog the user
//     interrupted — by the time they finish listening, it is stale.
//   * Pressing the button on the message auto-speech is currently reading stops
//     it and empties the queue without leaving the mode.
import { useSyncExternalStore } from "react";

export interface AutoSpeechItem {
  /** The visual bubble the segment belongs to; what the UI marks as speaking. */
  groupId: string;
  serverId: string;
  /** Selects the speaking agent's personality voice; omitted uses host default. */
  agentId?: string;
  text: string;
}

export interface AutoSpeechSpeaker {
  /** Resolves when the utterance finished, was canceled, or failed. */
  speak(item: AutoSpeechItem): Promise<void>;
  /** Aborts whatever is speaking right now. */
  stop(): void;
}

// The accepted set outlives every message row it came from, so it is capped:
// without a bound a long session's dedupe set grows forever. Oldest-first, the
// same shape as the assistant-bubble text registry's group cap.
const MAX_TRACKED_KEYS = 512;

/**
 * What "the same message" means for dedupe: its TEXT, not its stream-item id.
 *
 * Ids are not stable. A canonical timeline replace rebuilds a finished turn's
 * items with freshly derived ids, so the row remounts and offers the identical
 * prose again under a new identity. Keying on the id let that through, and
 * because the host's `speakMessage` cancels whatever is playing before it
 * starts, the duplicate did not queue politely behind the original — it cut it
 * off and restarted from sentence one, over and over.
 *
 * The trade: a reply that repeats itself verbatim within the last
 * MAX_TRACKED_KEYS segments is read once. That is the right way to be wrong.
 */
function fingerprint(serverId: string, text: string): string {
  const normalized = text.trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${serverId}:${normalized.length.toString(36)}:${(hash >>> 0).toString(36)}`;
}

class AutoSpeechQueue {
  private enabled = false;
  private queue: AutoSpeechItem[] = [];
  private active: AutoSpeechItem | null = null;
  /** Non-null while a manual playback owns the speaker. */
  private manualToken: number | null = null;
  private nextManualToken = 1;
  private draining = false;
  /**
   * Resolves the drain loop's escape hatch for the utterance in flight. The loop
   * races the speaker's promise against this one, so an abort advances the queue
   * at once instead of waiting on a speaker that may never settle after being
   * told to stop.
   */
  private abortGate: (() => void) | null = null;
  private readonly speakers = new Map<string, AutoSpeechSpeaker>();
  /** Every message ever queued — a rebuilt row must not read itself twice. */
  private readonly accepted = new Set<string>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  isEnabled = (): boolean => this.enabled;

  /** The bubble currently being read by auto-speech, or null. */
  getSpeakingGroupId = (): string | null => this.active?.groupId ?? null;

  /** Queued and not yet started — the backlog the user can hear coming. */
  getPendingCount = (): number => this.queue.length;

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (!enabled) {
      this.queue = [];
      this.abortActive();
    }
    this.emit();
    void this.drain();
  }

  registerSpeaker(serverId: string, speaker: AutoSpeechSpeaker): () => void {
    this.speakers.set(serverId, speaker);
    void this.drain();
    return () => {
      if (this.speakers.get(serverId) !== speaker) {
        return;
      }
      // DEFERRED, and that is the point. React tears an effect down before it
      // sets the replacement up, so a re-render (or a hot reload, or StrictMode)
      // looks identical to a disconnect at this instant. Tearing down eagerly
      // aborted the utterance in flight every time the host component's effect
      // churned. A microtask is long enough for the replacement to land and
      // short enough that a real disconnect still drains promptly.
      queueMicrotask(() => {
        if (this.speakers.get(serverId) !== speaker) {
          return;
        }
        // Abort before deregistering, so the abort still reaches this speaker.
        if (this.active?.serverId === serverId) {
          this.abortActive();
        }
        this.speakers.delete(serverId);
        // Nothing left that can voice this host's queued items, and a stuck
        // head would block every other host behind it.
        this.queue = this.queue.filter((item) => item.serverId !== serverId);
        this.emit();
        void this.drain();
      });
    };
  }

  /**
   * Offer a finished message segment. Silently ignored when auto-speech is off,
   * when the segment has already been offered, or when it has nothing to say —
   * callers are message rows and must not have to know the mode's state.
   */
  enqueue(item: AutoSpeechItem): void {
    if (!this.enabled || !item.text.trim()) {
      return;
    }
    const key = fingerprint(item.serverId, item.text);
    if (this.accepted.has(key)) {
      return;
    }
    this.accepted.add(key);
    while (this.accepted.size > MAX_TRACKED_KEYS) {
      const oldest = this.accepted.values().next().value;
      if (oldest === undefined) {
        break;
      }
      this.accepted.delete(oldest);
    }
    this.queue.push(item);
    this.emit();
    void this.drain();
  }

  /**
   * A manual playback is taking the speaker. Empties the queue, silences the
   * utterance in flight, and holds auto playback until the returned token is
   * handed back to `endManualPlayback`.
   */
  beginManualPlayback(): number {
    const token = this.nextManualToken++;
    this.manualToken = token;
    this.queue = [];
    this.abortActive();
    this.emit();
    return token;
  }

  /** Release the hold — but only if this playback still owns it. */
  endManualPlayback(token: number): void {
    if (this.manualToken !== token) {
      return;
    }
    this.manualToken = null;
    this.emit();
    void this.drain();
  }

  /** Shut up now, without leaving the mode: the next message still speaks. */
  stopPlayback(): void {
    this.queue = [];
    this.abortActive();
    this.emit();
  }

  private abortActive(): void {
    const active = this.active;
    // Let the drain loop go even if the speaker's promise never settles.
    this.abortGate?.();
    this.abortGate = null;
    if (!active) {
      return;
    }
    this.active = null;
    this.speakers.get(active.serverId)?.stop();
  }

  /**
   * One utterance at a time, forever. `draining` is the serialization: every
   * mutation calls this, and all but the first return immediately, so the loop
   * that is already awaiting a `speak` picks the new work up when it comes back
   * around.
   */
  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.enabled && this.manualToken === null) {
        const next = this.queue[0];
        if (!next) {
          break;
        }
        const speaker = this.speakers.get(next.serverId);
        if (!speaker) {
          // The host has not registered yet (or is reconnecting). Leave the item
          // queued; `registerSpeaker` drains again.
          break;
        }
        this.queue.shift();
        this.active = next;
        this.emit();
        const utterance = speaker.speak(next).catch((error: unknown) => {
          console.warn("[AutoSpeech] utterance failed:", error);
        });
        await Promise.race([
          utterance,
          new Promise<void>((resolve) => {
            this.abortGate = resolve;
          }),
        ]);
        this.abortGate = null;
        // `abortActive` may already have cleared it for someone else's claim;
        // only the still-current item is ours to retire.
        if (this.active === next) {
          this.active = null;
        }
        this.emit();
      }
    } finally {
      this.draining = false;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Test seam — the singleton is global by design. */
  resetForTests(): void {
    this.enabled = false;
    this.queue = [];
    this.active = null;
    this.manualToken = null;
    this.abortGate?.();
    this.abortGate = null;
    this.draining = false;
    this.speakers.clear();
    this.accepted.clear();
    this.listeners.clear();
  }
}

export const autoSpeechQueue = new AutoSpeechQueue();

/** True while auto-speech is reading this bubble. Always false without a key. */
export function useIsAutoSpeechSpeaking(groupId: string | undefined): boolean {
  const speaking = useSyncExternalStore(
    autoSpeechQueue.subscribe,
    autoSpeechQueue.getSpeakingGroupId,
    autoSpeechQueue.getSpeakingGroupId,
  );
  return groupId !== undefined && speaking === groupId;
}

/** Whether the auto-speech mode is on. */
export function useAutoSpeechActive(): boolean {
  return useSyncExternalStore(
    autoSpeechQueue.subscribe,
    autoSpeechQueue.isEnabled,
    autoSpeechQueue.isEnabled,
  );
}
