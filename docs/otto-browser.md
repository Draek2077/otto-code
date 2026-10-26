# Otto browser

Desktop browser tabs retain Paseo's resident webview, panel descriptor and browser
profile ownership. Otto additions live under `packages/app/src/otto/browser/` and
`packages/desktop/src/otto/browser/`, with marked composition seams in the existing
panel, main process and preload.

## Tab icons

The tab shows a Globe while its icon is unavailable or loading. Desktop main
resolves the page-declared favicon first, then `/favicon.ico` on the page's origin.
Requests use the attached guest's session, or the same persistent browser profile
when a restored tab has not attached yet. Cookies stay in that profile.

The IPC handler accepts only an app window's main frame. HTTP(S) URLs cannot
contain user information; file and script URLs are rejected. Inline image URLs
are allowed. Main caps decoded image bodies at 256 KiB, applies an eight-second
request timeout, validates the image media type and returns a data URL. Unlabeled
or octet-stream responses need a recognized image signature. Remote HTML and JSON
responses are rejected.

Main and renderer caches each retain at most 256 results and coalesce concurrent
lookups. Fetch failures remain cached for two minutes. There is no retry timer or
background polling; a later lookup may retry an expired failure. If the renderer
cannot decode a returned image, the tab returns to its Globe and remembers that
failure until its icon identity changes or the cache entry is evicted. The
renderer never fetches the guest's remote icon URL directly.

The preload import for the request shape is type-only. The compiled sandbox
preload continues to load only Electron at runtime.

## Verification boundaries

Focused fixtures cover candidate validation, byte/type limits, timeout and cache
behavior, owning-frame IPC admission, and renderer cache failure handling.
`packages/desktop/src/preload-sandbox.test.ts` checks the compiled preload import
boundary. These tests do not establish real image decoding or native tab
rendering. The existing [Browser Capture Harness](browser-capture-harness.md)
documents the separate real-Electron compositor checks.

## More actions and page search

Paseo's Back, Forward, Reload/Stop, viewport presets, DevTools, annotation and
element screenshot controls keep their visible toolbar positions. More contains
Find in page and Open in external browser. The latter accepts ordinary HTTP(S)
page URLs without user information and uses the existing desktop opener. Its
pending, success and failure feedback stays in the browser surface; repeated
clicks cannot admit a second open while the first is pending.

Find in page searches the pane's existing resident guest. Ctrl+F on Windows/Linux
and Command+F on macOS open the bar whether keyboard focus is in the app or its
registered guest. Guest shortcuts retain the existing owning-window/browser
identity boundary. Hidden panes do not handle app shortcuts or keep a mounted
search bar.

Search preserves the original case, diacritic, whole-word and Highlight All
options. Enter and Shift+Enter navigate matches, Escape closes the bar, and
closing clears its CSS highlights without rewriting page text. The query is
bounded to 2,048 characters. The guest search bounds indexed text and match
counts, skips hidden/non-content elements, follows same-origin frames and open
shadow roots, and leaves cross-origin frames isolated. Guest replies are
validated before their counters enter the UI. Search work is debounced and
serialized; late results from an inactive bar cannot publish into a later view.

The pure action/search fixtures run without a browser. The separate
`actions.browser.test.tsx` and `page-find.browser.test.ts` fixtures exercise the
actual UI and guest DOM in Chromium; the external-opener port is injected so
those tests never open an operating-system browser. Real Electron focus,
compositor and external-opener acceptance remain separate boundaries.
