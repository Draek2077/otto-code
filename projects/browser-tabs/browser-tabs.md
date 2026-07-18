# Browser tabs — meeting Claude's tab-based browser contract where Otto already is

_Charter, 2026-07-17._

## Reframe: Otto is not missing tabs

Claude Desktop's browser pane recently promoted tabs to first-class citizens:
`tabs_create` / `tabs_close` / `tabs_select` / `tabs_context`, an optional
`tabId` parameter on every browser tool, and `preview_start {url}` for opening
external sites with no dev server. The obvious framing — "Otto has zero tab
tools, port the contract" — is wrong. Otto's browser-tools subsystem has been
tab-based since it shipped:

- `browser_list_tabs`, `browser_new_tab`, `browser_close_tab` exist today.
- **Every** tab-scoped tool takes a mandatory `browserId` — strictly stronger
  than Claude's optional `tabId` (which defaults to "the fronted tab").
- The Otto browser pane is already multi-tab, multi-pane, with tab identity
  minted app-side (`createBrowserId()`), a per-host `browserId → client`
  affinity map in the daemon broker, and workspace scoping enforced on both
  ends.
- External sites already work: `browser_new_tab` takes any http(s) URL.

So this project is not "implement tabs." It is: **map the two contracts,
adopt the handful of affordances Claude's tooling has that ours genuinely
lacks, and keep the places where Otto's contract is deliberately stronger** —
so a Claude model driving Otto's tools finds every concept it knows from its
native harness, under guardrail-bearing descriptions it can't misuse.

## The two contracts, mapped

Claude Desktop tool → Otto equivalent. "Parity" = concept fully covered today.

| Claude Desktop                                       | Otto                                                            | Verdict                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs_context` (list `{tabId, origin, isActive}`)    | `browser_list_tabs`                                             | Parity+. Otto returns full `url`/`title` (richer; see "Divergences" on the injection-surface tradeoff).                                                         |
| `tabs_create` (blank tab, fronts it)                 | `browser_new_tab {url?}`                                        | Parity. Otto opens in background deliberately (doesn't hijack the user's view) and takes the URL up front instead of a blank-then-navigate dance.               |
| `tabs_select` (front a tab)                          | — (**gap**)                                                     | **Adopt** as `browser_focus_tab`. Named to avoid confusion with `browser_select` (the `<select>`-option tool).                                                  |
| `tabs_close`                                         | `browser_close_tab`                                             | Parity.                                                                                                                                                         |
| optional `tabId`, default = fronted tab              | mandatory `browserId`                                           | **Keep Otto's.** See "Divergences."                                                                                                                             |
| `navigate` (url \| "back" \| "forward")              | `browser_navigate` / `_back` / `_forward` / `_reload`           | Parity, split into 4 tools. Otto adds the preview-tab redirect enforcement Claude has no equivalent of.                                                         |
| `preview_start {name}` / `_list` / `_logs` / `_stop` | same names, same shapes                                         | Parity (deliberately — same `.claude/launch.json`). Otto adds workspace-scoped stops and the `ext:` protections.                                                |
| `preview_start {url}` (external site, no server)     | `browser_new_tab {url}`                                         | Parity by mapping. Otto keeps the clean split: `preview_*` = dev servers, `browser_new_tab` = external sites. No `{url}` overload.                              |
| `read_page` (a11y tree, `ref_N`)                     | `browser_snapshot` (aria-yaml, `@eN`)                           | Parity. Claude's `filter`/`depth`/`ref_id` scoping knobs deferred (our snapshot is already pruned).                                                             |
| `find` (search last tree)                            | — (gap)                                                         | Defer. The model can search the snapshot text it already holds; value only appears with truncated giant pages.                                                  |
| `get_page_text` (article/main-first innerText)       | — (**gap**)                                                     | **Adopt** as `browser_page_text`. Token economy: reading an article via `browser_snapshot` pays for structure the reader doesn't need.                          |
| `form_input`                                         | `browser_fill` + `browser_select`                               | Parity, split.                                                                                                                                                  |
| `javascript_tool`                                    | `browser_evaluate`                                              | Parity (Otto adds element-ref injection).                                                                                                                       |
| `read_console_messages`                              | `browser_logs`                                                  | Parity-ish. Claude's `pattern`/`onlyErrors` filters deferred.                                                                                                   |
| `read_network_requests`                              | `browser_network`                                               | Parity (`filter` + on-demand body by `requestId`).                                                                                                              |
| `resize_window` (presets, `colorScheme`)             | `browser_resize` (raw px only)                                  | **Adopt**: presets (`mobile`/`tablet`/`desktop`) + `colorScheme` (dark-mode verification is a first-class step in the verification workflow).                   |
| `computer` (unified input actions)                   | `browser_click/type/keypress/hover/drag/scroll/screenshot/wait` | Parity, granular — better for non-frontier models (small schemas, one purpose each). Coordinate clicks / `zoom` region / `scroll_to` / `triple_click` deferred. |
| —                                                    | `browser_inspect`                                               | Otto extra (computed styles — better than screenshots for precision, per docs/preview.md).                                                                      |
| —                                                    | `browser_upload`, `browser_wait` (condition-based)              | Otto extras.                                                                                                                                                    |

## Deliberate divergences (kept, on principle)

These are places Otto's contract is intentionally different, and the charter's
position is to keep them. They come straight from docs/preview.md's design
principles ("descriptions steer, the daemon enforces").

1. **Mandatory `browserId`, no fronted-tab default.** Claude's optional
   `tabId` works because one user drives one pane. Otto is a multi-agent
   daemon: several agents can hold browser tools against the same workspace
   concurrently, and "the fronted tab" is whatever the user last clicked —
   an unstable, user-owned pointer. An implicit default would silently
   retarget an agent's actions mid-task. Explicit `browserId` is also what
   makes the preview-tab redirect enforcement (`findPreviewServerForUrl`)
   checkable at all.
2. **Granular tools instead of one `computer` mega-tool.** One action per
   tool keeps schemas small and steering text local to the action — that's
   load-bearing for local models (the openai-compat provider), which is the
   fork's mission. Claude models handle either shape fine.
3. **`preview_*` vs `browser_new_tab` split stays.** No `preview_start {url}`
   overload: a preview server is a supervised process with a designated tab
   and lifecycle; an external site is just a tab. Overloading one entry point
   re-blurs a distinction the daemon enforces elsewhere.
4. **Background tab creation.** `browser_new_tab` doesn't steal the user's
   focus; `browser_focus_tab` (new, below) makes fronting an explicit,
   auditable act — which is _more_ aligned with "show the user proof" than
   auto-fronting every tab an agent opens.

## Adopted now (this project's build scope)

Three gap closures, all provider-neutral, all extending the existing
browser-tools stack (no parallel browser stack):

### 1. `browser_focus_tab` — front a tab (Claude: `tabs_select`)

The one genuinely missing tab verb. Agents can open background tabs and bind
preview tabs but have no way to bring the proof into the user's view.

- New wire command `focus_tab` (args: `browserId`), handled **app-side** in
  `packages/app/src/browser-automation/handler.ts` like `new_tab`/`close_tab`
  (it's a layout operation, not a webview operation): resolve via
  `findWorkspaceBrowserTab`, then `useWorkspaceLayoutStore.getState().focusTab(...)`.
- Desktop service (`packages/desktop/.../service.ts`) gets the standard
  "handled by the app runtime" stub, same as `new_tab`/`resize`/`close_tab`.
- Description steers: use it when you want the user to see a tab (after
  verification proof, or when opening something on their behalf) — not on
  every action.

### 2. `browser_page_text` — reader-mode text (Claude: `get_page_text`)

Token-economy tool for _reading_ rather than _interacting_: returns
`article`/`main`/`[role="main"]`-first `innerText` (fallback `body`), capped
by `maxChars` (default 20k) with a `truncated` flag and the `source` that was
used. Runs in the desktop service via `executeJavaScript`, like `inspect`.
Snapshot stays the tool for structure/refs; descriptions cross-steer.

### 3. `browser_resize` presets + color scheme (Claude: `resize_window`)

- `preset: "mobile" | "tablet" | "desktop"` (375×812 / 768×1024 / 1280×800 —
  Claude's exact dimensions, so cross-harness muscle memory transfers).
  Expanded **daemon-side** in tools.ts to width/height; zero wire change.
- `colorScheme: "light" | "dark" | "auto"` — emulates `prefers-color-scheme`
  so agents can verify dark mode without touching OS settings. This is a
  **new wire command `set_color_scheme`** (CDP `Emulation.setEmulatedMedia`
  in the desktop service), issued by the `browser_resize` tool as a second
  broker call when the arg is present. `width`/`height` become optional:
  exactly one of `preset` or `width`+`height`, or `colorScheme` alone.

### 4. Screenshot normalization + element zoom (Claude: screenshot sizing, `zoom`)

The one piece of Claude Desktop's vision-first machinery worth stealing,
decoupled from coordinates: screenshots sized for the model that reads them.
Vision APIs downscale past ~1568px long edge / ~1.15 megapixels and charge
by pixel area — so oversized captures cost more AND read worse.

- **Viewport captures are DPR-normalized**: scaled back to CSS pixels (a 2×
  display quadruples token cost for zero legibility once the API downscales)
  and fitted to the budget. Implemented in the desktop service via
  `NativeImage.resize` (the adapter passes Electron's image straight through,
  so the optional `TabImage.resize` needs no wrapper).
- **Full-page captures render the CDP clip at reduced `scale`** instead of
  shipping a giant strip. The result carries `scale` (optional field on the
  screenshot result — response schemas are non-strict, so old daemons strip
  it safely), and the daemon warns below 60%: use viewport shots +
  `browser_scroll`, or zoom an element.
- **`browser_screenshot { ref }`** routes to a new wire command
  `screenshot_element`: the element's box (+8px pad) re-rendered via CDP at
  up to 3× — a vector re-render, so small text comes out crisp, unlike
  Claude's pixel-space `zoom`. Same new-command compat pattern as
  `set_color_scheme` (strict args forbid growing the existing `screenshot`
  command).
- Budget is deliberately conservative (multi-provider: old Claude caps,
  OpenAI tiling, local vision models). Newest Claude tiers accept 2576px;
  a per-provider budget knob is possible later if screenshots-as-perception
  ever matters more than screenshots-as-proof in Otto's ref-based flow.

JPEG encoding was considered and rejected for now: token cost depends only
on dimensions, not bytes; dimension normalization delivers the whole token
win, and widening the result `mimeType` literal is an old-daemon parse break
that would need a `server_info.features` gate. Revisit if wire size over the
relay becomes a complaint (docs/preview.md's old "JPEG never PNG" claim is
corrected to describe dimension normalization).

### Compatibility

No `server_info.features.*` flag needed: browser hosts already negotiate
per-command via `CLIENT_CAPS.browserHost.supportedCommands` (the app spreads
`BROWSER_AUTOMATION_COMMAND_NAMES` from its bundled protocol, so an old app
simply doesn't advertise `focus_tab`/`page_text`/`set_color_scheme` and the
broker returns a clean `browser_unsupported` naming the host). That is the
existing degradation path, not a new fallback path.

Wire-schema rule respected the hard way: the command `args` objects are
`.strict()`, so **new args on existing commands are a protocol break** for
old hosts (they'd reject the unknown key). That's why `colorScheme` ships as
a new command rather than a new `resize` arg, and why `preset` never leaves
the daemon. (`browser_resize`'s tool-level input schema is daemon-local and
free to grow; the wire `resize` command is untouched.)

## Deferred (ranked, with reasons)

| Item                                                                                      | Why deferred                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-origin approval for external navigation (Claude's approval card)                      | Real safety feature, but a product surface (approval UI + per-origin store + daemon gate), not a tool-contract patch. Deserves its own charter; today's gate is the daemon-level browser-tools opt-in with its trust warning. |
| `find` over the last snapshot                                                             | Model already holds the snapshot text; wins only on truncated pages. Revisit with snapshot `filter`/`depth` knobs as one "snapshot scoping" bundle.                                                                           |
| Snapshot scoping (`filter: interactive`, `depth`, `ref_id` subtree)                       | Same bundle as above.                                                                                                                                                                                                         |
| `computer`-style coordinate clicks, `scroll_to`                                           | Ref-based interaction covers the verification workflow; coordinates matter for canvas/games. (`zoom` shipped as `browser_screenshot { ref }` — see Adopted §4.)                                                               |
| `browser_logs` `pattern`/`onlyErrors` filters                                             | Cheap, low-stakes; batch into the next browser-tools touch.                                                                                                                                                                   |
| Origin-only `browser_list_tabs` (Claude returns origins because titles are page-authored) | Titles/urls are load-bearing for Otto's re-find-the-tab flows. The injection surface is real but marginal — page content flows into snapshots anyway. Revisit under a broader injection-hardening pass.                       |

## File map (build)

| Layer    | File                                                          | Change                                                                                                                                          |
| -------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol | `packages/protocol/src/browser-automation/rpc-schemas.ts`     | `focus_tab`, `page_text`, `set_color_scheme`, `screenshot_element` commands + results; optional `scale` on the screenshot result                |
| Daemon   | `packages/server/src/server/browser-tools/tools.ts`           | `browser_focus_tab`, `browser_page_text` tools; `browser_resize` presets + `set_color_scheme` call; `browser_screenshot` ref routing; summaries |
| App      | `packages/app/src/browser-automation/handler.ts`              | local `focus_tab` handling (layout store)                                                                                                       |
| Desktop  | `packages/desktop/src/features/browser-automation/service.ts` | `page_text` + `set_color_scheme` + `screenshot_element` executors; viewport/fullPage screenshot normalization; `focus_tab` app-runtime stub     |
| Tests    | `tools.test.ts`, `service.test.ts`                            | per new tool/command                                                                                                                            |

On ship: fold the mapping table's durable conclusions into docs/preview.md
and delete this folder, per the projects convention.
