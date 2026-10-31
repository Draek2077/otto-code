import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSettings } from "@/hooks/use-settings";
import { useHostFeature } from "@/runtime/host-features";
import { speechAgentKey } from "./preferences";
import { speechDevicePreferences } from "./device";
import { createSpeechSegments } from "./segments";
import type { SpeechPlayback } from "./playback";
import type { Agent } from "@/stores/session-store";
import type { SessionState } from "@/stores/session-store";
const sameFeed = (previous: readonly unknown[] | null, next: readonly unknown[]) =>
  previous !== null && previous.every((value, index) => value === next[index]);
function cueState(agent: Agent) {
  if (agent.pendingPermissions.length) return "waiting";
  return agent.turn.phase === "open" ? "thinking" : "done";
}
const sameHosts = (previous: string[], next: string[]) =>
  previous.length === next.length && previous.every((host, index) => host === next[index]);
function canPlayHostCues(session: SessionState | undefined): session is SessionState {
  return (
    session?.client?.isConnected === true &&
    session.hasHydratedAgents &&
    session.serverInfo?.capabilities?.voice?.voice?.enabled === true
  );
}

function ChatSpeechSource({
  serverId,
  agentId,
  playback,
}: {
  serverId: string;
  agentId: string;
  playback: SpeechPlayback;
}) {
  const available = useHostFeature(serverId, "ottoSpeech");
  const owner = useSessionStore((state) => state.sessions[serverId]?.viewedTimelineSync);
  const generation = useSessionStore((state) => state.sessions[serverId]?.clientGeneration);
  useEffect(() => {
    if (!available || !owner) return;
    const source = `otto:speech:${agentId}`;
    const prefix = `${speechAgentKey(serverId, agentId)}:auto:`;
    const feed = createSpeechSegments();
    let ready = false;
    let lastFeed: readonly unknown[] | null = null;
    const consume = () => {
      const session = useSessionStore.getState().sessions[serverId];
      if (
        !session?.client?.isConnected ||
        !session.hasHydratedAgents ||
        owner.getAgentTimelineStatus(agentId) !== "ready"
      ) {
        ready = false;
        return;
      }
      const agent = session.agents.get(agentId) ?? session.agentDetails.get(agentId);
      if (!agent) return;
      const identity = [
        session.agentStreamTail.get(agentId),
        session.agentStreamHead.get(agentId),
        agent.turn,
      ];
      if (ready && sameFeed(lastFeed, identity)) return;
      lastFeed = identity;
      const active = agent.turn.phase === "open" ? agent.turn.turnId : null;
      const items = [
        ...(session.agentStreamTail.get(agentId) ?? []),
        ...(session.agentStreamHead.get(agentId) ?? []),
      ];
      if (!ready) {
        feed.update(items, active);
        ready = true;
        return;
      }
      for (const segment of feed.update(items, active))
        playback.speak({
          hostId: serverId,
          key: prefix + segment.key,
          itemId: segment.itemId,
          text: segment.text,
          automatic: true,
        });
    };
    owner.replaceBackgroundAgentIds(source, [agentId]);
    const unsubscribe = useSessionStore.subscribe(consume);
    const timeline = owner.subscribe(consume);
    consume();
    return () => {
      unsubscribe();
      timeline();
      owner.replaceBackgroundAgentIds(source, []);
      playback.cancelKey(prefix);
    };
  }, [available, owner, generation, serverId, agentId, playback]);
  return null;
}

function HostVoiceCues({ serverId, playback }: { serverId: string; playback: SpeechPlayback }) {
  const available = useHostFeature(serverId, "ottoSpeech");
  useEffect(() => {
    if (!available) return;
    const before = new Map<string, string>();
    let initialized = false;
    let lastAgents: SessionState["agents"] | null = null;
    const consume = () => {
      const session = useSessionStore.getState().sessions[serverId];
      // The module can be available while the user has disabled voice. Cues
      // must not submit background synthesis requests in that state.
      if (!canPlayHostCues(session)) {
        initialized = false;
        before.clear();
        lastAgents = null;
        return;
      }
      if (initialized && session.agents === lastAgents) return;
      lastAgents = session.agents;
      const preferences = speechDevicePreferences();
      for (const agent of session.agents.values()) {
        if (agent.archivedAt || agent.status === "closed") continue;
        const state = cueState(agent);
        const previous = before.get(agent.id);
        before.set(agent.id, state);
        if (
          !initialized ||
          previous === state ||
          !preferences.agentVoiceCues ||
          preferences.agentVoiceCuesMuted ||
          preferences.agentAutoSpeechEnabled[speechAgentKey(serverId, agent.id)]
        )
          continue;
        const line =
          previous === undefined
            ? "Starting!"
            : { thinking: "Thinking...", waiting: "Waiting...", done: "Complete!" }[state];
        playback.speak({
          hostId: serverId,
          key: `${serverId}:${agent.id}:cue:${state}`,
          text: line,
          cue: true,
          automatic: true,
        });
      }
      initialized = true;
      for (const id of before.keys()) if (!session.agents.has(id)) before.delete(id);
    };
    const unsubscribe = useSessionStore.subscribe(consume);
    consume();
    return () => {
      unsubscribe();
      playback.cancelKey(`${serverId}:`);
    };
  }, [available, serverId, playback]);
  return null;
}

export function AutoSpeechSources({ playback }: { playback: SpeechPlayback }) {
  const enabled = useSettings((settings) => settings.agentAutoSpeechEnabled);
  const cuesAudible = useSettings(
    (settings) => settings.agentVoiceCues && !settings.agentVoiceCuesMuted,
  );
  useEffect(() => {
    if (!cuesAudible) playback.cancelCues();
  }, [cuesAudible, playback]);
  const [hosts, setHosts] = useState(() => Object.keys(useSessionStore.getState().sessions));
  useEffect(
    () =>
      useSessionStore.subscribe((state) => {
        const next = Object.keys(state.sessions);
        setHosts((previous) => (sameHosts(previous, next) ? previous : next));
      }),
    [],
  );
  const chats = useMemo(
    () =>
      Object.entries(enabled).flatMap(([key, value]) => {
        const separator = key.indexOf(":");
        return value && separator > 0 && separator < key.length - 1
          ? [{ key, serverId: key.slice(0, separator), agentId: key.slice(separator + 1) }]
          : [];
      }),
    [enabled],
  );
  return (
    <>
      {chats.map((chat) => (
        <ChatSpeechSource
          key={chat.key}
          serverId={chat.serverId}
          agentId={chat.agentId}
          playback={playback}
        />
      ))}
      {hosts.map((serverId) => (
        <HostVoiceCues key={serverId} serverId={serverId} playback={playback} />
      ))}
    </>
  );
}
