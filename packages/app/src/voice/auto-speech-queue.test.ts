import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoSpeechQueue,
  type AutoSpeechItem,
  type AutoSpeechSpeaker,
} from "@/voice/auto-speech-queue";

const SERVER = "host-1";
const AGENT = "agent-1";

function item(id: string, overrides: Partial<AutoSpeechItem> = {}): AutoSpeechItem {
  return {
    groupId: `group-${id}`,
    serverId: SERVER,
    agentId: AGENT,
    text: id,
    ...overrides,
  };
}

/**
 * A speaker whose utterances only finish when the test says so - the queue's
 * whole contract is what happens *during* an utterance.
 *
 * `stop()` deliberately does NOT settle the in-flight promise. A real speaker
 * cancels a host RPC and cannot promise the round trip ever comes back, so the
 * queue must advance on its own abort rather than on the speaker's cooperation.
 */
function createSpeaker() {
  const spoken: string[] = [];
  const pending: (() => void)[] = [];
  const stop = vi.fn();
  const speaker: AutoSpeechSpeaker = {
    speak(next) {
      spoken.push(next.text);
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    },
    stop,
  };
  return {
    speaker,
    spoken,
    stop,
    /** Let the utterance in flight finish, then let the queue advance. */
    async finish() {
      pending.shift()?.();
      for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve();
      }
    },
    /** Let every queued microtask (deferred teardown, abort race) run out. */
    async settle() {
      for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve();
      }
    },
  };
}

afterEach(() => {
  autoSpeechQueue.resetForTests();
});

describe("auto-speech queue", () => {
  it("ignores messages while the mode is off", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);

    autoSpeechQueue.enqueue(item("a"));
    await harness.settle();

    expect(harness.spoken).toEqual([]);
  });

  it("speaks queued messages one after another, in order", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue(item("b"));
    autoSpeechQueue.enqueue(item("c"));
    await harness.settle();

    // Serial, not concurrent: only the head is speaking.
    expect(harness.spoken).toEqual(["a"]);
    expect(autoSpeechQueue.getSpeakingGroupId()).toBe("group-a");
    expect(autoSpeechQueue.getPendingCount()).toBe(2);

    await harness.finish();
    expect(harness.spoken).toEqual(["a", "b"]);

    await harness.finish();
    expect(harness.spoken).toEqual(["a", "b", "c"]);

    await harness.finish();
    expect(autoSpeechQueue.getSpeakingGroupId()).toBeNull();
  });

  it("never reads the same segment twice", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    // A row that remounts (scrolled back into view) offers itself again.
    autoSpeechQueue.enqueue(item("a"));
    await harness.settle();
    await harness.finish();

    expect(harness.spoken).toEqual(["a"]);
  });

  it("dedupes on the text, not the row identity", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    // A canonical timeline replace rebuilds the same prose under a fresh
    // stream-item id, so the bubble group changes but the message has not.
    autoSpeechQueue.enqueue(item("a", { groupId: "group-a-rebuilt" }));
    // Whitespace-only differences are the same message too.
    autoSpeechQueue.enqueue(item("a", { groupId: "group-a-again", text: "  a\n" }));
    await harness.settle();

    expect(harness.spoken).toEqual(["a"]);
    expect(autoSpeechQueue.getPendingCount()).toBe(0);
  });

  it("keeps hosts' messages separate", async () => {
    const harness = createSpeaker();
    const other = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.registerSpeaker("host-2", other.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);
    autoSpeechQueue.setAgentEnabled("host-2", AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue(item("a", { serverId: "host-2" }));
    await harness.settle();

    // Identical text from a different host is a different message - but there
    // is still only one speaker on the device, so it waits its turn.
    expect(harness.spoken).toEqual(["a"]);
    expect(autoSpeechQueue.getPendingCount()).toBe(1);

    await harness.finish();
    expect(other.spoken).toEqual(["a"]);
  });

  it("skips segments with nothing to say", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("blank", { text: "   \n  " }));
    await harness.settle();

    expect(harness.spoken).toEqual([]);
  });

  it("stops playback and drops the backlog when the mode is turned off", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue(item("b"));
    await harness.settle();

    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, false);
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(autoSpeechQueue.getPendingCount()).toBe(0);
    expect(autoSpeechQueue.getSpeakingGroupId()).toBeNull();

    await harness.settle();
    expect(harness.spoken).toEqual(["a"]);
  });

  it("holds for a manual playback, then resumes with what arrives next", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue(item("b"));
    await harness.settle();

    // The user presses Play on some message: the backlog is dropped, the
    // utterance in flight is silenced, and auto playback is held.
    const token = autoSpeechQueue.beginManualPlayback();
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(autoSpeechQueue.getPendingCount()).toBe(0);

    // Messages that arrive during the manual playback do not jump the hold.
    autoSpeechQueue.enqueue(item("c"));
    await harness.settle();
    expect(harness.spoken).toEqual(["a"]);

    autoSpeechQueue.endManualPlayback(token);
    await harness.settle();
    expect(harness.spoken).toEqual(["a", "c"]);
  });

  it("ignores a stale manual release", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    const first = autoSpeechQueue.beginManualPlayback();
    const second = autoSpeechQueue.beginManualPlayback();
    // The superseded playback unwinding must not release the newcomer's hold.
    autoSpeechQueue.endManualPlayback(first);

    autoSpeechQueue.enqueue(item("a"));
    await harness.settle();
    expect(harness.spoken).toEqual([]);

    autoSpeechQueue.endManualPlayback(second);
    await harness.settle();
    expect(harness.spoken).toEqual(["a"]);
  });

  it("goes quiet on stopPlayback but stays in the mode", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue(item("b"));
    await harness.settle();

    autoSpeechQueue.stopPlayback();
    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(autoSpeechQueue.getPendingCount()).toBe(0);
    await harness.settle();

    autoSpeechQueue.enqueue(item("c"));
    await harness.settle();
    expect(harness.spoken).toEqual(["a", "c"]);
  });

  it("waits for a host's speaker instead of dropping its messages", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    await harness.settle();
    expect(autoSpeechQueue.getPendingCount()).toBe(1);

    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    await harness.settle();
    expect(harness.spoken).toEqual(["a"]);
  });

  it("drops a disconnected host's queue instead of blocking the others", async () => {
    const harness = createSpeaker();
    const other = createSpeaker();
    const unregister = autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.registerSpeaker("host-2", other.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);
    autoSpeechQueue.setAgentEnabled("host-2", AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue(item("b"));
    autoSpeechQueue.enqueue(item("z", { serverId: "host-2" }));
    await harness.settle();

    // Teardown is deferred by a microtask so a re-registration can cancel it;
    // with no replacement it lands and the host's work is released.
    unregister();
    await harness.settle();
    expect(harness.stop).toHaveBeenCalledTimes(1);

    expect(other.spoken).toEqual(["z"]);
  });

  it("survives a host component re-registering mid-utterance", async () => {
    const first = createSpeaker();
    const second = createSpeaker();
    const unregister = autoSpeechQueue.registerSpeaker(SERVER, first.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue(item("b"));
    await first.settle();
    expect(first.spoken).toEqual(["a"]);

    // React tears the effect down and sets it back up: a re-render, not a
    // disconnect. Neither the utterance nor the backlog may be touched.
    unregister();
    autoSpeechQueue.registerSpeaker(SERVER, second.speaker);
    await first.settle();

    expect(first.stop).not.toHaveBeenCalled();
    expect(autoSpeechQueue.getSpeakingGroupId()).toBe("group-a");
    expect(autoSpeechQueue.getPendingCount()).toBe(1);

    // The replacement picks the queue up when the first utterance ends.
    await first.finish();
    expect(second.spoken).toEqual(["b"]);
  });

  it("keeps draining after an utterance fails", async () => {
    const failures: AutoSpeechSpeaker = {
      speak: vi
        .fn()
        .mockRejectedValueOnce(new Error("synthesis exploded"))
        .mockResolvedValue(undefined),
      stop: vi.fn(),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    autoSpeechQueue.registerSpeaker(SERVER, failures);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue(item("b"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(failures.speak).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("toggles off for one agent without affecting another", async () => {
    const harness1 = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness1.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);
    autoSpeechQueue.setAgentEnabled(SERVER, "agent-2", true);

    // Queue items from both agents.
    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue({
      groupId: "group-x",
      serverId: SERVER,
      agentId: "agent-2",
      text: "x",
    });
    await harness1.settle();

    expect(harness1.spoken).toEqual(["a"]);

    // Turn off agent-1 only - agent-2's items should still play.
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, false);
    expect(harness1.stop).toHaveBeenCalledTimes(1);
    await harness1.settle();

    // Agent-2's message should now be spoken (queue drained of agent-1 items).
    expect(harness1.spoken).toEqual(["a", "x"]);

    // New messages from agent-1 are ignored.
    autoSpeechQueue.enqueue(item("b"));
    await harness1.settle();
    expect(harness1.spoken).toEqual(["a", "x"]);
  });

  it("takes the enabled set from the settings record, absent key meaning off", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);

    autoSpeechQueue.syncEnabledAgents({ [`${SERVER}:${AGENT}`]: true });
    autoSpeechQueue.enqueue(item("a"));
    await harness.settle();
    expect(harness.spoken).toEqual(["a"]);

    // Turning the chat off DELETES its key rather than storing false, so the
    // reconcile has to read an absent key as off - a per-key loop never would.
    autoSpeechQueue.syncEnabledAgents({});
    autoSpeechQueue.enqueue(item("b"));
    await harness.settle();
    expect(harness.spoken).toEqual(["a"]);
  });

  it("keeps reading while the app is backgrounded", async () => {
    // Auto-speech is for when you are NOT looking at the screen: nothing in the
    // playback path may gate on visibility. The reveal's own off-screen snap is
    // what keeps segments arriving (see turn-reveal).
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    await harness.settle();
    expect(harness.spoken).toEqual(["a"]);
    expect(autoSpeechQueue.getPendingCount()).toBe(0);
  });

  it("does not resurrect a backlog the user dismissed", async () => {
    const harness = createSpeaker();
    autoSpeechQueue.registerSpeaker(SERVER, harness.speaker);
    autoSpeechQueue.setAgentEnabled(SERVER, AGENT, true);

    autoSpeechQueue.enqueue(item("a"));
    autoSpeechQueue.enqueue(item("b"));
    await harness.settle();

    // Play on another message empties the queue; "b" was never spoken.
    const token = autoSpeechQueue.beginManualPlayback();
    expect(autoSpeechQueue.getPendingCount()).toBe(0);
    autoSpeechQueue.endManualPlayback(token);

    // A canonical replace remounts the row and offers "b" again. It stays gone:
    // by the time the manual playback ended, that backlog was stale.
    autoSpeechQueue.enqueue(item("b", { groupId: "group-b-rebuilt" }));
    await harness.settle();
    expect(harness.spoken).toEqual(["a"]);
  });
});
