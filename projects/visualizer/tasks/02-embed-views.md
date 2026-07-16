# Task 02 — tri-platform embed + host bridge transport

Render the built Visualizer shell (`packages/app/src/visualizer/visualizer-bundle.gen.ts`, export `VISUALIZER_HTML`) inside the `visualizer` panel on web, Electron, and native, with a bidirectional message bridge. Model everything on the artifact HTML views.

## Read first

- [projects/visualizer/visualizer.md](../visualizer.md) — bridge contract, risks (CSP! hidden-pane rAF!)
- Precedents: `packages/app/src/components/artifacts/artifact-html-view.web.tsx`, `.electron.tsx`, `.tsx` (native), and `packages/app/src/components/browser-pane.electron.tsx` for driving an Electron `<webview>` guest.
- The page side is already built: `packages/visualizer/src/otto-entry.tsx` documents the transports it accepts.

## Component: `packages/app/src/visualizer/visualizer-view.{web,electron,native or base}.tsx`

Platform-split via Metro extensions (CLAUDE.md Platform gating). Props: `onMessage(msg)` (receives `ready`, `open-file`) and an imperative `postMessage(msg)` handle (ref) the adapter (task 03) will use.

- **Web:** sandboxed `<iframe srcDoc={VISUALIZER_HTML} sandbox="allow-scripts">` (no `allow-same-origin`). Host→page: `iframeRef.contentWindow.postMessage(msg, "*")`. Page→host: `window.addEventListener("message", ...)` filtered to the iframe's source. This path needs zero page cooperation — the entry falls back to `window.parent.postMessage`.
- **Electron:** `<webview>` on its own partition (e.g. `"otto-visualizer"`), fed via `data:text/html` like `artifact-html-view.electron.tsx`. **Do not use an iframe — the app-shell CSP (`script-src 'self'`) blocks the inline bundle.** Host→page: `webview.executeJavaScript(...)` dispatching a `MessageEvent` on `window` (`window.dispatchEvent(new MessageEvent('message', {data: ...}))`). Page→host: inject `window.__ottoVisualizerPost = (m) => console.log("__OTTO_VIS__" + JSON.stringify(m))` on `dom-ready` and parse `console-message` events with that prefix (or a nicer channel if browser-pane already has one — check `browser-webview-resident.ts`). The entry re-checks `__ottoVisualizerPost` on every post, so injecting after load is fine.
- **Native:** `react-native-webview` `<WebView source={{ html: VISUALIZER_HTML }} originWhitelist={[]} javaScriptEnabled ...>` like the native artifact view. Host→page: `webviewRef.injectJavaScript("window.dispatchEvent(new MessageEvent('message',{data:" + JSON.stringify(msg) + "}));true;")`. Page→host: `onMessage` (the entry sends JSON strings via `window.ReactNativeWebView.postMessage`).

## Requirements

- **Lazy-load the bundle:** `VISUALIZER_HTML` is ~360 KB — `require()` it inside the panel component (or a lazy module getter), never at module top level of anything imported at startup.
- **Handshake:** after the page's `ready` message (or webview load), send `{type:'connection-status', status:'connected', source:'otto'}` and any initial `config`. Batching, sessions, and events are task 03's job — but wire a `postMessage` path now.
- **Verify with the demo scenario:** temporarily (or via a dev-only affordance) send `{type:'config', config:{mode:'replay', autoPlay:true, showMockData:true}}` and confirm the built-in mock scenario animates (agent nodes, tool calls, particles) in a **visible** pane on web + Electron at minimum. Phase 0 could not verify animation because hidden panes never fire `requestAnimationFrame` — this is the first place it can actually be seen. Screenshot proof.
- Rebuild the bundle if needed: `npm run build:visualizer` (root).

## Gotchas

- Hidden/backgrounded webviews stop rAF ⇒ the page freezes; on tab refocus the adapter re-flushes (task 03). Nothing to fix here, just don't misdiagnose it.
- Keep the WebView/webview mounted while the tab exists (don't unmount on blur) or accumulated page state is lost — mirror whatever the artifact/browser panels do about keep-alive.
- `npm run typecheck`, `npm run lint`, `npm run format` after changes.
