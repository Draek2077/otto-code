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
  // A page keyboard shortcut (t/f/$/s) asked to toggle a panel. Host settings
  // are the source of truth for panel visibility (config.panels), so the page
  // forwards the request instead of flipping page-local state — the host flips
  // the matching device-local setting and the change round-trips back to the
  // page via the config.panels push (OTTO PATCH).
  | { type: "panel-toggle"; panel: "timeline" | "files" | "cost" | "stats" }
  // The page's live session list + selection, mirrored to the host so the Otto
  // toolbar's chats dropdown can render + drive them (OTTO PATCH). Emitted
  // whenever the page's sessions, selection, or unseen-activity set changes.
  | {
      type: "session-state";
      sessions: { id: string; label: string; status: "active" | "completed" }[];
      selectedId: string | null;
      activityIds: string[];
    };

// The vendored page's SimulationEvent shape (web/lib/agent-types.ts). Payloads
// are intentionally loose records — each handle-*.ts hook in the vendored page
// reads its own subset of fields and tolerates missing ones. See
// docs/visualizer.md for the full payload-shape table; key naming is NOT
// consistent across event types (agent_spawn/agent_complete/agent_idle key
// on `name`, everything else keys on `agent`) because it mirrors the
// vendored page's own inconsistency.
export type SimulationEventType =
  | "agent_spawn"
  | "agent_rename"
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
  // `hydrate: true` marks a batch as backfilled history the user did NOT watch
  // happen live (the initial attach / visibility-regain reset+replay). The page
  // applies it to the settled end state instead of animating each event (no
  // spawn/tool bursts, no sound, transient tool cards / message bubbles dropped)
  // — the full event content still lands in the timeline + per-node chat panels.
  // Absent/false = a live batch, animated normally. See docs/visualizer.md
  // "Hydrate on attach" and vendor OTTO-PATCHES.md.
  | { type: "agent-event-batch"; events: SimulationEvent[]; hydrate?: boolean }
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
          costOverlay: boolean;
          // Per-node stats readout overlay, driven by the toolbar's "Toggle
          // Stats" button (OTTO PATCH).
          stats: boolean;
        }>;
        render: Partial<{
          bloom: boolean;
          // Per-node glow halo, distinct from the whole-viewport bloom pass
          // (OTTO PATCH).
          nodeGlow: boolean;
          stars: boolean;
          backdrop: boolean;
          // Agent-node silhouette. Omitted → the page's historical hexagon
          // (OTTO PATCH).
          nodeShape: "square" | "hexagon" | "octagon" | "circle";
          // Bottom-right HUD FPS meter (OTTO PATCH).
          showFps: boolean;
        }>;
        // Master audio volume (0..1). 0 mutes; > 0 is audible at that level.
        soundVolume: number;
        // Hide the entire HUD (every panel/bar/popup) except the in-page HUD
        // toggle button. Authoritative when present (OTTO PATCH).
        hudHidden: boolean;
      }>;
    }
  // Remote-control the page's session switcher from the Otto toolbar (OTTO
  // PATCH). The page owns the session state machine; these just drive the same
  // selectSession / removeSession paths a HUD tab click used.
  | { type: "select-session"; sessionId: string }
  | { type: "close-session"; sessionId: string }
  // One-shot viewport actions from the Otto toolbar's "Zoom to Fit" / "Restart"
  // buttons (OTTO PATCH). Stateless — the page just runs the action. The
  // stateful counterparts (grid/stats toggles) flow through config.panels.
  | { type: "viewport-command"; action: "zoom-to-fit" | "restart" };

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
