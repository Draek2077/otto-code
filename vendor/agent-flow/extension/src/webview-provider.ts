import * as vscode from 'vscode'
import * as crypto from 'crypto'
import {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  AgentEvent,
} from './protocol'
import {
  BRIDGE_INIT_MAX_RETRIES, BRIDGE_INIT_RETRY_MS, DEFAULT_DEV_PORT, NONCE_LENGTH, NONCE_CHARS,
  WEBVIEW_BG_COLOR, WEBVIEW_LOADING_TEXT, WEBVIEW_LOADING_TEXT_DIM,
} from './constants'

function getNonce(): string {
  const bytes = crypto.randomBytes(NONCE_LENGTH)
  const chars = NONCE_CHARS
  let text = ''
  for (let i = 0; i < NONCE_LENGTH; i++) {
    text += chars.charAt(bytes[i] % chars.length)
  }
  return text
}

export class VisualizerPanel implements vscode.Disposable {
  public static readonly viewType = 'agentVisualizer'
  private static instance: VisualizerPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly extensionUri: vscode.Uri
  private readonly disposables: vscode.Disposable[] = []
  private readonly _onCommand = new vscode.EventEmitter<WebviewToExtensionMessage>()
  private _wired = false
  private _ready = false

  readonly onCommand = this._onCommand.event

  /** Returns true if wirePanel has already been called on this instance */
  get isWired(): boolean { return this._wired }
  markWired(): void { this._wired = true }

  /** Whether the webview has signaled 'ready' and replay is complete.
   *  Live events should be gated on this to prevent duplication with replay. */
  get isReady(): boolean { return this._ready }
  markReady(): void { this._ready = true }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel
    this.extensionUri = extensionUri

    this.panel.webview.html = this.getHtml()

    // Listen for messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => {
        this._onCommand.fire(message)
      },
      undefined,
      this.disposables,
    )

    // Cleanup on dispose
    this.panel.onDidDispose(
      () => {
        VisualizerPanel.instance = undefined
        this.dispose()
      },
      undefined,
      this.disposables,
    )
  }

  static create(extensionUri: vscode.Uri, column: vscode.ViewColumn): VisualizerPanel {
    if (VisualizerPanel.instance) {
      VisualizerPanel.instance.panel.reveal(column)
      return VisualizerPanel.instance
    }

    const panel = vscode.window.createWebviewPanel(
      VisualizerPanel.viewType,
      'Agent Flow',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      },
    )

    panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'media', 'icon-light.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'media', 'icon-dark.svg'),
    }

    VisualizerPanel.instance = new VisualizerPanel(panel, extensionUri)
    return VisualizerPanel.instance
  }

  static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): VisualizerPanel {
    VisualizerPanel.instance = new VisualizerPanel(panel, extensionUri)
    return VisualizerPanel.instance
  }

  static getCurrent(): VisualizerPanel | undefined {
    return VisualizerPanel.instance
  }

  /** Send a typed message to the webview (fails silently if panel is disposed) */
  postMessage(message: ExtensionToWebviewMessage): void {
    try {
      this.panel.webview.postMessage(message)
    } catch {
      // Panel may have been disposed between check and send — safe to ignore
    }
  }

  /** Send an agent event to the webview */
  sendEvent(event: AgentEvent): void {
    this.postMessage({ type: 'agent-event', event })
  }

  /** Update connection status display */
  setConnectionStatus(status: 'connected' | 'disconnected' | 'watching', source: string): void {
    this.postMessage({ type: 'connection-status', status, source })
  }

  private getHtml(): string {
    const isDev = this.isDevelopmentMode()

    if (isDev) {
      return this.getDevHtml()
    }
    return this.getProductionHtml()
  }

  private isDevelopmentMode(): boolean {
    // Only use dev mode if the user explicitly set a port in settings
    const config = vscode.workspace.getConfiguration('agentVisualizer')
    const port = config.get<number>('devServerPort', 0)
    return port > 0
  }

  private getDevHtml(): string {
    const config = vscode.workspace.getConfiguration('agentVisualizer')
    const port = config.get<number>('devServerPort', DEFAULT_DEV_PORT)
    const nonce = getNonce()

    // In dev mode, load the Next.js app via iframe
    // The bridge script in the iframe communicates with the parent via postMessage
    return `<!DOCTYPE html>
<html lang="en" style="height:100%; margin:0; padding:0;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      frame-src http://localhost:${port} https://localhost:${port};
      script-src 'nonce-${nonce}';
      style-src 'unsafe-inline';"
  />
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: ${WEBVIEW_BG_COLOR}; }
    iframe { width: 100%; height: 100%; border: none; }
    .connecting {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
      color: ${WEBVIEW_LOADING_TEXT}; text-align: center;
    }
    .connecting .dot { animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
  </style>
</head>
<body>
  <div class="connecting" id="loading">
    <div>CONNECTING TO DEV SERVER</div>
    <div class="dot" style="margin-top: 8px;">●</div>
    <div style="margin-top: 8px; font-size: 10px; color: ${WEBVIEW_LOADING_TEXT_DIM};">localhost:${port}</div>
  </div>
  <iframe id="app-frame" src="http://localhost:${port}" style="display:none;"></iframe>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const iframe = document.getElementById('app-frame');
      const loading = document.getElementById('loading');
      let iframeReady = false;
      let pendingMessages = [];

      // Show iframe once loaded, then keep sending bridge-init until acked
      iframe.addEventListener('load', () => {
        loading.style.display = 'none';
        iframe.style.display = 'block';

        // The React app may not have mounted yet, so retry the init message
        let initAttempts = 0;
        const initInterval = setInterval(() => {
          if (iframeReady || initAttempts > ${BRIDGE_INIT_MAX_RETRIES}) {
            clearInterval(initInterval);
            return;
          }
          iframe.contentWindow.postMessage({ type: '__vscode-bridge-init', source: 'extension' }, '*');
          initAttempts++;
        }, ${BRIDGE_INIT_RETRY_MS});
      });

      // Single unified message handler
      window.addEventListener('message', (e) => {
        if (e.source === iframe.contentWindow) {
          // Message from iframe → forward to extension host
          if (e.data && e.data.type === 'ready') {
            iframeReady = true;
            // Flush any pending messages
            for (const msg of pendingMessages) {
              iframe.contentWindow.postMessage(msg, '*');
            }
            pendingMessages = [];
          }
          vscode.postMessage(e.data);
        } else {
          // Message from extension host → forward to iframe
          if (iframeReady) {
            iframe.contentWindow.postMessage(e.data, '*');
          } else {
            pendingMessages.push(e.data);
          }
        }
      });

      // Tell extension we're ready (outer frame ready, not iframe)
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`
  }

  private getProductionHtml(): string {
    const webview = this.panel.webview
    const nonce = getNonce()

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.js'),
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.css'),
    )

    return `<!DOCTYPE html>
<html lang="en" class="dark" style="height:100%; margin:0; padding:0;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      style-src ${webview.cspSource} 'unsafe-inline';
      img-src ${webview.cspSource} https: data:;
      font-src ${webview.cspSource} data:;
      script-src 'nonce-${nonce}';"
  />
  <link rel="stylesheet" href="${styleUri}">
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: ${WEBVIEW_BG_COLOR}; }
    #root { height: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  dispose(): void {
    VisualizerPanel.instance = undefined
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
    this._onCommand.dispose()
  }
}
