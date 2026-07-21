// App-global voice-cue host.
//
// Voice cues are the Visualizer's NOTIFICATION channel — the whole point is
// hearing that an agent started, started thinking, or finished while you are
// looking at something else entirely. Playback used to be mounted by
// `visualizer-panel.tsx` beside the event adapter, on the same `ready &&
// isVisible` gate, so it could only ever speak for the one workspace whose
// Visualizer tab happened to be frontmost. That made the feature structurally
// incapable of doing its job.
//
// This component moves playback to the app's root provider tree (mounted in
// `_layout.tsx`'s ProvidersWrapper, beside FaviconStatusSync — inside
// VoiceProvider so the shared audio engine resolves, and above the router so it
// never unmounts on a route/tab change). It renders nothing and runs no visual
// performance: the graph, the canvas, and the whole render bundle stay
// untouched and unloaded. Only the audio fires.
//
// One hook instance per connected host, because the per-server pieces it needs
// — the runtime client (TTS synthesis), the daemon config (personality roster +
// their stored cue lines), and the `visualizerVoiceCues`/`ttsPreview` capability
// flags — are all hooks. `workspaceId: null` means "every workspace on this
// host". The enable setting, the mute gate, the volume, the per-agent dedupe and
// the app-wide rate limit all live inside the hook.
//
// See docs/visualizer.md "Voice cues".
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import { useHosts } from "@/runtime/host-runtime";
import { useVisualizerVoiceCues } from "@/visualizer/use-visualizer-voice-cues";

function HostVoiceCues({ serverId }: { serverId: string }) {
  useVisualizerVoiceCues({
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
export function VisualizerVoiceCuesHost() {
  // Same central gate as openVisualizerTab: with the Visualizer feature off,
  // its notification channel is off too. This module is deliberately light (no
  // vendored render bundle in its import graph), so it can be imported eagerly.
  const visualizerEnabled = useFeatureEnabled("visualizer");
  const hosts = useHosts();

  if (!visualizerEnabled || hosts.length === 0) {
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
