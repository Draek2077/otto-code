import type { VisualizerAppearance } from "./visualizer-appearance";

// Page -> host messages the vendored bridge (vscode-bridge.ts) sends. Loosely
// typed on purpose — the bridge tolerates/ignores fields it doesn't know.
// `load-failed` is NOT a page message — the Electron view synthesizes it from
// the webview's did-fail-load so the panel can show a real failure state
// instead of an eternally-opaque load cover (a guest that never loads emits
// nothing at all otherwise; see visualizer-view.electron.tsx).
export type VisualizerHostMessage =
  | { type: "ready" }
  | { type: "load-failed"; reason?: string }
  | { type: "open-file"; filePath: string; line?: number }
  // The in-page speaker button was toggled; the host persists it as
  // visualizerSoundMuted and re-seeds it via config.soundVolume (OTTO PATCH).
  | { type: "sound-muted"; muted: boolean }
  // The in-page HUD toggle was flipped; the host persists it as
  // visualizerHudHidden and re-seeds it via config.hudHidden (OTTO PATCH).
  | { type: "hud-hidden"; hidden: boolean };

// The vendored page's SimulationEvent shape (web/lib/agent-types.ts). Payloads
// are intentionally loose records — each handle-*.ts hook in the vendored page
// reads its own subset of fields and tolerates missing ones. See
// docs/visualizer.md for the full payload-shape table; key naming is NOT
// consistent across event types (agent_spawn/agent_complete/agent_idle key
// on `name`, everything else keys on `agent`) because it mirrors the
// vendored page's own inconsistency.
export type SimulationEventType =
  | "agent_spawn"
  | "agent_complete"
  | "agent_idle"
  | "message"
  | "context_update"
  | "model_detected"
  | "tool_call_start"
  | "tool_call_end"
  | "subagent_dispatch"
  | "subagent_return"
  | "permission_requested";

export interface SimulationEvent {
  time: number;
  type: SimulationEventType;
  payload: Record<string, unknown>;
  sessionId?: string;
}

export interface VisualizerSessionInfo {
  id: string;
  label: string;
  status: "active" | "completed";
  startTime: number;
  lastActivityTime: number;
}

/** Host -> page messages, per the bridge contract in vscode-bridge.ts —
 * except `otto-appearance`, which is consumed by the Otto shell script in
 * emit-bundle.mjs (the vendor bridge ignores unknown types). */
export type VisualizerHostToPageMessage =
  | { type: "reset"; reason?: string }
  | ({ type: "otto-appearance" } & VisualizerAppearance)
  | { type: "session-list"; sessions: VisualizerSessionInfo[] }
  | { type: "session-started"; session: VisualizerSessionInfo }
  | { type: "session-ended"; sessionId: string }
  | { type: "session-updated"; sessionId: string; label: string }
  | { type: "agent-event"; event: SimulationEvent }
  | { type: "agent-event-batch"; events: SimulationEvent[] }
  | {
      type: "connection-status";
      status: "connected" | "disconnected" | "watching";
      source?: string;
    }
  | {
      type: "config";
      config: Partial<{
        mode: string;
        autoPlay: boolean;
        showMockData: boolean;
        disable1MContext: boolean;
        panels: Partial<{
          timeline: boolean;
          fileAttention: boolean;
          transcript: boolean;
          messageFeed: boolean;
          costOverlay: boolean;
          hexGrid: boolean;
        }>;
        render: Partial<{
          bloom: boolean;
          stars: boolean;
          backdrop: boolean;
        }>;
        // Master audio volume (0..1). 0 mutes; > 0 is audible at that level.
        soundVolume: number;
        // Hide the entire HUD (every panel/bar/popup) except the in-page HUD
        // toggle button. Authoritative when present (OTTO PATCH).
        hudHidden: boolean;
      }>;
    };

export interface VisualizerViewProps {
  /** Fires for every page -> host message, including the initial handshake `ready`. */
  onMessage?: (message: VisualizerHostMessage) => void;
  /** devicePixelRatio cap baked into the page shell (see
   * applyVisualizerRenderScale). Changing it reloads the guest — callers must
   * treat it as a remount (fresh `ready` handshake). Defaults to 1. */
  renderScale?: number;
  /** Palette JSON baked into the page shell (see applyVisualizerTheme /
   * resolveVisualizerTheme). Like renderScale, changing it reloads the guest
   * — callers must treat it as a remount. Absent → the vendor's own look. */
  themeJson?: string;
  /** The palette's stage background, painted on the host-side container so
   * guest load/resize never flashes a mismatched color. */
  themeBackground?: string;
}

/** Imperative host -> page channel. The adapter (task 03) drives this via ref. */
export interface VisualizerViewHandle {
  postMessage(message: VisualizerHostToPageMessage): void;
  /** Electron only — pops the guest webview's own DevTools. No-op elsewhere. */
  openDevTools?(): void;
}
