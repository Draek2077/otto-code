// Visualizer voice cues — speaks a short line in the agent's own personality
// voice at three moments: its node JOINS the graph, it FIRST starts thinking,
// and it COMPLETES a turn. Only the main (root) agent speaks, only for
// personality-backed agents, only on a host that advertises both the
// visualizerVoiceCues + ttsPreview capabilities, and only when the user has
// enabled it (and not muted it).
//
// The lines are PRE-STORED on the personality (`voiceCues`, authored/edited in
// the personality editor) — this hook just reads them, no runtime generation.
// A personality with no stored cues stays silent. Audio is synthesized with the
// personality's TTS voice via the same `previewTtsVoice` + shared voice audio
// engine the voice-preview button uses, scaled to the Visualizer sound volume.
//
// Attach behavior mirrors the visualizer's hydrate/settle: agents that already
// exist when the hook starts watching — including ones the adapter's directory
// refresh backfills into the store moments later (createdAt predates attach) —
// are SEEDED SILENTLY, so opening the Visualizer never re-announces history.
// Only agents that spawn / think / finish while you're watching speak. See
// docs/visualizer.md "Voice cues".
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
import { formatToMimeType } from "@/voice/audio-format";
import type { AudioEngine } from "@/voice/audio-engine-types";

type HostClient = NonNullable<ReturnType<typeof useHostRuntimeClient>>;

interface AgentCueState {
  joined: boolean;
  thoughtOnce: boolean;
  prevStatus: Agent["status"] | null;
}

// Coalesce duplicate fires of the same cue across hook instances (e.g. two
// visible Visualizer panels) and rapid store re-emits. Long enough to swallow
// a burst, short enough that a genuine later turn's "done" still speaks.
const CUE_DEDUPE_MS = 1500;

// Module-level so all panels share one recent-cue guard.
const recentCue = new Map<string, number>();

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

// Match the Visualizer's sound-effect volume pipeline: the voice audio engine
// has no per-play volume, but the TTS default is signed 16-bit PCM, so scale
// each sample by the same `muted ? 0 : volume/100` gain the vendor page applies
// to its effects (config.soundVolume) — linear amplitude, same as the page's
// gain node. Only PCM can be scaled here; a non-PCM format (e.g. mp3) plays
// unscaled. `gain >= 1` is a no-op (return the buffer as-is).
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
    /** 0..1 — the Visualizer sound volume (muted → 0). */
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

/** Root agents in the workspace, optionally scoped to a run's id set. */
function selectRootAgents(
  serverId: string,
  workspaceId: string,
  agentIdFilter: ReadonlySet<string> | null,
): Agent[] {
  const agents = useSessionStore.getState().sessions[serverId]?.agents;
  if (!agents) {
    return [];
  }
  const roots: Agent[] = [];
  for (const agent of agents.values()) {
    if (agent.workspaceId !== workspaceId || agent.parentAgentId) {
      continue;
    }
    if (agentIdFilter && !agentIdFilter.has(agent.id)) {
      continue;
    }
    roots.push(agent);
  }
  return roots;
}

export interface UseVisualizerVoiceCuesInput {
  serverId: string;
  workspaceId: string;
  /** Same gate as the adapter: page ready AND pane visible. */
  active: boolean;
  agentIdFilter?: ReadonlySet<string> | null;
}

export function useVisualizerVoiceCues(input: UseVisualizerVoiceCuesInput): void {
  const { serverId, workspaceId, active, agentIdFilter = null } = input;
  const client = useHostRuntimeClient(serverId);
  const engine = useVoiceAudioEngineOptional();
  const { settings } = useAppSettings();
  const { config } = useDaemonConfig(serverId);

  const features = useSessionStore((state) => state.sessions[serverId]?.serverInfo?.features);
  // COMPAT(visualizerVoiceCues): added in v0.6.3, drop the gate when floor >= v0.6.3.
  const featureOk = Boolean(features?.visualizerVoiceCues && features?.ttsPreview);
  const enabled = settings.visualizerVoiceCues && !settings.visualizerSoundMuted;

  // Roster + volume changes shouldn't tear down the subscription; read them at
  // fire time. The gain mirrors visualizer-panel.tsx's config.soundVolume
  // exactly (`muted ? 0 : volume/100`), so cues track the same Sound slider as
  // the effects.
  const rosterRef = useRef<readonly AgentPersonality[] | undefined>(undefined);
  rosterRef.current = config?.agentPersonalities?.personalities;
  const gainRef = useRef(1);
  gainRef.current = settings.visualizerSoundMuted ? 0 : settings.visualizerSoundVolume / 100;

  useEffect(() => {
    if (!active || !enabled || !featureOk || !client || !engine) {
      return;
    }
    const states = new Map<string, AgentCueState>();
    const disposed = { value: false };
    const watchStartMs = Date.now();

    // Pre-existing agents are seeded silently: joined, and (when currently
    // running) already "thought", so attaching the Visualizer to an in-flight
    // session never replays cues.
    const seedSilently = (agent: Agent): void => {
      states.set(agent.id, {
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
        // visualizer adapter's directory refresh upserts pre-existing chats
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
        state = { joined: false, thoughtOnce: false, prevStatus: null };
        states.set(agent.id, state);
      }
      if (!state.joined) {
        state.joined = true;
        state.prevStatus = agent.status;
        fireCue(agent, "join");
        return; // one cue per tick — thinking follows on the next reconcile
      }
      if (!state.thoughtOnce && agent.status === "running") {
        state.thoughtOnce = true;
        state.prevStatus = agent.status;
        fireCue(agent, "thinking");
        return;
      }
      if (state.prevStatus === "running" && agent.status === "idle") {
        state.prevStatus = agent.status;
        fireCue(agent, "done");
        return;
      }
      state.prevStatus = agent.status;
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
