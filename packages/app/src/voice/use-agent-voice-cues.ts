// Agent voice cues — speaks a short line in the agent's own personality voice at
// four moments: it JOINS (spawns), it FIRST starts thinking, it finishes its own
// turn while its observed sub-agents are still running (WAITING), and it
// COMPLETES a turn. Only the main (root) agent speaks, only for
// personality-backed agents, only on a host that advertises both the
// visualizerVoiceCues + ttsPreview capabilities, and only when the user has
// enabled it (and not muted it).
//
// NOT A VISUALIZER FEATURE. Cues were born there and the wire capability flag
// still carries the old `visualizerVoiceCues` name, but everything they need —
// agent status, the personality roster, its stored lines, a TTS voice — is agent
// state. Nothing here reads the graph, and disabling the Visualizer does not
// silence them; the switch is in Settings -> <host> -> Agents.
//
// PLAYBACK IS APP-GLOBAL, NOT PANEL-SCOPED: the whole point is hearing that
// something happened while you are looking at something else. This hook is
// mounted once per connected host by `agent-voice-cues-host.tsx` (a headless
// component in the app's root provider tree), with `workspaceId: null` meaning
// "every workspace on this host".
//
// The lines are PRE-STORED on the personality (`voiceCues`, authored/edited in
// the personality editor) — this hook just reads them, no runtime generation.
// A personality with no stored cues stays silent. Audio is synthesized with the
// personality's TTS voice via the same `previewTtsVoice` + shared voice audio
// engine the voice-preview button uses, scaled to the cue channel's own volume.
//
// Attach behavior: agents that already exist when the hook starts watching —
// including ones a directory refresh backfills into the store moments later
// (createdAt predates attach) — are SEEDED SILENTLY, so connecting to a host
// never re-announces history. Only agents that spawn / think / finish while
// you're watching speak. See docs/agent-personalities.md "Voice cues".
import { Buffer } from "buffer";
import { useEffect, useRef } from "react";
import type {
  AgentPersonality,
  AgentPersonalityVoiceCues,
  CueMoment,
} from "@otto-code/protocol/messages";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useAppSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { hasRunningObservedSubagent } from "@/subagents/select";
import { formatToMimeType } from "@/voice/audio-format";
import type { AudioEngine } from "@/voice/audio-engine-types";

type HostClient = NonNullable<ReturnType<typeof useHostRuntimeClient>>;

interface AgentCueState {
  joined: boolean;
  thoughtOnce: boolean;
  prevStatus: Agent["status"] | null;
  /**
   * The parent's turn ended while its observed sub-agents were still running:
   * the "done" cue is DEFERRED until the fan-out drains (see processAgent).
   * Cleared when "done" finally speaks, or when a new turn starts.
   */
  doneDeferred: boolean;
  /** "waiting" already spoke for this deferral — say it once, not per tick. */
  waitingAnnounced: boolean;
}

function newCueState(): AgentCueState {
  return {
    joined: false,
    thoughtOnce: false,
    prevStatus: null,
    doneDeferred: false,
    waitingAnnounced: false,
  };
}

// Coalesce duplicate fires of the same cue across hook instances (one per
// connected host) and rapid store re-emits. Long enough to swallow
// a burst, short enough that a genuine later turn's "done" still speaks.
const CUE_DEDUPE_MS = 1500;

// Module-level so all panels share one recent-cue guard.
const recentCue = new Map<string, number>();

// Global rate limit. Because cues fire app-wide, the failure mode the charter
// calls out is real: every agent in every workspace on every host hitting a cue
// moment at the same instant. `engine.isPlaying()` already serializes playback,
// but it only rejects cues that overlap an *in-flight* line — a burst of short
// lines would still queue up back-to-back into a chorus. This is the second
// gate: at most one cue may START per window, app-wide. Dropped, never queued
// — a stale "Done" arriving 30s late is worse than silence.
const CUE_GLOBAL_MIN_INTERVAL_MS = 2500;
let lastGlobalCueAtMs = 0;

/** Reserve the app-wide cue slot, or refuse. Claims the slot on success so two
 * simultaneous callers can't both pass. */
function claimGlobalCueSlot(nowMs: number): boolean {
  if (nowMs - lastGlobalCueAtMs < CUE_GLOBAL_MIN_INTERVAL_MS) {
    return false;
  }
  lastGlobalCueAtMs = nowMs;
  return true;
}

/** Test seam — the module-level throttle/dedupe state is global by design. */
export function __resetAgentVoiceCueThrottleForTests(): void {
  recentCue.clear();
  lastGlobalCueAtMs = 0;
}

function personalityFor(
  roster: readonly AgentPersonality[] | undefined,
  personalityId: string,
): AgentPersonality | undefined {
  return roster?.find((p) => p.id === personalityId);
}

function resolveVoice(
  personality: AgentPersonality | undefined,
): { provider?: string; model?: string; name: string } | undefined {
  const voice = personality?.voice;
  return voice?.name
    ? { provider: voice.provider, model: voice.model, name: voice.name }
    : undefined;
}

// The voice audio engine has no per-play volume, but the TTS default is signed
// 16-bit PCM, so apply the cue channel's level by scaling each sample by
// `agentVoiceCuesVolume/100` — linear amplitude, the same shape the Visualizer
// page's gain node uses for its own (separate) effects channel. Only PCM can be
// scaled here; a non-PCM format (e.g. mp3) plays unscaled. `gain >= 1` is a
// no-op (return the buffer as-is).
function applyPcm16Gain(bytes: Buffer, gain: number): Buffer {
  if (gain >= 1) {
    return bytes;
  }
  const out = Buffer.from(bytes);
  const samples = new Int16Array(out.buffer, out.byteOffset, Math.floor(out.byteLength / 2));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain)));
  }
  return out;
}

function pickLine(cues: AgentPersonalityVoiceCues, kind: CueMoment): string | null {
  const lines = cues[kind];
  if (!lines || lines.length === 0) {
    return null;
  }
  return lines[Math.floor(Math.random() * lines.length)] ?? null;
}

async function speak(
  engine: AudioEngine,
  client: HostClient,
  input: {
    text: string;
    voice?: { provider?: string; model?: string; name: string };
    /** 0..1 — the agent voice-cue channel's volume (0 → silence). */
    gain: number;
  },
): Promise<void> {
  // Never talk over an in-flight cue (or voice-mode playback) — cues are soft
  // and short; a skipped one is better than a chorus.
  if (engine.isPlaying() || input.gain <= 0) {
    return;
  }
  // Kick the AudioContext resume off early (web autoplay unlock is best-effort
  // here — cues fire without a fresh user gesture, so the very first may be
  // silent until the user has interacted with the app once).
  void engine.initialize().catch(() => undefined);
  const result = await client.previewTtsVoice({
    text: input.text,
    ...(input.voice ? { voice: input.voice } : {}),
  });
  if (result.error || !result.audio || engine.isPlaying()) {
    return;
  }
  const format = result.format ?? "pcm";
  const raw = Buffer.from(result.audio, "base64");
  const bytes = format.startsWith("pcm") ? applyPcm16Gain(raw, input.gain) : raw;
  await engine.initialize();
  if (engine.isPlaying()) {
    return;
  }
  await engine.play({
    type: formatToMimeType(format),
    size: bytes.byteLength,
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  });
}

/** Root agents on the host — every workspace when `workspaceId` is null,
 * optionally scoped to a run's id set. */
function selectRootAgents(
  serverId: string,
  workspaceId: string | null,
  agentIdFilter: ReadonlySet<string> | null,
): Agent[] {
  const agents = useSessionStore.getState().sessions[serverId]?.agents;
  if (!agents) {
    return [];
  }
  const roots: Agent[] = [];
  for (const agent of agents.values()) {
    if (agent.parentAgentId) {
      continue;
    }
    if (workspaceId !== null && agent.workspaceId !== workspaceId) {
      continue;
    }
    if (agentIdFilter && !agentIdFilter.has(agent.id)) {
      continue;
    }
    roots.push(agent);
  }
  return roots;
}

/**
 * True when the root agent's observed fan-out is still running — the second
 * half of the "waiting" condition (the first half is its own turn finalizing).
 * Reads the same track membership the subagents rail renders from, so "still
 * running" means exactly the rows the user can see under this chat.
 */
function hasRunningSubagents(serverId: string, parentAgentId: string): boolean {
  const agents = useSessionStore.getState().sessions[serverId]?.agents;
  return agents ? hasRunningObservedSubagent(agents, parentAgentId) : false;
}

export interface UseAgentVoiceCuesInput {
  serverId: string;
  /** null = every workspace on this host (the app-global host's mode). */
  workspaceId: string | null;
  /** Master gate. The app-global host passes `true` — cues are meant to fire
   * whether or not any Visualizer surface is mounted. */
  active: boolean;
  agentIdFilter?: ReadonlySet<string> | null;
}

export function useAgentVoiceCues(input: UseAgentVoiceCuesInput): void {
  const { serverId, workspaceId, active, agentIdFilter = null } = input;
  const client = useHostRuntimeClient(serverId);
  const engine = useVoiceAudioEngineOptional();
  const { settings } = useAppSettings();
  const { config } = useDaemonConfig(serverId);

  const features = useSessionStore((state) => state.sessions[serverId]?.serverInfo?.features);
  // COMPAT(visualizerVoiceCues): added in v0.6.3, drop the gate when floor >= v0.6.3.
  // The flag keeps its original name because it is a wire capability — cues
  // stopped being a Visualizer feature, but renaming a `server_info.features`
  // key would break the contract with older daemons.
  const featureOk = Boolean(features?.visualizerVoiceCues && features?.ttsPreview);
  // Two separate gates on purpose: `agentVoiceCues` is whether the feature is
  // configured at all, `agentVoiceCuesMuted` is the header button's "not right
  // now". Either one stops playback.
  const enabled = settings.agentVoiceCues && !settings.agentVoiceCuesMuted;

  // Roster + volume changes shouldn't tear down the subscription; read them at
  // fire time. Cues are their OWN audio channel: the Visualizer's sound volume
  // and its speaker-button mute are ambience for a graph you are watching and
  // have no say over a notification that fires while you are somewhere else.
  const rosterRef = useRef<readonly AgentPersonality[] | undefined>(undefined);
  rosterRef.current = config?.agentPersonalities?.personalities;
  const gainRef = useRef(1);
  gainRef.current = settings.agentVoiceCuesVolume / 100;

  useEffect(() => {
    if (!active || !enabled || !featureOk || !client || !engine) {
      return;
    }
    const states = new Map<string, AgentCueState>();
    const disposed = { value: false };
    const watchStartMs = Date.now();

    // Pre-existing agents are seeded silently: joined, and (when currently
    // running) already "thought", so attaching to an in-flight session never
    // replays cues.
    const seedSilently = (agent: Agent): void => {
      states.set(agent.id, {
        ...newCueState(),
        joined: true,
        thoughtOnce: agent.status === "running",
        prevStatus: agent.status,
      });
    };

    // Silent seed: everything already present is treated as already-watched.
    for (const agent of selectRootAgents(serverId, workspaceId, agentIdFilter)) {
      seedSilently(agent);
    }

    const fireCue = (agent: Agent, kind: CueMoment): void => {
      const personalityId = agent.personalityId;
      if (!personalityId) {
        return;
      }
      const personality = personalityFor(rosterRef.current, personalityId);
      const cues = personality?.voiceCues;
      if (!cues) {
        return;
      }
      const line = pickLine(cues, kind);
      if (!line) {
        return;
      }
      const key = `${serverId}:${agent.id}:${kind}`;
      const now = Date.now();
      const last = recentCue.get(key);
      if (last !== undefined && now - last < CUE_DEDUPE_MS) {
        return;
      }
      // App-wide rate limit, checked LAST so a cue that has no line to speak
      // (no personality, no stored cues) never burns the slot for one that does.
      if (!claimGlobalCueSlot(now)) {
        return;
      }
      recentCue.set(key, now);
      const voice = resolveVoice(personality);
      void speak(engine, client, {
        text: line,
        gain: gainRef.current,
        ...(voice ? { voice } : {}),
      });
    };

    const processAgent = (agent: Agent): void => {
      let state = states.get(agent.id);
      if (!state) {
        // A record landing in the store isn't necessarily a NEW agent: the
        // directory refresh upserts pre-existing chats
        // moments after this effect's initial seed. `createdAt` is the
        // daemon-stamped spawn time, so anything created before we started
        // watching is history — seed it silently instead of announcing a
        // spurious join. (Cues are soft; daemon/client clock skew at worst
        // costs or replays a single join line.)
        if (agent.createdAt.getTime() <= watchStartMs) {
          seedSilently(agent);
          return;
        }
        // Genuinely new agent that spawned while watching — announce its join.
        state = newCueState();
        states.set(agent.id, state);
      }
      if (!state.joined) {
        state.joined = true;
        state.prevStatus = agent.status;
        fireCue(agent, "join");
        return; // one cue per tick — thinking follows on the next reconcile
      }
      if (agent.status === "running") {
        // A new turn supersedes any deferred "done" from the previous one.
        state.doneDeferred = false;
        state.waitingAnnounced = false;
      }
      if (!state.thoughtOnce && agent.status === "running") {
        state.thoughtOnce = true;
        state.prevStatus = agent.status;
        fireCue(agent, "thinking");
        return;
      }
      // Finalizing a turn puts the agent in debt for a "done" cue — but the
      // fan-out it spawned may still be running, and an agent whose helpers are
      // out isn't done, it's WAITING. So the edge only records the debt; the
      // block below decides whether to pay it now or hold it.
      if (state.prevStatus === "running" && agent.status === "idle") {
        state.doneDeferred = true;
        state.waitingAnnounced = false;
      }
      state.prevStatus = agent.status;
      if (state.doneDeferred && agent.status === "idle") {
        if (hasRunningSubagents(serverId, agent.id)) {
          // Announce the wait once per idle stretch (observed rows land over
          // several store ticks, so this branch runs repeatedly), then hold the
          // "done" — a later tick finds the fan-out drained and pays it.
          if (!state.waitingAnnounced) {
            state.waitingAnnounced = true;
            fireCue(agent, "waiting");
          }
          return;
        }
        state.doneDeferred = false;
        state.waitingAnnounced = false;
        fireCue(agent, "done");
      }
    };

    const unsubscribe = useSessionStore.subscribe((current, previous) => {
      if (disposed.value) {
        return;
      }
      // Cheap gate: the store installs a fresh agents Map only when it changes.
      if (current.sessions[serverId]?.agents === previous.sessions[serverId]?.agents) {
        return;
      }
      for (const agent of selectRootAgents(serverId, workspaceId, agentIdFilter)) {
        processAgent(agent);
      }
    });

    return () => {
      disposed.value = true;
      unsubscribe();
    };
  }, [active, enabled, featureOk, client, engine, serverId, workspaceId, agentIdFilter]);
}
