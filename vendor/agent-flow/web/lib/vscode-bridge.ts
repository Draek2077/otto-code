/**
 * VS Code Bridge — enables the visualizer to communicate with the VS Code extension host.
 *
 * When running standalone (npm run dev), this is a no-op.
 * When running inside a VS Code webview iframe, it forwards messages
 * between the React app and the extension host.
 */

export type { AgentEvent, SessionInfo, ConnectionStatus } from './bridge-types'
import type { AgentEvent, SessionInfo, ConnectionStatus } from './bridge-types'
import type { ContextDisplay, NodeShape } from './agent-types'

type InitCallback = () => void
type EventCallback = (event: AgentEvent) => void
type StatusCallback = (status: ConnectionStatus, source: string) => void
/** Which panels start visible when the host seeds an initial config (e.g. on
 * tab attach). Any subset — omitted keys keep the page's own default. */
export type PanelsConfig = Partial<{
  timeline: boolean
  fileAttention: boolean
  costOverlay: boolean
  // OTTO PATCH (OTTO-PATCHES.md): per-node stats readout overlay. Seeded from
  // the host's `visualizerPanelStats` device-local setting so the Otto toolbar's
  // "Toggle Stats" button is a config-driven follower like the other panels.
  stats: boolean
}>
/** OTTO PATCH (OTTO-PATCHES.md): host -> page one-shot viewport actions, driven
 * by the Otto toolbar's "Zoom to Fit" / "Restart" buttons — the imperative
 * counterparts of the panel toggles (which flow through `config.panels`). These
 * carry no state; the page just runs the action. */
export type ViewportCommand = 'zoom-to-fit' | 'restart'
/** OTTO PATCH (OTTO-PATCHES.md): the panels a page keyboard shortcut can ask
 * the host to toggle (page -> host `panel-toggle` — see `togglePanel`). */
export type TogglablePanel = 'timeline' | 'files' | 'cost' | 'stats'
/** Host-toggleable canvas render controls (OTTO PATCH, see OTTO-PATCHES.md).
 * Omitted keys keep the current behavior. `bloom` is the whole-viewport blurred
 * additive pass (a soft blurry echo of the scene), `nodeGlow` the per-agent-node
 * halo sprite (distinct from `bloom` — the tight glow hugging each node), `stars`
 * the parallax depth particles, `backdrop` the void fill + ambient spotlight;
 * `nodeShape` picks the agent-node silhouette (defaults to the historical hexagon
 * when omitted); `showFps` renders the bottom-right HUD FPS meter;
 * `contextDisplay` picks whether the main agent reports context occupancy as
 * the ring or the bar (they are the same number — upstream drew both). */
export type RenderConfig = Partial<{
  bloom: boolean
  nodeGlow: boolean
  stars: boolean
  backdrop: boolean
  nodeShape: NodeShape
  showFps: boolean
  contextDisplay: ContextDisplay
}>
/** OTTO PATCH (OTTO-PATCHES.md): auto-fit framing profile. The camera's
 * constants were tuned for a full-tab viewport; Otto's PIP renders the same
 * scene into a ~260x160 box and needs its own values. Omitted keys keep the
 * tab-tuned defaults. */
export type CameraConfig = Partial<{
  viewportPadding: number
  autoFitMaxScale: number
}>
type ConfigCallback = (config: Partial<{ mode: string; autoPlay: boolean; showMockData: boolean; disable1MContext: boolean; panels: PanelsConfig; render: RenderConfig; camera: CameraConfig; soundVolume: number; hudHidden: boolean; hudBottomHidden: boolean; hudCompact: boolean }>) => void
type SessionCallback = (type: 'list' | 'started' | 'ended' | 'updated' | 'reset', data: SessionInfo[] | SessionInfo | string | { sessionId: string; label: string }) => void
/** OTTO PATCH (OTTO-PATCHES.md): host -> page session commands, driven by the
 * Otto toolbar's chats dropdown (select a chat / close a chat). The page runs
 * the same selectSession / removeSession it used for its own HUD tabs. */
type SessionCommandCallback = (command: 'select' | 'close', sessionId: string) => void
/** OTTO PATCH (OTTO-PATCHES.md): host -> page viewport commands from the Otto
 * toolbar (zoom to fit / restart the simulation). */
type ViewportCommandCallback = (command: ViewportCommand) => void
/** OTTO PATCH: the page's live session state, mirrored to the host so the Otto
 * toolbar can render the chats dropdown. */
export interface SessionStateReport {
  sessions: { id: string; label: string; status: SessionInfo['status'] }[]
  selectedId: string | null
  activityIds: string[]
}

class VSCodeBridge {
  private _isVSCode = false
  private _status: ConnectionStatus = 'disconnected'
  private _source = ''

  private initListeners: InitCallback[] = []
  private eventListeners: EventCallback[] = []
  private statusListeners: StatusCallback[] = []
  private configListeners: ConfigCallback[] = []
  private sessionListeners: SessionCallback[] = []
  private sessionCommandListeners: SessionCommandCallback[] = []
  private viewportCommandListeners: ViewportCommandCallback[] = []

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleMessage)
    }
  }

  private handleMessage = (e: MessageEvent) => {
    const data = e.data
    if (!data || typeof data.type !== 'string') { return }

    switch (data.type) {
      case '__vscode-bridge-init':
        this._isVSCode = true
        this.postToExtension({ type: 'ready' })
        for (const cb of this.initListeners) cb()
        this.initListeners = [] // one-shot: no need to keep listeners after init
        break

      case 'agent-event':
        for (const cb of this.eventListeners) {
          cb(data.event)
        }
        break

      case 'agent-event-batch': {
        // OTTO PATCH (OTTO-PATCHES.md): a batch flagged `hydrate` is backfilled
        // history (attach / visibility-regain replay). Stamp each event so the
        // simulation settles it to the end state instead of animating it.
        const hydrate = data.hydrate === true
        for (const event of data.events) {
          const stamped = hydrate ? { ...event, hydrate: true } : event
          for (const cb of this.eventListeners) {
            cb(stamped)
          }
        }
        break
      }

      case 'connection-status':
        this._status = data.status
        this._source = data.source || ''
        for (const cb of this.statusListeners) {
          cb(this._status, this._source)
        }
        break

      case 'config':
        for (const cb of this.configListeners) {
          cb(data.config)
        }
        break

      case 'reset':
        for (const cb of this.sessionListeners) {
          cb('reset', data.reason || 'panel-reopened')
        }
        break

      case 'session-list':
        for (const cb of this.sessionListeners) {
          cb('list', data.sessions)
        }
        break

      case 'session-started':
        for (const cb of this.sessionListeners) {
          cb('started', data.session)
        }
        break

      case 'session-ended':
        for (const cb of this.sessionListeners) {
          cb('ended', data.sessionId)
        }
        break

      case 'session-updated':
        for (const cb of this.sessionListeners) {
          cb('updated', { sessionId: data.sessionId, label: data.label })
        }
        break

      // OTTO PATCH (OTTO-PATCHES.md): host -> page session commands from the
      // Otto toolbar's chats dropdown.
      case 'select-session':
        for (const cb of this.sessionCommandListeners) {
          cb('select', data.sessionId)
        }
        break

      case 'close-session':
        for (const cb of this.sessionCommandListeners) {
          cb('close', data.sessionId)
        }
        break

      // OTTO PATCH (OTTO-PATCHES.md): host -> page viewport command from the
      // Otto toolbar's "Zoom to Fit" / "Restart" buttons.
      case 'viewport-command':
        for (const cb of this.viewportCommandListeners) {
          cb(data.action)
        }
        break
    }
  }

  get isVSCode(): boolean {
    return this._isVSCode
  }

  // ─── Subscribe to events ─────────────────────────────────────────────────

  private subscribe<T>(listeners: T[], callback: T): () => void {
    listeners.push(callback)
    return () => {
      const idx = listeners.indexOf(callback)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }

  /** Subscribe to bridge init. If already initialized, fires synchronously. */
  onInit(callback: InitCallback): () => void {
    if (this._isVSCode) {
      callback()
      return () => {} // already fired, nothing to unsubscribe
    }
    return this.subscribe(this.initListeners, callback)
  }

  onEvent(callback: EventCallback): () => void {
    return this.subscribe(this.eventListeners, callback)
  }

  onStatus(callback: StatusCallback): () => void {
    return this.subscribe(this.statusListeners, callback)
  }

  onConfig(callback: ConfigCallback): () => void {
    return this.subscribe(this.configListeners, callback)
  }

  onSession(callback: SessionCallback): () => void {
    return this.subscribe(this.sessionListeners, callback)
  }

  /** OTTO PATCH: subscribe to host -> page session commands (select/close a
   * chat) from the Otto toolbar. */
  onSessionCommand(callback: SessionCommandCallback): () => void {
    return this.subscribe(this.sessionCommandListeners, callback)
  }

  /** OTTO PATCH: subscribe to host -> page viewport commands (zoom to fit /
   * restart) from the Otto toolbar. */
  onViewportCommand(callback: ViewportCommandCallback): () => void {
    return this.subscribe(this.viewportCommandListeners, callback)
  }

  // ─── Send commands to extension ──────────────────────────────────────────

  openFile(filePath: string, line?: number): void {
    this.postToExtension({ type: 'open-file', filePath, line })
  }

  /** OTTO PATCH (OTTO-PATCHES.md): report the in-page mute toggle back to the
   * host so it can persist the preference (device-local `visualizerSoundMuted`)
   * and re-seed it on the next visualizer open. Mirrors `openFile`'s page->host
   * post; the host echoes the resulting master volume back via `config.soundVolume`. */
  setSoundMuted(muted: boolean): void {
    this.postToExtension({ type: 'sound-muted', muted })
  }

  /** OTTO PATCH (OTTO-PATCHES.md): ask the host to toggle a panel's
   * visibility. The host's settings are the source of truth for panel
   * visibility (they seed `config.panels`), so a page keyboard shortcut must
   * not flip page-local state when a host is attached — it would desync the
   * host's toolbar and get snapped back by the next config push. The host
   * flips the matching setting and the change round-trips via `config.panels`.
   * No-op when no host bridge is attached (postToExtension guards on it). */
  togglePanel(panel: TogglablePanel): void {
    this.postToExtension({ type: 'panel-toggle', panel })
  }

  /** OTTO PATCH (OTTO-PATCHES.md): mirror the page's live session list +
   * selection + unseen-activity set to the host, so the Otto toolbar's chats
   * dropdown can render and drive them. Emitted whenever any of these change. */
  reportSessionState(report: SessionStateReport): void {
    this.postToExtension({ type: 'session-state', ...report })
  }

  private postToExtension(message: Record<string, unknown>): void {
    if (this._isVSCode && typeof window !== 'undefined') {
      // When inside VS Code iframe, post to parent (the webview frame)
      window.parent.postMessage(message, '*')
    }
  }

  /** Configure the bridge for direct VS Code webview API (production build). */
  configureWebviewApi(postMessage: (msg: Record<string, unknown>) => void): void {
    this._isVSCode = true
    this.postToExtension = (msg: Record<string, unknown>) => {
      postMessage(msg)
    }
    for (const cb of this.initListeners) cb()
    this.initListeners = []
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.handleMessage)
    }
    this.initListeners = []
    this.eventListeners = []
    this.statusListeners = []
    this.configListeners = []
    this.sessionListeners = []
    this.sessionCommandListeners = []
    this.viewportCommandListeners = []
  }
}

// Singleton — safe to import from anywhere
export const vscodeBridge = typeof window !== 'undefined' ? new VSCodeBridge() : null
