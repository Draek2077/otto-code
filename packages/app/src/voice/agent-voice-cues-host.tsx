// App-global voice-cue host.
//
// Voice cues are an AGENT notification channel — the whole point is hearing that
// an agent started, started thinking, is waiting on its sub-agents, or finished
// while you are looking at something else entirely. They shipped inside the
// Visualizer (the graph was the first surface that wanted them) and were briefly
// mounted by `visualizer-panel.tsx` on the same `ready && isVisible` gate, so
// they could only ever speak for the one workspace whose Visualizer tab happened
// to be frontmost. That made the feature structurally incapable of doing its
// job, so playback moved here — and once it lives here, nothing about it is
// about the Visualizer any more. There is no graph in this module's import
// graph, and no `useFeatureEnabled("visualizer")` gate: turning the Visualizer
// off is a decision about a *renderer*, not about whether your agents may speak.
// The cue lines come from the personality (authored in the personality editor),
// the moments come from agent status, and the switch lives in Settings ->
// <host> -> Agents. See docs/agent-personalities.md "Voice cues".
//
// Mounted in `_layout.tsx`'s ProvidersWrapper, beside FaviconStatusSync — inside
// VoiceProvider so the shared audio engine resolves, and above the router so it
// never unmounts on a route/tab change. It renders nothing and runs no visual
// performance; only the audio fires.
//
// One hook instance per connected host, because the per-server pieces it needs
// — the runtime client (TTS synthesis), the daemon config (personality roster +
// their stored cue lines), and the `visualizerVoiceCues`/`ttsPreview` capability
// flags — are all hooks. `workspaceId: null` means "every workspace on this
// host". The enable setting, the mute gate, the volume, the per-agent dedupe and
// the app-wide rate limit all live inside the hook.
import { useHosts } from "@/runtime/host-runtime";
import { useAgentVoiceCues } from "@/voice/use-agent-voice-cues";

function HostVoiceCues({ serverId }: { serverId: string }) {
  useAgentVoiceCues({
    serverId,
    // Every workspace on this host — cues are not scoped to what's on screen.
    workspaceId: null,
    // Always on. The real gating (setting, mute, host capabilities) is inside
    // the hook; there is deliberately no visibility/focus condition here.
    active: true,
  });
  return null;
}

/** Headless. Mounted once per app session. */
export function AgentVoiceCuesHost() {
  const hosts = useHosts();

  if (hosts.length === 0) {
    return null;
  }

  return (
    <>
      {hosts.map((host) => (
        <HostVoiceCues key={host.serverId} serverId={host.serverId} />
      ))}
    </>
  );
}
