/**
 * VS Code Bridge — enables the visualizer to communicate with the VS Code extension host.
 *
 * When running standalone (npm run dev), this is a no-op.
 * When running inside a VS Code webview iframe, it forwards messages
 * between the React app and the extension host.
 */

export type { AgentEvent, SessionInfo, ConnectionStatus } from './bridge-types'
import type { AgentEvent, SessionInfo, ConnectionStatus } from './bridge-types'
import type { NodeShape } from './agent-types'

type InitCallback = () => void
type EventCallback = (event: AgentEvent) => void
type StatusCallback = (status: ConnectionStatus, source: string) => void
/** Which panels start visible when the host seeds an initial config (e.g. on
 * tab attach). Any subset — omitted keys keep the page's own default. */
export type PanelsConfig = Partial<{
  timeline: boolean
  fileAttention: boolean
  costOverlay: boolean
  hexGrid: boolean
}>
/** Host-toggleable canvas render controls (OTTO PATCH, see OTTO-PATCHES.md).
 * Omitted keys keep the current behavior. `bloom` is the blurred additive glow
 * pass, `stars` the parallax depth particles, `backdrop` the void fill +
 * ambient spotlight; `nodeShape` picks the agent-node silhouette (defaults to
 * the historical hexagon when omitted). */
export type RenderConfig = Partial<{
  bloom: boolean
  stars: boolean
  backdrop: boolean
  nodeShape: NodeShape
}>
type ConfigCallback = (config: Partial<{ mode: string; autoPlay: boolean; showMockData: boolean; disable1MContext: boolean; panels: PanelsConfig; render: RenderConfig; soundVolume: number; hudHidden: boolean }>) => void
type SessionCallback = (type: 'list' | 'started' | 'ended' | 'updated' | 'reset', data: SessionInfo[] | SessionInfo | string | { sessionId: string; label: string }) => void

class VSCodeBridge {
  private _isVSCode = false
  private _status: ConnectionStatus = 'disconnected'
  private _source = ''

  private initListeners: InitCallback[] = []
  private eventListeners: EventCallback[] = []
  private statusListeners: StatusCallback[] = []
  private configListeners: ConfigCallback[] = []
  private sessionListeners: SessionCallback[] = []

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

      case 'agent-event-batch':
        for (const event of data.events) {
          for (const cb of this.eventListeners) {
            cb(event)
          }
        }
        break

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

  /** OTTO PATCH (OTTO-PATCHES.md): report the in-page HUD visibility toggle
   * back to the host so it can persist the preference (device-local
   * `visualizerHudHidden`) and re-seed every Visualizer tab via
   * `config.hudHidden`. Mirrors `setSoundMuted`. */
  setHudHidden(hidden: boolean): void {
    this.postToExtension({ type: 'hud-hidden', hidden })
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
  }
}

// Singleton — safe to import from anywhere
export const vscodeBridge = typeof window !== 'undefined' ? new VSCodeBridge() : null
