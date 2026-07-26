# Widgets

A **widget** is a fragment of HTML or SVG that an agent emits as a tool call, rendered inline in the
transcript at the point in the conversation where the call happened, inside a sandbox that can talk
back to the chat.

An artifact is a document the user keeps. A widget is a thought the model had in the middle of a
sentence. A chart explaining the answer is a widget; a prototype the user will come back to is an
artifact. They share sandbox plumbing and nothing above it.

## The mechanism

It is easy to misremember this as "the model writes HTML into its message and the client renders
it." It does not, and it must not — Otto's markdown pipeline refuses to render embedded HTML on
purpose (see [markdown-rendering.md](markdown-rendering.md)). A widget is an ordinary tool call:

| Field              | Purpose                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `widget_code`      | The fragment. Mode is auto-detected — a fragment starting with `<svg` is SVG, else HTML. |
| `title`            | snake_case identifier, used as the fallback row's label.                                 |
| `loading_messages` | 1–4 short lines shown while the fragment is still arriving.                              |

`loading_messages` and `title` are declared **before** `widget_code` in the tool schema, and that
ordering is load-bearing — see "Streaming" below.

A second tool, `widget_contract`, returns the host contract the model codes against. It is modular
(`diagram`, `chart`, `interactive`, `mockup`, `art`): a compact core, with a module fetched only
when the widget being written needs it. Claude's equivalent is ~99K characters; most of that is
aesthetic doctrine, and Otto is a token-cost-conscious fork
([token-economy.md](token-economy.md)). What is kept is the half a model cannot guess.

## Where the payload rides, and why not in `detail`

The widget payload lives under `metadata.ottoWidget`, **not** as a new `ToolCallDetail` variant.

`ToolCallDetailPayloadSchema` (`protocol/src/messages.ts`) is a `z.discriminatedUnion`. A client
that predates widgets, handed an unknown discriminator, does not skip the widget — it fails to parse
the **entire timeline message**. `metadata` is `z.record(z.string(), z.unknown())`, so an old client
carries the payload through untouched and renders the tool call's `plain_text` detail as an ordinary
row. That is the protocol contract working exactly as intended, and it is the reason the charter's
original "new detail type" plan was not built.

The daemon downgrades the detail to `{ type: "plain_text", label: "Widget", text: <title> }` for
precisely that fallback.

## Provider neutrality

Normalization happens once, at `AgentManager.recordAndDispatchTimelineItem` — the single point every
timeline item passes through, on every provider, on both the direct stream path and the coalescer's
flush. There is no per-provider widget code. Any provider that surfaces a tool call with its input
gets widgets for free.

The one wrinkle worth knowing: Otto's catalog reaches models under **two different names**.
Providers hosting an MCP client see `mcp__otto__show_widget` (or dotted `otto.show_widget`); the
openai-compat provider injects the catalog natively into its own tool loop and exposes each tool
under its **bare** name (`buildOttoToolPayload`). `widget-timeline.ts` matches both. Matching only
the namespaced form silently gives widgets to Claude and not to local models — the exact
single-provider gap this fork exists to close.

Normalization is idempotent (guarded on the detail still being `unknown`), because the chokepoint
runs it on the way to both the stream and the store, and history import runs it again on replay.

## Streaming, and why there is no token-by-token render

Claude's host renders the fragment as it streams. Otto renders it complete, and that is a deliberate
consequence of a correct decision elsewhere.

Claude's provider path does surface partial tool inputs — `input_json_delta` accumulates into
`handleToolInputDelta` and pushes a running tool call. But `parsePartialJsonObject` **withholds
incomplete string values on purpose**, so an `old_string` is never half-matched against a file.
`widget_code` is a string, so it never appears half-written; it lands whole the moment its JSON
string closes.

This is why the schema declares `loading_messages` and `title` first: those arrive early, so the
pending state shows the model's own loading messages rather than a dead spinner. The widget then
renders once, complete. Several rules in Claude's contract (script ordering, no `display: none`, no
gradients) exist only to survive a mid-stream DOM and are therefore moot here — harmlessly, since a
model following them anyway produces the same output.

## The sandbox

Three renderers, one `WidgetFrameProps` interface, differing from the artifact renderers in exactly
two ways: content-driven height instead of `flex: 1`, and a message bridge.

| Platform | File                               | Mechanism                                                                  |
| -------- | ---------------------------------- | -------------------------------------------------------------------------- |
| Native   | `app/src/widgets/widget-frame.tsx` | `react-native-webview`, `postMessage`/`onMessage`, `scrollEnabled={false}` |
| Web      | `…/widget-frame.web.tsx`           | `<iframe srcDoc>`, sandboxed, transferred `MessagePort`                    |
| Electron | `…/widget-frame.electron.tsx`      | `<webview>` on partition `otto-widget-preview`, with a preload             |

**Web** omits `allow-same-origin`, as artifacts do. That makes the frame's origin the opaque string
`"null"`, so `event.origin` proves nothing and cannot authenticate the guest. The transport is a
`MessageChannel` instead: the host mints a channel on load and transfers one port in. Identity is
the port, not the origin. Do not be tempted to add `allow-same-origin` to "fix" validation.

**Electron** needs a `<webview>` for the reason recorded on the artifact renderer: the app shell's
`script-src 'self'` CSP is injected onto `defaultSession` and is inherited by same-document iframes,
so a `srcDoc` iframe has its inline scripts blocked. A widget with no scripts has no bridge and no
height reporting, so this is not optional on desktop.

Widgets are also the **one guest type that gets a preload**. `main.ts` strips the renderer-supplied
preload for artifact guests because they need no channel; for widget guests it deletes whatever the
renderer asked for and substitutes a main-process-owned path, so a compromised renderer cannot point
a guest at arbitrary code. The preload exposes exactly one function through `contextBridge` and
nothing else.

### Height

`ResizeObserver` on the guest → `{ type: "height", px }` → the host sizes the frame. Clamped to
24–4000px. On compact form factors a widget taller than 420px is collapsed behind a "Show full
widget" control, so one tall widget cannot swallow a phone screen.

Height is the load-bearing message: it is the **only** thing standing between a correct widget and
one clipped at the host's initial 120px, and on desktop it can only travel over the preload. Electron
drops a missing preload **silently** — the guest still loads, still runs its own scripts, still
renders — so a broken preload path presents as a rendering bug, not a packaging one. `dist/features/`
is one level below the bundle root, which is why `getWidgetPreloadPath()` joins `..`; a test pins
that, and a missing file is logged loudly rather than shrugged off.

## The two host globals

- **`sendPrompt(text)`** — sends a message to the chat as if the user typed it.
- **`openLink(url)`** — routes through Otto's link-confirmation path. Plain `<a href>` clicks are
  intercepted into the same path.

`sendPrompt` is a privilege, not a convenience, and is fenced accordingly:

- **Active-chat gate.** A chat's composer registers itself as the sender while mounted. A widget
  resolves its target from that registry, so one in a background tab, an archived chat, or a
  transcript nobody has open finds no sender and does nothing. The gate is structural, not a flag.
- **Caps.** 2,000 characters, one second minimum between sends, 20 sends per widget per session.
- **Non-destructive send path.** It routes through the composer's `submitMessage`, not the full
  submit path — a widget's message must not clear a draft the user is halfway through typing, and
  must not force-interrupt a running turn.

The turn appears as an ordinary user message. Attribution today is by proximity: the user clicked
something and a message appeared next to it. A first-class "sent by a widget" marker on user
messages would be a protocol change and was not made.

## Network: none

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'
```

Claude's widget host permits five public CDNs plus Google Fonts, which is what makes its `chart`
module's Chart.js/D3 vocabulary work. **Otto ships none of it**, and this is a deliberate deviation
from the charter's recommendation (which was to vendor the libraries and serve them from the
daemon). Three reasons, all pointing the same way:

1. A widget rendered on a phone over the relay cannot reach a daemon-local asset origin — the scheme
   degrades in exactly the case Otto exists for.
2. Inlining a library per widget puts 200–400KB into the timeline on every call, re-sent on every
   backfill.
3. A model-authored fragment may be reflecting content the model read from a hostile file or page,
   and an outbound URL is a payload.

So charts are hand-rolled SVG, and the `chart` module of the contract teaches exactly that. The
icon set is the same trade made smaller: rather than a 5800-glyph Tabler webfont, ~40 curated glyphs
drawn in Tabler's outline language and applied as CSS masks so they inherit `currentColor`. The
contract lists every name that exists, so the model never guesses.

Reopening this needs an asset origin that survives relay — not a CDN allowlist.

## Theming

The **host** assembles the guest document, not the daemon. Only the client knows which theme is
live, and a theme switch has to re-skin a mounted widget without a daemon round trip.

`buildWidgetTheme` maps Otto's semantic tokens onto the widget CSS variables as **concrete** values
— never `var(--colors-…)` references, because the guest has its own `:root` and cannot see the
host's cascade, and the role-tint math needs real hex to composite against. It is read through
`withUnistyles` at the single leaf that renders a frame, so a theme change does not re-render the
transcript around it.

The variable names (`--surface-*`, `--text-*`, `--border-*`, `--bg-*`, `--font-*`, `--radius`,
`--pad-*`, `--gap-*`, the `--c-*` categorical palette, and the `.c-*`/`.s-*`/`.t`/`.ts`/`.th` SVG
classes) are frozen in `protocol/src/widgets/theme.ts` and documented to the model in the contract.
Changing one is a breaking change to every widget ever written.

## Sanitizing

`server/src/server/widget/widget-fragment.ts`, deliberately **not**
`artifact/html-validator.ts`. That one is written for whole documents: it trims everything after
`</html>` and its validity check requires a DOCTYPE or an `<html>` tag. Both are exactly wrong for a
fragment — a valid widget with neither would be judged invalid, and a widget that merely _mentions_
`</html>` in a code sample would be silently truncated.

The fragment pass strips code fences, unwraps a whole document to its body (carrying `<head>` styles
down so the widget keeps its look), rejects prose, and caps at 128,000 characters. It is a
normalizer, not a security boundary — containment is the CSP plus the per-platform sandbox.

A fragment that fails sanitizing renders as **visible text saying why**. A blocked resource or a
thrown script renders as a visible error. Never a blank box: silent failure is how a broken widget
gets mistaken for a working one.

## Persistence

There is none, and none is needed. The tool-call input _is_ the content, so a re-opened or retained
chat re-renders its widgets from the stored timeline. No separate store, no file.

## Settings

`show_widget` and `widget_contract` live in the `widgets` tool group, surfaced in Host settings
alongside Artifacts. Widgets are also excluded from action grouping — the fragment is the content
the model is showing, so it must never collapse into a "used 3 tools" summary.

## Decisions taken

- **Unattended runs.** No gate was built. The self-prompting-loop risk that motivated one is already
  closed by the active-chat gate: an unattended run has no mounted composer, so `sendPrompt` finds
  no sender. A widget in an unattended transcript is inert until someone opens it, which is correct.
- **Promotion to an artifact** ("keep this") was not built. Cheap to add later, wrong to design for
  now.
- **Visualizer node view** does not render widgets. Chat-surface object for now.
