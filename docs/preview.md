# Preview

Preview is Otto's dev-server-and-browser-verification system: agents (and users)
start a project's dev server from a project-level config, then check the
rendered result in a real browser tab - accessibility snapshots, DOM
inspection, console/network capture, click/fill interaction, viewport resize,
and screenshots - instead of asking the user to check manually.

This doc covers the finished feature: settings, day-to-day server management,
how a preview tab differs from a normal browser tab, the design principles
carried over from the reverse-engineered Claude Preview MCP server, and the
`.claude/launch.json` config lifecycle. (The original reverse-engineering
blueprint that drove the build shipped and was retired; its durable decisions
live in this doc.)

## Two subsystems, one feature

- **Dev-server manager** (`packages/server/src/server/preview/dev-server-manager.ts`) -
  process supervision. Spawns the command from `.claude/launch.json`, tracks
  it by `serverId`, captures stdout/stderr into a bounded ring buffer, polls
  the port for readiness, and tree-kills on stop.
- **Browser tools** (`packages/server/src/server/browser-tools/`) - the
  verification half. Desktop commands execute against the visible Electron
  guest. On mobile a daemon Chromium page renders into the workspace browser
  pane and supports snapshot, inspect, evaluate, click, fill, wait, type,
  keypress, select, hover, drag, upload, navigation, scroll, resize, screenshot,
  console and network inspection, page text, and color scheme
  commands against that same page.

Agents get both as tool groups: `preview_start` / `preview_stop` /
`preview_list` / `preview_logs` for lifecycle, and `browser_*` tools
(`browser_snapshot`, `browser_inspect`, `browser_click`, `browser_fill`,
`browser_navigate`, `browser_network`, …) for verification. `preview_start`
opens (or re-finds) the tab and hands back its `browserId`, which the agent
then passes to the `browser_*` tools.

## Scope: one workspace, many chats

**Preview is a workspace-level facility, not a per-chat one.** Every chat in a
workspace reaches the same dev servers and the same browser tabs, and no chat's
context knows the others exist. Two boundaries, and they are not the same one:

| Thing            | Scoped by                | Mechanism                                                                                            |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Dev servers**  | the caller agent's `cwd` | `manager.start({ cwd: caller.cwd, name })`, `list(cwd)`, `externalServers` (`dev-server-manager.ts`) |
| **Browser tabs** | the caller's workspace   | `broker.execute({ agentId, cwd, workspaceId })` (`browser-tools/tools.ts`)                           |

The mismatch is deliberate but worth knowing: a chat running in a **worktree**
has a different `cwd`, so it gets its own preview-server namespace - while still
sharing the workspace's browser tabs.

This is good and bad, and the trade is on purpose:

- **Good** - one dev server serves every chat in the workspace. Nobody pays to
  boot a server per chat, and there is no tab-per-agent bookkeeping.
- **Bad** - those chats will **trample each other**. Each one believes it is the
  only driver, so two agents verifying at once will navigate, click, and resize
  the same tab out from under one another. Nothing detects this; the tools have
  no notion of a second caller.

The mitigation is a tab per chat, one server for all of them. Servers are the
expensive, shared thing; tabs are cheap. An agent that needs an unshared surface
should open its own tab and drive that - not start a second dev server.

### Prefer the running server

**Always reuse a running preview server rather than starting another one, unless
the user asks for a new one.** A workspace accumulates chats, and if each one
starts its own server the list becomes unmanageable and ports collide for no
benefit - the whole point of workspace scoping is that one server is enough.

Before starting anything: call `preview_list` to see what this `cwd` already has
running, and prefer a match by name or port. `preview_start` is spawn-**or-reuse**
by design - it short-circuits on a tracked server and [adopts](#servers-otto-did-not-start-adopt-dont-refuse)
an untracked one already holding the port, both with `reused: true` - so calling
it for a server that is already up is safe and cheap. What is not safe is
inventing a new launch.json entry on a new port because the existing one looked
busy.

## Design principles

These were the load-bearing decisions carried over from reverse-engineering
Claude Code's preview MCP server; they explain why the tools look the way
they do and must survive future changes:

- **Token economy is a first-class design axis, not an afterthought.**
  Screenshots are normalized for vision-model legibility and cost: captures
  are scaled back to CSS pixels (undoing device-pixel-ratio inflation) and
  fitted to a ~1568px-long-edge / ~1.15-megapixel budget - the size past
  which vision APIs downscale images anyway, with token cost growing by
  pixel area the whole way; full-page captures render the CDP clip at
  reduced scale and the tool warns the agent when the result falls below
  legible size; `browser_screenshot` with a `ref` re-renders just that
  element at up to 3x zoom for readable small text (a vector re-render, not
  pixel magnification). `browser_snapshot` returns a pruned
  accessibility tree with stable element refs, never a DOM serialization;
  `browser_page_text` returns reader-mode text (article/main first) so
  reading a page doesn't pay for structure;
  network capture is split into a summary listing (method/url/status/
  `requestId`) with response bodies fetched on demand by `requestId` and
  capped at 30k chars; every log tool takes `lines` caps plus `level`/`search`
  post-filters (`level: "error"` is deliberately a keyword grep for
  error/exception/failed/fatal, matching the Claude Preview contract).
- **Tool descriptions are agent steering, not just API docs.**
  `browser_evaluate` is walled off as debug-only in its own description (DOM
  edits are lost on reload - edit source instead); screenshot self-deprecates
  for precision work and points at `browser_inspect` for colors/fonts/spacing;
  snapshot advertises itself as preferred over screenshot; `preview_start`
  embeds the launch.json format with create-if-missing instructions so agents
  can bootstrap a project themselves. Treat description text as prompt
  engineering - review it like code.
- **Descriptions steer, the daemon enforces.** Where a failure mode matters,
  there is a hard server-side check behind the guardrail text. Three live
  examples: the designated preview tab enforcement below
  (`findPreviewServerForUrl`); the `ext:` stop refusal (agents can never stop
  a server Otto did not start, see
  [External servers](#external-ext-servers-and-the-bulk-stop-rule)); and the
  navigation screen on `browser_navigate` / `browser_new_tab`
  (`screenBrowserUrl` in `packages/server/src/server/agent/url-screen.ts`,
  described below). Never rely on description text alone for correctness or
  safety.
- **Console/network events are push; tool calls are pull.** Both hosts buffer
  events into bounded ring buffers read (and filtered) at call time. Network
  capture in the Electron host is a per-tab CDP recorder
  (`webContents.debugger`, Network domain, 500-entry ring per tab) that
  attaches lazily on the tab's first `browser_network` call - which is why the
  tool description tells the agent to reload after enabling, so the page's
  traffic actually gets recorded. (`browser_logs` carries the lighter
  Performance-API entries instead.)
- **The verification workflow is injected as system prompt, not hoped for.**
  Tool descriptions alone don't reliably steer local models, so the
  openai-compatible provider injects a workflow doctrine
  (`buildPreviewWorkflowPrompt` in
  `packages/server/src/server/agent/providers/openai-compat-agent.ts`),
  emitted only when the preview/browser tool groups are actually exposed:
  start dev servers with `preview_start` (never `run_command`), verify against
  the returned `browserId` only, and share proof (snapshot/screenshot) instead
  of asking the user to check manually. Known gap: other providers (Claude
  Code, Codex, …) currently get the guardrail-bearing tool descriptions but no
  injected workflow prompt.

## Preview tabs vs. normal browser tabs

### Interactive View authoring panes

The Archify Interactive View shown beside its bound authoring chat is also a
real Otto browser-automation target. It deliberately has **no browser toolbar**
or independent workspace tab: the authoring surface owns its placement and the
chat tab owns its lifetime. On Electron it remains in the hardened
self-contained-document session, but registers its guest webContents with the
browser host. The bound agent can discover it with `browser_list_tabs` and use
the ordinary `browser_snapshot`, `browser_inspect`, and `browser_screenshot`
tools to review the rendered diagram.

Its automation identity is deterministic for the authoring chat, survives
live HTML refreshes, and is unregistered when that chat tab closes. The
authoring toolbar has a Refresh action for fetching the latest rendered draft
into that same guest when the automatic refresh has not caught up. Ordinary
artifacts are not browser-automation targets.

A preview tab is a normal Otto browser tab with extra bookkeeping, not a
separate tab type:

| Field (`packages/app/src/desktop/browser/store/state.ts`) | Purpose                                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `isPreview: true`                                         | Tab icon is always the Play icon instead of the page favicon, so a preview tab is visually unmistakable from a tab the user opened themselves. |
| `previewServerName`, `previewCwd`                         | The `.claude/launch.json` entry and working directory needed to restart the server after a daemon or app restart.                              |
| `previewServerId`                                         | The running server's id (or `ext:<port>` when Otto detected an already-running server on that port instead of one it spawned).                 |
| `previewStatus`                                           | `idle` \| `starting` \| `ready` \| `error` \| `needs-start` - drives the tab's watermark/spinner until the server responds.                    |

What this buys you, concretely:

- **Users can freely close, navigate, or reload a preview tab.** There's no
  lock-in - closing the tab does not stop the server by default (see
  [Settings](#settings) for the opt-in auto-stop behavior), and navigating
  away doesn't break anything; the next `preview_start` re-finds or reopens
  the designated tab.
- **One designated tab per server, enforced server-side, not just by
  convention.** `findPreviewServerForUrl` (`packages/server/src/server/browser-tools/tools.ts`)
  checks every `browser_new_tab` / `browser_navigate` call: if the target URL
  matches a running preview server's configured URL origin or is a loopback
  address matching its local process port (including loopback aliases), and the
  call isn't targeting that server's `boundBrowserId`, it's rejected with an
  error naming the correct `browserId` (or telling the agent to call
  `preview_start` if no tab is bound yet). This closes the failure mode where
  an agent opens a second, detached tab pointed at the same dev server instead
  of reusing the bound one - tool descriptions alone can't guarantee that, so
  the daemon enforces it.
- **Navigation destinations are screened before the browser host sees them.**
  Right behind the designated-tab check, the same `browser_navigate` /
  `browser_new_tab` handlers run `screenBrowserUrl`
  (`packages/server/src/server/agent/url-screen.ts`). The hostname is resolved
  and every returned address is checked, so a DNS name pointing at
  169.254.169.254 is caught, not just the literal IP. The screen is
  deliberately narrower than `web_fetch`'s: both policies live in the same
  module, and they differ on purpose. `web_fetch` is a headless daemon-side
  fetch nobody watches, so it blocks everything internal. The browser pane is
  a user-visible surface whose whole purpose is loopback previews, and
  reaching a LAN device or a Tailscale host from it is a legitimate thing to
  do; so loopback, RFC 1918, IPv6 ULA and CGNAT stay reachable, and only
  ranges with no browsing use at all are blocked: link-local v4 and v6 (cloud
  instance metadata lives at 169.254.169.254), the Alibaba/OpenStack metadata
  IP 100.100.100.200 inside CGNAT, and the unroutable special-use ranges. Do
  not "unify" the two policies; the asymmetry is the design, and the module
  comment in `url-screen.ts` carries the full rationale. Known limitation:
  unlike `web_fetch`, the daemon cannot pin the webview's sockets to the
  validated addresses (Chromium resolves independently), so a low-TTL DNS
  rebind between the check and the page load remains possible. Closing that
  fully would require proxying all webview traffic.
- **A tab that exists is always listed, even when it isn't drivable.**
  `browser_list_tabs` reports every registered tab and carries a `status`:
  `ready` (webview attached), `starting` (registered, attaching), `detached`
  (its contents are gone, which is what a pane that stopped compositing looks
  like). `url` and `title` are empty for the last two, because only the live
  webview knows them. This exists because the opposite was worse: the host used
  to drop non-attached tabs from the array entirely, so a preview tab sitting
  on screen in front of the user was indistinguishable from one that had never
  existed. `ensurePreviewTab` read that absence as "closed" and opened a second
  tab beside the first, and agents did the same by hand. Absence now means
  absence. A tab-scoped call against a `starting` tab fails **retryably**, with
  the instruction to reuse that same `browserId`, never to open another.
- **`preview_start` never opens a replacement on a failed lookup.**
  `findBoundTab` distinguishes `present` / `absent` / `unavailable`. Only a
  successful listing that genuinely lacks the id may reopen. A broker error or
  a detached browser host means _unknown_, and unknown returns the bound tab
  with a note rather than creating anything.
- **Restored preview tabs don't silently reconnect to a stale server.** On
  app/workspace restore, a preview tab's status resets to `idle`; whether it
  auto-restarts the dev server or waits for the user to click "Start" is the
  `previewAutoStartOnRestore` setting below.

## Browser chrome and project history

Back, Forward, Reload/Stop, the address bar, and device sizing stay visible.
The **More browser tools** menu contains **Open in external browser**, **Find in
page**, DevTools, element annotation, and element screenshots. External browsing
opens the current HTTP(S) address using the desktop opener.

Ctrl+F (Cmd+F on macOS) opens the tab's Find in page bar even while focus is inside
its guest page. Electron reserves this browser shortcut and sends the browser ID
to the renderer; it must never open search in a different tab. The blue bar uses
the File Editor notice geometry and the `statusInfoSurface` tint. It provides a
query, previous/next, a result count, Highlight All, Match Case, Match Diacritics,
Whole Words, and Close. Enter and Shift+Enter move through matches; Escape closes
the bar. Controls wrap in a narrow pane.

Search runs against rendered HTML text in the existing guest, without rewriting
page text. CSS highlights are removed on clear or close, and a new document
restarts the active query. It can inspect same-origin frames and open shadow text;
cross-origin frames, closed shadow roots, form values, canvas text, and the built-in
PDF viewer are outside this text search. Searches are bounded to two million text
characters per root and 10,000 results; a `+` on the count indicates truncation.

Visited HTTP(S) URLs belong to the **project on its daemon**, shared by all of that
project's workspaces. The daemon resolves the project from the registered workspace
ID. The store is under `$OTTO_HOME/browser-history/`, keyed by a hash of the project
ID, and retains the latest 1,000 distinct addresses. URL user-info is stripped.
Reads, records, and clears share a queue across sessions and writes are atomic.
This is separate from the app-local open-tab records and Chromium's per-tab Back
and Forward history.

The resident guest records successful document arrivals and main-frame in-page
navigations, including background tabs. The address bar queries the daemon after
a short typing pause, matching URLs or titles and offering at most ten results.
No matches means no popup. No result is selected initially: Enter keeps the typed
address unless the user selects a suggestion with Up/Down or clicks one. Escape
dismisses suggestions. Project settings > Browser > **Clear browsing history**
confirms the project and host scope, then clears saved URLs while preserving open
tabs, cookies, and site data. New hosts advertise `server_info.features.browserHistory`;
older hosts show an update hint in that settings section.

## Browser loading and navigation lifetime

### Automation and user focus

Tab-scoped browser automation preserves the user's current app control. Electron's
trusted guest clicks can transfer focus into the webview without an explicit focus
call. The renderer retains the user's control for the lifetime of the browser
automation connection, including gaps between commands, delayed guest focus events,
and newly attached tabs. It restores the control without scrolling and prevents
guest focus notifications from activating the browser pane. A control the user
focuses becomes the new restoration target. Connections share the guard; unmounting
one connection cannot remove another connection's protection.

This keeps the browser device-size menu usable during automation too. Opening a
split preview preserves the original pane's focus. `browser_focus_tab` returns an
error while an app editor is focused; agents can continue operating the background
tab by `browserId`. Otherwise it brings the tab forward. Page-created workspace
tabs also stay in the background while an app editor owns focus, and register
immediately so tools can use them without revealing them.

User pointer and Tab-key navigation release ownership. Native guest pointer events
do not bubble through the host document, so the desktop browser module forwards
user presses through `browser-user-activation`. CDP input remains marked as
automation until its acknowledgement and does not produce that user signal. The
guard does not arbitrate a user and an agent interacting with the same web page.
This is an Otto browser integration policy; the shared composer is unchanged.

Coverage lives in `automation/focus-guard.browser.test.ts` and
`pane/loading.browser.test.tsx`. The isolated native regression is
`npm run test:e2e:browser-focus --workspace=@otto-code/desktop`; it checks real guest
clicks and text input against host chat and menu focus without starting a daemon,
including continuous host typing after command completion and native user clicks
that return ownership to the guest. `handler-focus.browser.test.ts` checks editor
selection and workspace focus through the renderer's tab-creation and focus handlers.
The full desktop `test:e2e:browser-tab-bridge` harness verifies native typing in the
real composer concurrently with MCP input, including page-created background tabs.

### Resident state

Hosted browser tabs keep the ordinary workspace browser ID and local URL
record, while the daemon owns the page and its viewport. Android native,
iOS web, and desktop clients use `browser.remote.execute.request` to attach
to the existing page after a socket loss. A live page keeps its scroll, forms, and history;
after suspension or daemon restart the same tab ID reloads its last URL. The
active client sends its measured size for responsive mode or the chosen fixed
device dimensions when it takes control. Passive viewers keep the host's
viewport. AI screenshots and controls target that same daemon page and
viewport. The shared snapshot engine supplies stable element references.
AI-created tabs, including the tab `preview_start` opens, use the browser of
the client that sent the latest prompt: the desktop app's own webview or the
daemon host for mobile. `browser_new_tab` and `preview_start` accept optional
`host: "app" | "host"` to override that choice in plain-English requests.
`browser_list_tabs` accepts the same field to list tabs from one browser.
The choice applies when a tab is created; a `browserId` keeps its browser host
for later commands, and `preview_start` reuses an existing bound tab even if a
different host is requested. If no prompt origin is known, a connected desktop
browser is preferred, otherwise the daemon host is used. An explicit choice
fails if that browser is unavailable. A hosted preview tab carries its server
identity, so each client adopts it as that server's preview tab, and opens it
beside the focused pane where panes can split. If a desktop app is connected,
an unsourced request uses its webview even when the daemon host has no browser.
A mobile request still selects the daemon host; if it cannot launch a browser,
its error explains how to install one. Closing a hosted tab closes the daemon page and
withdraws it from other clients; a stale client cannot reopen that closed ID.
`browser_focus_tab` raises a hosted tab in each connected workspace client on
its next tab poll. AI viewport, full-page, and element screenshots render from
the host page. Captures respect the selected CSS viewport and the same
1568-pixel / 1.15-megapixel image budget as desktop; element captures can
re-render at up to 3x for legible text.
Desktop users can create a hosted page with **New browser on host**; the
ordinary desktop browser button still opens a native page. Existing native
pages do not transfer their live form or scroll state to the hosted browser.
An ordinary browser tab's **Host** toolbar switch changes between those two
backings in the same workspace tab. Otto opens a fresh browser at the saved URL;
forms, scroll position, and page history do not transfer. Switching to the app
closes the host page, which withdraws that tab from mobile clients. A new browser
ID is used for each switch because the host does not reopen a closed ID. Preview
tabs keep their server binding and do not offer the switch.

The daemon permits four live hosted pages. A page unused for five minutes is
suspended. A suspended tab is forgotten after an hour in which no client
listed its workspace; a connected client's tab poll counts as a claim, so an
idle tab is not withdrawn from a client that still shows it. The daemon host
declares a 45-second automation timeout, because a cold start launches the
browser before the page loads. `OTTO_HOSTED_BROWSER_AUTOMATION=0` keeps agent
tabs off the daemon host; the desktop bridge E2E suites set it so they keep
covering the native webview. Repeated
page crashes quarantine the tab until it is closed. The frame stream is
described under [Hosted frame stream](#hosted-frame-stream). Responsive and fixed viewport presets share a selector
beside the address field. Frames are bounded below the relay's 1 MiB message
limit. The daemon checks a page's Chromium JavaScript heap periodically and
quarantines it above 512 MiB;
native image and GPU memory are outside that measurement. The host uses Edge,
Chrome, or a Playwright Chromium installation, and reports an install action
when none is available. Mobile annotation is not supported by this host.
Preview is offered wherever a tab can carry it. The desktop tab row shows
the button on Electron, and on any other client whose host supports hosted
tabs. The phone layout has no tab row, so Preview is an entry in the
workspace "..." menu there, with the server picker opening after the menu
dismisses. A user-started preview tab is hosted on every client except
Electron. It opens before the server is up, so the hosted pane holds off the
host page until the tab is ready, showing the same starting, failed, and
start-manually states as the native pane. A restored hosted preview tab
restarts its server under the same auto-start setting.
A page that will not load is not an error of the tab. Chromium draws its own
error page, the tab keeps the address that was asked for, and the viewer
reloads like in any browser; the banner is for failures of the host or the
stream. A reported message is cut at Playwright's call log and stripped of
colour codes. A failed action keeps its message until the next action; frame polling no
longer clears it. Back and Forward reflect the page's real history. On a
phone, Send with an empty field presses Enter, and Backspace in an empty field
goes to the page. Other keys (Tab, Escape, arrows) have no phone control yet.
Hosted page input forwards desktop right click, double click, and touch double
tap. A touch long press opens the page's right-click menu. Single taps wait
briefly so a second tap can be sent as one double click. Hosts advertise
`remoteBrowserGestures` for these gestures; older hosts retain single taps.
Two-finger touch and trackpad pinch zoom the hosted page around the gesture's
centre, and Ctrl+wheel also zooms it. The client coalesces gesture updates and
the host serializes them for viewers sharing one tab. Hosts advertise
`remoteBrowserPinch`; older hosts do not offer pinch zoom.
Ctrl+V, or Cmd+V, over the page sends the viewer's clipboard text into it by
the same route the send bar uses, so it lands in whatever the page has focused,
which is the field the viewer last clicked. The chord itself is never forwarded
as a key: the page would otherwise paste whatever the daemon's own Chromium
holds. Copy and cut over the page are still the host's clipboard, not the
viewer's.
When a focused canvas receives the paste shortcut without a `paste` event,
the client reads the viewer's clipboard and sends its text through the same
route as the bottom text bar. A normal paste event wins when both paths fire.

Hosted tabs report main-frame navigation from the host page rather than from
the command response. The tab spinner and Reload/Stop control stay active until
the page's load event or a failed navigation. Reload and address navigation
show progress immediately, and Stop asks Chromium to cancel the active load.
A held frame request wakes for a loading-state change even if the page pixels
do not change. Hosts advertise `remoteBrowserLoadStatus` for this behavior;
older hosts retain their existing browser controls.

Page-created popup windows are closed rather than left as untracked daemon pages.

### Hosted browser profile

Hosted tabs on one daemon share a persistent Chromium profile at
`$OTTO_HOME/browser-profile`. Cookies, local storage, IndexedDB, service workers,
and browser caches survive tab suspension, tab closure, and daemon restart. This
lets a site retain a login after the user returns. Workspaces still own their
tab IDs and automation access, while website session data is shared across the
host's workspaces. The profile stays on the daemon host; it is separate from the
Electron desktop browser profile and from profiles on other hosts. Dev and
installed daemons use separate `OTTO_HOME` directories, so they do not share
site data. Closing a tab does not erase the host profile.

### Hosted frame stream

A hosted tab is watched as a stream of JPEG frames. Four rules keep it cheap,
and each one was measured before it was kept.

- **The page says when it changed.** Chromium's screencast pushes a frame only
  when the page repaints, so a still page produces none. Where a Chromium
  cannot screencast, the host takes screenshots on a timer instead. Either
  way a frame identical to the one before is dropped.
- **The request waits for the frame.** A client sends one frame request at a
  time with `waitMs`, and the host holds it until the page repaints or the
  wait expires. There is no polling interval, and a slow link lowers the frame
  rate instead of building a queue.
- **A byte budget, not a frame rate.** Chromium sends its next frame only after
  the last is acknowledged, so the host delays the acknowledgement by the
  frame's size: 40 KB/s while the viewer is idle, 300 KB/s for 1.2 seconds
  after a tap, scroll, or key. A large frame waits longer than a small one.
  Input releases a pending acknowledgement at once.
- **The picture travels as bytes.** A client that sends `binary: true` receives
  the JPEG as a binary frame (opcode `0x20`) ahead of the JSON response that
  describes it, which spares the third that base64 adds.

A tab nobody can see asks for nothing: not behind another tab, and not while
the app is in the background. Five seconds after the last frame request the
host stops the screencast, and the page idles.

`animations: "disabled"` was removed from frame capture. It fast-forwarded CSS
animations, so the stream showed a different page than the one the agent's
screenshot saw.

#### Measuring it

`npm run measure:hosted-browser --workspace=@otto-code/server` drives the
manager the way a client does against five pages served locally, and reports
bytes on the wire, frames delivered, scroll-to-frame latency, and CPU. Run it
before and after any change to capture or pacing. `OTTO_STREAM_BENCH_STRATEGY`
selects the client loop: `fixed` is the original 900 ms poll and stays so old
numbers remain reproducible, `push` holds the request, `binary` adds byte
frames and is what the app uses.

Measured 2026-09-27 on Windows with headless Edge, a 390x844 viewport, 20
seconds per run. "Before" is the original screenshot poll.

| Page                    | Before MB/hour | After MB/hour | Before frames/s | After frames/s |
| ----------------------- | -------------: | ------------: | --------------: | -------------: |
| Still                   |            131 |             5 |            1.08 |           0.05 |
| Blinking text cursor    |             30 |            39 |            1.07 |           1.95 |
| Small moving element    |             25 |            61 |            1.07 |           3.74 |
| Every pixel changing    |            513 |           144 |            1.06 |           0.40 |
| Scrolling half the time |            549 |           567 |            3.43 |           4.75 |

Scroll-to-frame latency fell from 292 ms (p50) and 646 ms (p95) to 19 ms and
32 ms. Pages with small constant motion cost more than before because they now
show two to four frames a second instead of one; the idle budget is the dial
for that trade. These numbers are from one machine on a local socket. They do
not include relay encryption or a cellular link.

With the metrics bar enabled, a hosted tab shows its own reading below the
page text box: frames per second, KB/s, MB/hour, time to draw a frame, and the host's
count of pushed frames against screenshots.

Responsive browser surfaces snap their bounds outward to whole CSS pixels, with
the guest sized from the same snapped edges. Fractional splitter positions must
not expose the white page backing. This adds less than one CSS pixel per edge;
fixed device viewports retain their exact dimensions and pane clipping. Collapsed
panes have no visible surface or pointer target.

Workspace layouts persist browser IDs; `workspace-browser-store` separately maps
those IDs to URLs and browser metadata in the app's AsyncStorage (localStorage on
Electron/web). A restored pane waits for that store to hydrate before creating its
guest. Switching panes retains the existing guest; restarting the app loads the
saved URL in a new guest, without restoring the full Chromium navigation history.

Browser persistence recovers each saved record independently. Invalid metadata or
a malformed sibling record must not discard another tab's URL. When metadata cannot
be decoded but an address remains, restore that address with default metadata. Reads
never delete malformed saved bytes. Already-erased addresses cannot be reconstructed
from the workspace layout, which contains only the browser ID. The current missing
record fallback is `example.com`; seeing it on formerly populated tabs indicates a
missing or overwritten browser record, not successful restoration of those pages.
After hydration, opening such a tab recreates its record under the existing browser
ID so subsequent navigation can be saved. Restore normalization must produce only
persistable record fields: constructor-only fields such as `now` cause strict save
validation to reject the entire browser index, including newly opened tabs. Regression
coverage includes restore, navigation, save, and a second restore through the storage
boundary and rendered browser pane.

The resident webview owns `did-start-loading`, `did-stop-loading`, and the first
`dom-ready` observation. These listeners are installed before attachment and remain
with the guest when its pane unmounts. A background tab created by automation must
update the same browser store as a visible tab. Pane-scoped listeners cannot own
this state: they miss events before the first mount and while the guest is parked.

Page titles follow the same guest lifetime. The resident webview records
`page-title-updated` even before a pane mounts or while it is absent, and reads
`getTitle()` on DOM readiness, load completion, and pane reattachment. The tab label
uses that persisted website title, falling back to the hostname when no title is
available. Dynamic page-title changes update background tabs too.

The tab's circular spinner and the toolbar's Reload/Stop control read that same
loading flag. Reload sets it immediately; Stop cancels the guest navigation and
clears it. `dom-ready` does not end resource loading, so only the load's terminal
state ends the spinner. A navigation failure exposes the page error with Reload
available for retry.

Readiness to call guest methods survives later page loads. Clearing it at every
`did-start-loading` can strand navigation after a stopped or stalled request that
never reaches another `dom-ready`. Before the first document is ready, a new URL
replaces `src` directly instead of waiting for the old request to finish. Stop and
subsequent navigation invalidate older `loadURL()` rejection callbacks so they
cannot clear the new request's progress.

Focused coverage lives in `resident-webviews.browser.test.ts` and
`pane/loading.browser.test.tsx` under `packages/app/src/desktop/browser/`. The latter
renders the production pane, descriptor, toolbar, and tab icon in Chromium with
substituted Electron methods; it does not prove packaged Electron guest behavior.

## Settings

Preview-related configuration is split across three levels - daemon-wide,
per-provider, and per-client (device-local) - because each answers a
different question: _is Otto allowed to touch the browser at all_, _which
tool groups does this specific model see_, and _how does this device want
restored preview tabs to behave_.

### Daemon-level (Host settings screen, requires a connected daemon)

| Setting               | Config key                                      | Where it's rendered                                                                                  |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Browser tools**     | `daemon.browserTools.enabled` (default `false`) | `BrowserToolsMasterRow` (master of `BrowserToolsSection`), `screens/settings/otto-tools-section.tsx` |
| **Enable Otto tools** | `daemon.mcp.injectIntoAgents` (default `true`)  | `OttoToolsMasterRow` (master of `OttoToolsSection`), `screens/settings/otto-tools-section.tsx`       |

**The two masters default differently, on purpose.** Otto tools default **on** -
they are Otto's own filesystem/agent/terminal tools, nothing an agent isn't
already doing. Browser tools default **off** - they drive real Otto browser tabs
carrying the user's logged-in sessions, so a human turns them on deliberately.
The daemon (`config.ts`), the protocol schema defaults
(`MutableBrowserToolsConfigSchema`), and `DaemonConfigBrowserToolsPolicy` all
agree that an absent value is off, so no read path can disagree about an opt-in.

Off-by-default costs discoverability, so the feature surfaces **warn at the
moment of intent instead of failing silently** - the affordances stay visible
when the master is off; clicking one explains why it won't do what you want and
offers the switch. Both gates live in `packages/app/src/utils/browser-tools-warning.ts`
(one copy source, one deep-link to Host settings → Tools), and they differ on
purpose:

| Gate                                  | Trigger                                                             | On "Not now"  | Suppressible                        |
| ------------------------------------- | ------------------------------------------------------------------- | ------------- | ----------------------------------- |
| `confirmPreviewNeedsBrowserTools`     | The Preview button, before `runPreviewFlow` does anything           | Nothing runs  | **No**                              |
| `confirmBrowserToolsOffBeforeOpening` | `handleCreateBrowserTab` (every user-driven "new browser tab" path) | The tab opens | Yes - `suppressBrowserToolsWarning` |

The asymmetry is the point. Opening a browser tab still works for the human when
the master is off - only agent access is missing - so that warning informs,
proceeds, and can be silenced forever from its own checkbox. Preview cannot be
silenced: its entire value is the agent starting the server and checking the
result, and with no `preview_*`/`browser_*` tools that cannot happen, so a
suppressed warning would leave a button that quietly does nothing worth doing.

Note precisely what the master gates. The `preview.*` RPCs are **ungated**, so
the daemon will happily start a dev server either way; the switch only decides
whether the **agent** gets the `browser_*` / `preview_*` tools (`otto-tools.ts`
`registerBrowserTools` / `registerPreviewTools`). Enforcement is the app-side
gate above, not a daemon refusal. Agent-driven tab creation
(`browser-automation/handler.ts`) never passes through it and must never warn.
Anything new gated on `browserToolsEnabled` owes the user the same pointer.

The Host **Agents** sidebar section renders three grouped cards, each with the
standard split-line rows: **Agents** (append system prompt, then agent-behavior +
metadata toggles), **Otto Tools** (the "Enable Otto tools" master over the core
`mcp.toolGroupsV2` category rows - workspace, agents, orchestration, suggested
tasks, terminals, project knowledge, memory, permissions, providers and models,
voice, schedules, artifacts, widgets), and **Browser Tools** (the "Enable Browser
tools" master over its two browser categories, Control = `browser` and Preview =
`preview`). The `web` group is deliberately absent from the Otto Tools card: the
daemon-wide allowlist gates registration in the Otto tool catalog, which holds no
web tools, so `web` only ever meant the natively-tooled providers' builtin
`web_search`/`web_fetch` and is toggled per provider in the provider sheet. Each
master's category rows grey out when that master is off. (Agent personalities,
teams, and voices live on a separate **Teams** sidebar section.)

"Browser tools" is the master switch over the **whole** Preview subsystem -
both halves. Agents can access and control Otto browser tabs, including
logged-in browser state, so it ships off and carries an explicit trust warning
in the UI. With it off, neither `browser_*` (verification) nor `preview_*`
(dev-server lifecycle) tools are registered for any provider, regardless of that
provider's own tool-group selection below - the single enforcement point is
`if (options.browserToolsEnabled && …)` around both `registerBrowserTools` and
`registerPreviewTools` in `createOttoToolCatalog`
(`packages/server/src/server/agent/tools/otto-tools.ts`). Because the master
defaults off, Preview is off by default until a user opts in. The UI mirrors
this exactly: the Control and Preview category rows grey out when the
"Browser tools" master is off, and that grey-out is a true functional gate, not
just a grouping convenience. "Enable Otto tools" is the
broader switch for all daemon-injected tools (agent/worktree/schedule management
as well as preview/browser) - turning it off removes the whole Otto tool catalog
from agents on this daemon.

### Per-provider (provider details screen, natively-injected providers only)

Providers that receive Otto tools natively (currently the openai-compatible
provider family - LM Studio, etc.) can be scoped to a subset of Otto's tool
groups via `ProviderToolGroupsSection` in
`packages/app/src/components/provider-diagnostic-sheet.tsx`, backed by
`providers.<name>.ottoToolGroups` in daemon config
(`OTTO_TOOL_GROUPS` in `packages/protocol/src/provider-config.ts`):

```
preview | browser | agents | terminals | schedules | workspace
```

Unchecking **Preview servers** hides `preview_*` tools from that provider;
unchecking **Browser control** hides `browser_*` tools. Omitting the field
entirely (the default) means all groups are exposed. This is a per-provider
_narrowing_ - it can restrict what an already-enabled provider sees, but
can't re-enable browser tools if the daemon-level "Browser tools" switch
above is off. (The settings UI has a `globallyDisabled` string reserved for
showing that interaction visually; it isn't wired up yet, so a provider's
preview/browser toggles currently render as available even when the daemon
switch would make them no-ops.)

### Client-local (General settings, per device - not synced through the daemon)

| Setting                         | Storage key                  | Default        | Behavior                                                                                                                                                                                                                    |
| ------------------------------- | ---------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Preview server on tab close** | `previewServerCloseBehavior` | `keep-running` | `stop-on-close` calls `client.previewStop(serverId)` when the tab is closed (`workspace-screen.tsx`). `keep-running` leaves the dev server up so reopening the tab (or another tab) reconnects instantly.                   |
| **Auto-start on restore**       | `previewAutoStartOnRestore`  | `false`        | When a saved preview tab is restored (app relaunch, workspace reopen), `true` relaunches its dev server automatically (`browser-pane.electron.tsx`); `false` leaves the tab showing a manual "Start preview server" button. |

Both live in `packages/app/src/screens/settings-screen.tsx` under General, are
persisted client-side (`packages/app/src/hooks/use-settings/storage.ts`), and
apply to every workspace opened from that device/browser.

## Managing preview servers

There's no standalone "running servers" panel today - management happens
through two entry points that both call into the same `DevServerManager`:

1. **The Preview button** - `WorkspacePreviewButton` in
   `workspace-desktop-tabs-row.tsx`, next to "New Browser" in a pane's
   toolbar. Enabled only when the pane's active tab is a chat, since the
   server to preview is resolved from that agent's `cwd` (which may be a
   worktree, not the workspace root). Clicking it:
   - reads `.claude/launch.json` for that `cwd` (`preview.list_config` RPC)
     without starting anything;
   - if no servers are configured, sends the bootstrap prompt into that chat
     instead of opening a menu (see [launch.json](#launchjson) below);
   - if exactly one server is configured, starts it directly;
   - if more than one, opens a picker (name + port) first.

   On start, it opens the tab immediately (before the possibly-slow spawn
   resolves) showing a spinner, splits it into a pane beside the button's own
   pane, and binds it as that server's designated tab - so a later agent
   `preview_start` call for the same server finds this exact tab.

   Picking a server the picker already shows as **running** never starts
   anything: if its tab is still open in this workspace the button focuses it,
   and otherwise a new tab attaches straight to the URL the poll reported and
   binds to it. The tab that started a server and the tab that views it need not
   be the same one, and neither need the chat.

2. **Agent tools** - `preview_start` (spawn-or-reuse by name),
   `preview_stop` (tree-kill by `serverId`), `preview_list` (enumerate
   running servers for the agent's `cwd`), `preview_logs` (bounded
   stdout/stderr with `level`/`search`/`lines` filters). These are the same
   operations the button uses, just callable by the agent mid-conversation -
   e.g. an agent can `preview_logs` to check for a build error without a
   human touching anything.

`DevServerManager` itself exposes more than either surfaces (`bindTab`,
`boundTab`, reconciling externally-running servers detected by port probe
under an `ext:<port>` id) - that's internal wiring for the tab-binding
behavior described above, not something a user interacts with directly.

### External (`ext:`) servers and the bulk-stop rule

A running server with an `ext:<port>` id was **not** spawned by the daemon -
it's whatever process happens to be listening on a configured port, adopted
by port probe. Stopping one resolves the port's owning PIDs and tree-kills
them. That is safe only as a deliberate user action (the tab row's "Stop
server" button), never as part of automatic cleanup: if the workspace is this
repo itself, the `otto-dev` launch config claims port 8081, so the "external
server" is the dev stack's own Metro - killing it takes down Electron
(`concurrently --kill-others`) and, with `keepRunningAfterQuit` off, the
daemon too, which presents as the whole app crashing. This actually happened
via the `/clear` sweep in `agent-panel.tsx`, which stopped every running
server for the cwd; it now filters with `isExternalPreviewServerId()`
(exported from `@otto-code/protocol/messages` alongside
`EXTERNAL_PREVIEW_SERVER_ID_PREFIX`). Any future path that stops preview
servers in bulk must apply the same filter.

The daemon also enforces this independently of client behavior. Bootstrap
wires `DevServerManager.setProtectedPortsProvider()` with the daemon's own
listen port plus the loopback origin ports of currently connected clients
(`VoiceAssistantWebSocketServer.getConnectedClientOriginPorts()` - a
connected client's origin port is the dev server hosting the UI itself).
`stopExternal` refuses to stop an `ext:` server on a protected port with a
clear error, and additionally skips `process.pid`/`process.ppid` if the port
lookup ever resolves to the daemon's own process. Explicit "Stop server" on a
genuinely third-party port still works.

Beyond protected ports, `ext:` stops are restricted to ports the daemon has
itself observed as configured preview servers: `reconcileRunning` records
which workspace's launch.json listed each externally-running port, and
`stopExternal` refuses any port without such an observation - and re-reads
that workspace's launch.json at stop time in case the config changed. This
closes the hole where an agent could pass an arbitrary `ext:<port>` id to
`preview_stop` and tree-kill an unrelated local service (a database, sshd,
another project's server).

Observation alone is still too weak to authorize a kill, because adoption is a
bare TCP probe: a launch.json entry declaring port 5432 will happily adopt a
running Postgres, and every guard above would then pass. Two further rules
close that gap:

- **Agents can never stop an `ext:` server.** Every `ext:` record is a process
  this daemon did not spawn, and killing a process Otto did not start is a
  decision for a person. `stopExternal` refuses any stop carrying a caller cwd
  (the agent tool path) with an error saying exactly that: the process was not
  started by Otto, and the user must stop it themselves. The user's "Stop
  server" button (the unscoped `preview.stop.request` RPC) remains the one
  deliberate action that may tree-kill an adopted server.
- **Well-known service ports are never stoppable via `ext:`, on either path.**
  `NEVER_STOPPABLE_SERVICE_PORTS` in `dev-server-manager.ts` denylists SSH,
  Remote Desktop, and the common local databases and brokers (PostgreSQL,
  MySQL, SQL Server, Redis, MongoDB, RabbitMQ, Kafka, Elasticsearch,
  memcached). Nothing on those ports is plausibly a dev server, so the refusal
  fires before the observation lookup, as cheap defence in depth even against a
  hostile launch.json. Adoption itself stays permissive so a misdeclared entry
  still shows up in the UI instead of erroring.

Agent-initiated stops and log reads are additionally workspace-scoped: the
`preview_stop` / `preview_logs` tools pass the caller agent's cwd, and the
manager rejects servers belonging to a different workspace
(`DevServerManager.stop`'s `requireCwd` option). User-initiated stops via the
`preview.stop.request` RPC stay unscoped - the user may stop any server the
UI lists.

### Servers Otto did not start: adopt, don't refuse

A configured port that is already serving is the thing the caller asked for.
`start()` **adopts** it - no spawn, no error - and hands back the same
`ext:<port>` identity reconciliation uses, with `reused: true` and a `note`
explaining what was adopted. This covers every way a server ends up running
without this daemon's record of it: another chat started it (servers are
cwd-scoped, so a worktree chat misses the main checkout's server), the user
started it by hand, or a daemon restart wiped `this.servers` while the child kept
serving its port.

Refusing was the old behavior, and it was wrong in both directions. Agents had
no tool-level route to a bound preview tab for a running server. Users got
`Port N is already in use by a process Otto did not start` on a tab they opened
by picking that very server out of a list that said **running** - the picker had
the URL in hand the whole time.

What adoption does and does not buy:

| Call                      | Adopted (`ext:<port>`) server                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `preview_start <name>`    | Returns it, `reused: true`, opens and binds its preview tab                                       |
| `preview_list`            | Lists it - `list()` returns managed records **plus** adopted externals                            |
| `preview.list_config` RPC | Lists it (calls `reconcileRunning`, which is also what prunes adoptions once the port goes quiet) |
| `preview_logs`            | **Throws, on purpose** - Otto captured no output from a process it did not spawn, and says so     |
| `preview_stop`            | **Refuses for agents** (Otto did not start it); the user's Stop button may tree-kill it           |

Adoption records are a probe's worth of truth, so they are only as fresh as the
last probe: `reconcileRunning` re-probes each configured port on the UI's poll
and forgets any that closed, which also withdraws that port's authorization to be
stopped. Because adopted servers are in `list()`, `findPreviewServerForUrl` now
guards their URLs too - the one-designated-tab rule covers servers Otto merely
found, not just ones it spawned.

Two things that have not changed. **Do not open a plain `browser_new_tab` at a
dev server's URL** - call `preview_start`, which binds the tab; the guard only
catches URLs of servers it knows about, so a server nobody declared in
`launch.json` will slip through as a detached tab. And **never force-kill a
process to clear a port**: Otto's daemon persistence is intentional, and the
running server may be another lane, another agent's, or the user's. There is no
longer any reason to - adopt it and look at it.

The one case for a second server on a different port is a user asking for one.
Weigh it against [Prefer the running server](#prefer-the-running-server): a
duplicate config and a duplicate port live in the repo forever, and that is how a
launch.json grows a tail of near-identical entries nobody can explain later.

## Previewing Otto itself

Previewing this repo means previewing Otto from inside Otto, which has two
wrinkles nothing else in `launch.json` has.

**Preview the agent lane, never the dev or installed lane.** The lanes and their
ports are in [development.md](development.md#lanes); the agent lane (daemon
`6799`, Metro `8095`) exists precisely so an agent can drive
and screenshot a real Otto without disturbing the human's. `otto-dev` claims `8081`,
and the `ext:` bulk-stop rule above documents what killing that costs you.

**`otto-agent` is the agent's entry, and it is the only one it needs.** It starts
the full lane - daemon `6799` plus Metro `8095` - so `preview_start otto-agent`
gets you a complete, isolated Otto to drive. There is deliberately no second
web-only variant beside it: one config per thing that can run is the rule, and a
`-preview` twin per lane is exactly the duplication
[Prefer the running server](#prefer-the-running-server) exists to stop.

If the lane is already up and was not started by Otto, `preview_start otto-agent`
adopts it - do not add a parallel config on a fresh port to route around it.

**Declaring a port is what makes an already-running server visible.** `otto-dev`
claims `8081`, which is also where the desktop dev shell's Expo lands
(`dev:win:desktop` probes `8081`–`8089`). That overlap is useful rather than
accidental: because the port is declared, a hand-started dev stack surfaces as
`ext:8081` instead of being invisible. It also means `otto-dev` adopts that stack
rather than spawning a second one over it - and the `ext:` bulk-stop rule above is
what keeps anything from tree-killing it.

**A preview on a new port is a new client origin.** The first-run wizard and tour
flags live in `localStorage` under `@otto:app-settings`, keyed to the **Metro
origin** - so a preview on `127.0.0.1:8096` does not inherit flags set on
`localhost:8095`, and boots into the wizard. Daemon-owned state (projects,
workspaces, chats) is unaffected, because that lives in `OTTO_HOME`, not the
browser. Re-run only the client half of the bootstrap against the new origin; see
[development.md](development.md#bootstrapping-it).

## launch.json

`.claude/launch.json`, resolved relative to the workspace's `cwd`
(`packages/server/src/server/preview/launch-config.ts` -
`LAUNCH_CONFIG_RELATIVE_PATH`), is the only location Otto reads; there's no
fallback path or alternate filename.

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "<unique-name>",
      "runtimeExecutable": "<command>",
      "runtimeArgs": ["<args>"],
      "port": 8200
    }
  ]
}
```

- `runtimeExecutable` - the command (`"npm"`, `"pwsh"`, `"python"`, …)
- `runtimeArgs` - argument array (`["run", "dev"]`)
- `port` - the local process port used for readiness polling, adoption, and stopping
- `url` - optional absolute HTTP(S) browser destination, including hostname, port,
  path, query, and fragment. When omitted, Otto uses `http://127.0.0.1:<port>/`.
  For example, add `"url": "http://localhost:3002/"` alongside `"port": 3002`
  when the app requires `localhost`. HTTPS and reverse-proxy addresses may use
  a different browser port from the local process port.
- `env` - optional per-config environment overrides

The base format is shared with other preview harnesses; `url` is an Otto extension.
The URL selects where the browser navigates. It does not change the command's
listen address, configure a proxy, or create a tunnel. The local `port` must still
be reachable by the daemon, and the URL must be reachable by the browser device.
Started and adopted servers both retain the configured URL. Existing files that
omit it keep their current behavior.
After editing `url`, the Preview picker refresh or another `preview_start` picks
up the address without restarting a running server. An already-bound tab stays at its current page;
use `browser_navigate` with the returned browser ID to visit the new address.

### launch.json is a shell-execution surface

`DevServerManager.spawnServer` runs `runtimeExecutable` with `runtimeArgs`
under `shell: true`, and there is no allowlist of permitted commands. Writing
the file is therefore equivalent to writing a shell script that Otto will run
on the next `preview_start`. That is fine while the file is pre-authored and
edits to it are gated, which is what "Always Ask" gives you: the write prompts,
so the command was seen before it could run.

acceptEdits breaks that assumption, because it auto-approves the write too. The
openai-compat provider is the runtime for its own tools (no CLI permission
system in front of it), so it carries the compensating check:
`PreviewStartGate`
(`packages/server/src/server/agent/providers/openai-compat-preview-start-gate.ts`)
snapshots every entry's executable, args and env when the session is
constructed, and `preview_start` keeps its auto-approval only while the entry
it names still matches that snapshot. An entry added or rewritten during the
session prompts once, and approving it re-baselines that exact command so a
normal edit-then-preview loop does not prompt again. The alternative,
classifying `preview_start` as `execute` so it always prompts, was rejected:
starting a preview is one of the most common agent actions, and a prompt every
time pushes users to bypassPermissions, which is strictly worse.

Either way the prompt now names the resolved command
(`npm run dev`, not just the server name), because a user approving a server
start could not previously see what launch.json would execute.

The gate is per session object, so a daemon restart between the write and the
`preview_start` re-baselines the changed config. A restart is a user action
rather than something the tool chain can trigger, so that residual is accepted.

### Capability detection

Detecting whether a project has Preview configured is just: does
`.claude/launch.json` exist, and does it parse? `readLaunchConfig(cwd)`
returns `null` on `ENOENT` (not configured - not an error), and throws a
`LaunchConfigError` with the offending path and a Zod validation message if
the file exists but is malformed. The `preview.list_config` RPC
(`session.ts`, `handlePreviewListConfigRequest`) wraps this into a response
carrying `configured`, the parsed `servers` list, and any currently
`runningServers` for that `cwd` - this is what both the Preview button and an
agent's own bootstrap check read.

There's no protocol-level capability flag (`server_info.features.*`) gating
Preview the way other recent features are gated per this repo's convention -
`DevServerManager` is constructed unconditionally at daemon bootstrap, so
availability is really "does the daemon have this code at all," which for a
running instance is always yes. A missing launch.json is a per-project
_configuration_ state, not a capability negotiation, and is handled entirely
by the `configured: false` response above rather than a COMPAT gate.

### Bootstrapping a new project

When a project has no `.claude/launch.json` yet, the canned entry point is a
user-style message auto-sent into the chat:

> Detect this project's dev servers and save their configurations to
> `.claude/launch.json` (create it if missing) using the format from the
> `preview_start` tool description. Then ask me which ones to start, and call
> `preview_start` for each one I pick.

The agent does the detection with its ordinary file-reading tools and writes
the file itself - nothing server-side is involved in generating it. This also
works unprompted: `preview_start`'s tool description embeds the file format
with create-if-missing instructions, and calling it against a project with no
config returns an actionable error naming the expected path, so an agent can
self-serve the same flow without the canned prompt.
