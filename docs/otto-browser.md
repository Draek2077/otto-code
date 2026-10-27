# Otto browser

Desktop browser tabs retain Paseo's resident webview, panel descriptor and browser
profile ownership. Otto additions live under `packages/app/src/otto/browser/` and
`packages/desktop/src/otto/browser/`, with marked composition seams in the existing
panel, main process and preload.

The pure Paseo ARIA snapshot and ref implementation is shared through
`@getpaseo/plugin/server/otto-browser`. Its original desktop entry points re-export
the shared implementation. The extraction preserves the source bytes and keeps one
ref/fingerprint implementation for desktop and daemon browser hosts. Native
guest lifetime, trusted input and Electron capture remain in their existing owners.
The daemon declares Playwright core at the repository's pinned version; installing
that library does not download a browser or launch a runtime.

## Host paint transport

Host paint packets use application opcode `0x20` inside the existing encrypted
Paseo connection. A fixed, versioned header binds each bounded JPEG to its viewer
ticket, sequence and viewport. Malformed frames, unknown tickets and old sequences
never reach the image observer. The client drops viewer demand on disconnect.

The daemon retains binary delivery through the same source ownership and proof
checks as other session operations. A retained binary operation cannot broadcast
to peer clients or acquire JSON reply authority. Disconnect and release invalidate
its producer. The paint pump retains one latest JPEG, permits one unacknowledged
packet per viewer and isolates slow viewers. Chrome acknowledgments enforce the
idle and interactive byte budgets; capture demand stops with the last viewer.
The packet primitives do not launch a browser. The composed daemon advertises
`ottoHostBrowser`; runtime discovery and launch remain lazy until a page is created.

## Host browser tabs

The existing New browser action creates a host tab on mobile and browser web.
Desktop keeps native tabs by default and offers Open in Host Browser in More.
That action opens the URL with the host profile; it does not transfer the desktop's
cookies, form drafts or sign-in state. Preview and agent tools use the same daemon
browser broker and designated page, independent of desktop connection order.

The app uses Paseo's canonical browser records and workspace tabs. Immutable
host/workspace ownership is persisted separately, before inserting a host record.
Restoration waits for that binding before mounting any Electron guest. Unreadable
bindings remain preserved and block native fallback. A host's localhost is never
opened as the client's localhost or used for a client-side favicon request.
Explicit Open reveals the designated tab; agent-created tabs open in the background.
Active workspace metadata shares the existing query cache and stops refreshing when hidden.

Each visible pane owns one stream ticket and one current JPEG. Paint registration
precedes its watch RPC because the first packet can arrive before the JSON reply.
The image decoder acknowledges the displayed sequence. Hiding, disconnecting or
decode failure releases the subscription and image. Ordered, bounded input coalesces
adjacent motion; dropped connections release only that viewer's held native input.
Web paints use revoked Blob URLs; native paints use the existing image component.
Both map input through contained-image geometry, including letterboxing.
The host profile keeps a private blank target so closing its final user tab does
not end the profile session. Context shutdown closes that target too.

The native adapter under `packages/server/src/server/otto/browser/host/` registers
as a host in Paseo's existing browser broker. Host creation can be selected
independently of desktop registration order; known tab IDs retain their original
host affinity. Native manual tabs are never adopted into a hosted profile after
a hosted runtime failure. The adapter discovers installed Edge, Chrome and the
repository's Chromium runtime without downloading or repairing an installation.
Its persistent profile stays under the owning daemon home.
Deployments can set `OTTO_HOST_BROWSER_EXECUTABLE` to an absolute executable path.
An invalid explicit path fails without switching browsers. Docker includes Debian
Chromium; the Linux Nix daemon, CLI and desktop wrappers select their immutable
Chromium runtime. Discovery never installs software or changes a user's PATH.

Page inventory reads are inert. Explicit operations serialize per page; runtime
admission permits four live pages and up to 256 retained tab identities. Only
inactive pages yield capacity. A retained viewer holds a page lease; five idle
minutes suspend its pixels while retaining its metadata. Startup and page events
run outside requesting-session asynchronous storage. Source release and workspace
archival do not confer new input or launch authority.

Hosted automation uses the shared Paseo ARIA/ref engine. Upload paths resolve
real regular files within the caller's workspace. Evaluation limits its JSON in
the page before transfer, screenshots obey the vision and transport budgets, and
console/network metadata has bounded retention. A hung operation closes only its
owned page; it cannot hold the daemon's command queue indefinitely. Browser
dialogs follow Paseo's accept-alert/dismiss-confirm policy and return at most ten
events per tool reply.

`host/native.e2e.test.ts` is the separate CI-only real Chromium contract. It checks
that automation, viewer text input, shared refs, screenshots and source-owned
paints reach the same page. It does not establish app-pane, mobile gesture or
relay streaming acceptance.

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

## Browsing history

Desktop address fields suggest up to ten matching URLs or titles from this
project on the selected host. Arrow keys choose a suggestion, Enter navigates,
and Escape dismisses it while preserving the address draft. Completed top-level
page state records a visit; iframe navigation does not replace the address.
Hidden browser surfaces do not keep suggestion overlays mounted.

The daemon resolves the project from the workspace and owns the history file.
Its `browser-history/<SHA-256 project id>.json` path and record format preserve
Otto 0.9 history. Each project retains at most 1,000 distinct HTTP(S) URLs in
most-recent order. URL credentials are stripped. Unknown stored fields survive
updates but are not returned to clients. Corrupt or oversized files are reported
and preserved instead of reset. Writes and clear operations serialize per file.

More offers Clear browsing history with an explicit project/host confirmation.
Cookies and sign-in sessions remain in the existing browser profile. Failure is
visible, and a new explicit attempt can recover; there is no automatic clear
retry. A failed visit write also exposes an explicit retry. History requires the
host's `ottoBrowserHistory` capability and uses authenticated plugin RPCs.
