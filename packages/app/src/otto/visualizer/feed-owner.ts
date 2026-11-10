import type { SessionState } from "@/stores/session-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import type { ViewedTimelineOwner } from "@/timeline/viewed-timeline-sync";
export interface VisualizerSourceSession extends Pick<
  SessionState,
  | "hasHydratedAgents"
  | "clientGeneration"
  | "agents"
  | "agentDetails"
  | "agentStreamTail"
  | "agentStreamHead"
  | "focusedAgentId"
> {
  client: { isConnected: boolean } | null;
  viewedTimelineSync: Pick<
    ViewedTimelineOwner,
    "subscribe" | "getAgentTimelineStatus" | "replaceBackgroundAgentIds"
  > | null;
}
export interface VisualizerFeedPorts {
  readSession(): VisualizerSourceSession | undefined;
  readTabs(): readonly WorkspaceTab[];
  subscribe(listener: () => void): () => void;
  subscribeLayout(listener: () => void): () => void;
}
import type { VisualizerSession } from "@getpaseo/visualizer/contracts";
import { VisualizerBridge } from "./transport";
import { VisualizerProjector } from "./projection";
import {
  visualizerCanonicalInput,
  visualizerWorkspaceAgents,
  visualizerFocusedRoot,
  visualizerTimelineDemand,
  type VisualizerFeedSelection,
} from "./session-source";
export interface VisualizerFeedState {
  sessions: VisualizerSession[];
  focusedAgentId: string | null;
  openChats: number;
  connected: boolean;
  files: ReadonlySet<string>;
  truncated: boolean;
  reset: boolean;
}
/** Acquires current Paseo timeline demand only for this active guest lifetime.
 * Reconnect/owner replacement is a new replay frontier, not a second fetcher. */
export function createVisualizerFeed(
  workspaceId: string,
  bridge: VisualizerBridge,
  publish: (state: VisualizerFeedState) => void,
  ports: VisualizerFeedPorts,
  demo = false,
  selection: VisualizerFeedSelection | (() => VisualizerFeedSelection) = {
    selectedId: null,
    follow: true,
  },
) {
  const source = `otto:visualizer:${bridge.channel}`;
  let projector = new VisualizerProjector();
  let generation = -1;
  let owner: VisualizerSourceSession["viewedTimelineSync"] = null;
  let timelineRelease: (() => void) | null = null;
  let held = "",
    sessionSignature = "",
    frameCount = 0,
    live = true,
    queued = false,
    connected = false;
  let lastReferences: readonly unknown[] = [];
  let topology = new Map<string, string | null>();
  let disconnectedChats = -1,
    reset = false;
  const resetFrame = () => {
    projector = new VisualizerProjector();
    sessionSignature = "";
    frameCount = 0;
    lastReferences = [];
    reset = true;
    bridge.send({ type: "reset", reason: "canonical-frontier" });
  };
  const releaseDemand = () => {
    owner?.replaceBackgroundAgentIds(source, []);
    timelineRelease?.();
    timelineRelease = null;
    held = "";
  };
  const disconnect = (openChats: number) => {
    if (!connected && disconnectedChats === openChats) return;
    disconnectedChats = openChats;
    bridge.send({ type: "config", config: { paused: true } });
    if (connected)
      bridge.send({ type: "connection-status", status: "disconnected", source: "Otto host" });
    releaseDemand();
    owner = null;
    connected = false;
    generation = -1;
    lastReferences = [];
    publish({
      sessions: [],
      focusedAgentId: null,
      openChats,
      connected: false,
      files: new Set(),
      truncated: false,
      reset: false,
    });
  };
  const consume = () => {
    if (!live) return;
    const session = ports.readSession();
    const tabs = ports.readTabs();
    const openChats = tabs.filter(
      (tab) => tab.target.kind === "agent" || tab.target.kind === "draft",
    ).length;
    const available = session?.client?.isConnected === true && session.hasHydratedAgents;
    if (!available) {
      disconnect(openChats);
      return;
    }
    if (
      session.clientGeneration !== generation ||
      session.viewedTimelineSync !== owner ||
      !connected
    ) {
      releaseDemand();
      owner = session.viewedTimelineSync;
      generation = session.clientGeneration;
      resetFrame();
      bridge.send({ type: "connection-status", status: "connected", source: "Otto host" });
      bridge.send({ type: "config", config: { paused: false } });
      timelineRelease = owner?.subscribe(schedule) ?? null;
      connected = true;
    }
    const agents = visualizerWorkspaceAgents(session, tabs, workspaceId);
    const nextTopology = new Map(agents.map((agent) => [agent.id, agent.parentAgentId]));
    if (
      [...topology].some(([id, parent]) => !nextTopology.has(id) || nextTopology.get(id) !== parent)
    )
      resetFrame();
    topology = nextTopology;
    const selected = typeof selection === "function" ? selection() : selection;
    const wanted = visualizerTimelineDemand(agents, session.focusedAgentId, selected);
    const wantedSet = new Set(wanted);
    const demand = wanted.join("\0");
    if (held !== demand) {
      held = demand;
      owner?.replaceBackgroundAgentIds(source, wanted);
    }
    const references = [
      ...tabs,
      session.focusedAgentId,
      selected.selectedId,
      selected.follow,
      ...agents.flatMap((agent) => [
        agent,
        wantedSet.has(agent.id) ? session.agentStreamTail.get(agent.id) : null,
        wantedSet.has(agent.id) ? session.agentStreamHead.get(agent.id) : null,
        owner?.getAgentTimelineStatus(agent.id),
      ]),
    ];
    if (
      references.length === lastReferences.length &&
      references.every((value, index) => value === lastReferences[index])
    )
      return;
    let hydrate = lastReferences.length === 0;
    const input = visualizerCanonicalInput(session, agents, wantedSet);
    let projection = projector.update(input);
    if (frameCount + projection.events.length > 6000) {
      resetFrame();
      projection = projector.update(input);
      hydrate = true;
    }
    lastReferences = references;
    const signature = JSON.stringify(projection.sessions);
    if (signature !== sessionSignature) {
      sessionSignature = signature;
      bridge.send({ type: "session-list", sessions: projection.sessions });
    }
    if (!demo) bridge.events(projection.events, hydrate);
    frameCount += projection.events.length;
    publish({
      ...projection,
      focusedAgentId: visualizerFocusedRoot(agents, session.focusedAgentId),
      openChats,
      connected: true,
      reset,
    });
    reset = false;
  };
  function schedule() {
    if (queued || !live) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      consume();
    });
  }
  const sessions = ports.subscribe(schedule),
    layouts = ports.subscribeLayout(schedule);
  consume();
  const release = () => {
    live = false;
    sessions();
    layouts();
    releaseDemand();
    bridge.send({ type: "config", config: { paused: true, soundVolume: 0 } });
  };
  return Object.assign(release, { refresh: schedule });
}
