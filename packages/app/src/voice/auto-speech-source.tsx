// Where auto-speech gets its material — and why it is NOT the message row.
//
// It used to be: every assistant bubble offered itself to the queue as its
// typewriter reveal caught up. That reads well and is completely wrong about
// lifetime. A message row exists only while its chat is on screen, so switching
// to another chat tore down the only thing that could feed the queue and the
// chat you walked away from went silent mid-reply — the one moment the feature
// is supposed to earn its keep. Nothing about "read this agent aloud" is a
// property of what happens to be rendered.
//
// So the producer is mounted per ENABLED CHAT by `AutoSpeechHost`, at the app
// root, and reads the same store buffers the chat view renders from. It lives
// exactly as long as the mode does: turn the toggle on and it starts watching,
// turn it off and it stops. Whether you are looking at that chat never enters
// into it.
//
// Two things the row-driven version got for free that this one has to buy:
//
//   * It RETAINS the agent's stream buffers (`useAgentStreamRetention`). Those
//     are evicted for agents no mounted surface is showing, and a producer that
//     let its own source be reclaimed would be a slower version of the same bug.
//   * "Read what you WATCHED being written, never history" is now a turn latch
//     rather than a render-time one. A turn is adopted only if this producer sees
//     it RUNNING; anything else that lands in the buffers — the history page
//     fetched when you open the chat, a reconnect replaying the timeline, a
//     catch-up after eviction — belongs to some other turn and is never spoken.
//     Adopting also marks whatever that turn had already written as handled, so
//     arming the mode mid-reply reads from the next paragraph on, not from the
//     top. Without this, mounting against empty buffers and then loading history
//     would have read the whole chat aloud.
//
// What it no longer waits for is the typewriter. A segment is speakable when the
// model has moved past it, not when the reveal has finished drawing it — there is
// no reveal at all for a chat that is not on screen. The two never visibly
// diverge: the reveal paces in the thousands of characters per second while
// synthesis answers in fractions of one, so the text is always already there by
// the time the speaker reaches it.
import { useEffect, useMemo, useRef } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useAgentStreamRetention } from "@/timeline/use-agent-stream-retention";
import type { StreamItem } from "@/types/stream";
import { finishedAssistantSegments } from "@/voice/auto-speech-segments";
import { autoSpeechQueue } from "@/voice/auto-speech-queue";

const EMPTY_ITEMS: readonly StreamItem[] = [];

/** One chat's auto-speech feed. Headless; mounted only while the mode is on. */
export function ChatAutoSpeechSource({ serverId, agentId }: { serverId: string; agentId: string }) {
  useAgentStreamRetention(serverId, agentId);
  const status = useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId)?.status);
  const tail = useSessionStore((state) => state.sessions[serverId]?.agentStreamTail.get(agentId));
  const head = useSessionStore((state) => state.sessions[serverId]?.agentStreamHead.get(agentId));

  const settledTurnKeyRef = useRef<string | null>(null);
  // The turn this producer is reading, adopted only while it was RUNNING.
  const watchedTurnRef = useRef<string | null>(null);
  // Segments already offered from that turn. Reset with it, so it cannot grow
  // past one reply and an old segment can never fall out and be read twice.
  const handledRef = useRef(new Set<string>());

  useEffect(() => {
    const running = status === "running";
    const { turnKey, segments, settledTurnKey } = finishedAssistantSegments({
      tail: tail ?? EMPTY_ITEMS,
      head: head ?? EMPTY_ITEMS,
      running,
      settledTurnKey: settledTurnKeyRef.current,
    });
    settledTurnKeyRef.current = settledTurnKey;

    if (watchedTurnRef.current !== turnKey) {
      if (!running) {
        // A turn we never saw being written: history arriving, a reconnect
        // replaying, a catch-up after eviction. Not ours to read.
        return;
      }
      // Adopt it — and everything it had already written before we looked was
      // written before the mode applied to it.
      watchedTurnRef.current = turnKey;
      handledRef.current = new Set(segments.map((segment) => segment.key));
      return;
    }

    for (const segment of segments) {
      if (handledRef.current.has(segment.key)) {
        continue;
      }
      handledRef.current.add(segment.key);
      autoSpeechQueue.enqueue({
        groupId: segment.groupId,
        serverId,
        agentId,
        text: segment.text,
      });
    }
  }, [agentId, head, serverId, status, tail]);

  return null;
}

/**
 * Mount one source per chat with auto-speech on. Splitting the settings keys
 * here keeps `${serverId}:${agentId}` a detail of the places that build it.
 */
export function AutoSpeechSources({ enabledAgents }: { enabledAgents: Record<string, boolean> }) {
  const chats = useMemo(() => {
    const parsed: { key: string; serverId: string; agentId: string }[] = [];
    for (const [key, enabled] of Object.entries(enabledAgents)) {
      if (!enabled) {
        continue;
      }
      const separator = key.indexOf(":");
      if (separator <= 0 || separator === key.length - 1) {
        continue;
      }
      parsed.push({
        key,
        serverId: key.slice(0, separator),
        agentId: key.slice(separator + 1),
      });
    }
    return parsed;
  }, [enabledAgents]);

  return (
    <>
      {chats.map((chat) => (
        <ChatAutoSpeechSource key={chat.key} serverId={chat.serverId} agentId={chat.agentId} />
      ))}
    </>
  );
}
