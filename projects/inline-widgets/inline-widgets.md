# Inline Widgets

**Status:** Charter — nothing built.
**Created:** 2026-07-24
**Shape:** Provider-neutral tool + inline chat renderer + host bridge.

An agent emits a tool call carrying a fragment of HTML or SVG. Otto renders it inline in the
conversation, at the point in the transcript where the call happened, in a sandbox that can talk
back to the chat. That is the whole feature.

This is the same leveling-up pattern as Preview and artifacts: take a capability a frontier harness
gives its own model, and ship it for every provider. Claude Desktop has it today via an MCP server
named `visualize`. Otto has no equivalent.

---

## 1. What a widget actually is

The mechanism is worth stating precisely, because it is easy to misremember as "the model writes
HTML into its message and the client renders it." It does not.

A widget is **an ordinary MCP tool call**. The server is `visualize`; the tool is `show_widget`.
The markup lives in the `widget_code` argument. Nothing is embedded in the assistant's text
content, and there is no "user asks to see it" step — the host renders it as it streams.

Verbatim from a stored Claude Code transcript
(`~/.claude/projects/C--Users-phili-Projects-otto-code/a5b374f0-….jsonl`):

```json
{
  "type": "tool_use",
  "id": "toolu_016BFnTX3mfXPuj1fRcZPbjf",
  "name": "mcp__visualize__show_widget",
  "input": {
    "loading_messages": ["Nudging eyes toward the nose", "Recentering the eyebrow bars"],
    "title": "otto_robot_wordmark_concept_v2",
    "widget_code": "<h2 class=\"sr-only\" style=\"position:absolute;width:1px;…\">Revised Otto logo concept…</h2>\n<svg width=\"0\" height=\"0\" aria-hidden=\"true\">…"
  }
}
```

Three parameters carry the payload:

| Field              | Purpose                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `widget_code`      | The fragment. Auto-detected: starts with `<svg` → SVG mode, otherwise HTML mode. |
| `title`            | snake_case identifier. Also the download filename.                               |
| `loading_messages` | 1–4 short strings shown while the fragment streams in.                           |

The server exposes a second tool, `read_me`, which returns the host contract the model must code
against — 99,493 characters across 1,189 lines, with loadable modules (`diagram`, `mockup`,
`interactive`, `chart`, `art`). The model is instructed to call it before its first `show_widget`.
That document is both a design system and a runtime spec; section 3 extracts the runtime half.

**Seeing what a model generates costs nothing.** It is plaintext in the tool-call input, recorded
in the transcript. Five transcripts in this project already contain `show_widget` calls. The
generation side is fully observable today — no instrumentation needed.

---

## 2. Widgets are not artifacts

Otto shipped artifacts already. They are a different object and must not be conflated, or the
implementation will bend one into the other and serve neither.

|                | **Artifact** (shipped)                                           | **Widget** (this charter)                                 |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| Storage        | File-backed — `filePath` in `protocol/src/artifacts/types.ts:26` | Inline in the tool call. No file.                         |
| Kind           | `z.enum(["html"])` — full documents                              | Fragment: HTML _or_ SVG                                   |
| Lifetime       | Persisted, versioned, regenerable, survives the chat             | Lives and dies with its transcript position               |
| Placement      | Side panel, dedicated tab, grid screen                           | Inline, in transcript order                               |
| Document shape | Full page — DOCTYPE, `<html>`, `<head>`                          | Fragment only — no DOCTYPE, no `<html>`/`<head>`/`<body>` |
| Sizing         | Fills its pane, `flex: 1`                                        | Content-driven height, no scrolling of its own            |
| Theming        | Ships its own CSS                                                | Inherits host CSS variables, must work light _and_ dark   |
| Talks back     | No                                                               | Yes — `sendPrompt()` and `openLink()`                     |
| Network        | Hard-blocked (`connect-src 'none'`)                              | Claude allows a CDN allowlist — open decision, see §6.1   |

The useful summary: **an artifact is a document the user keeps; a widget is a thought the model had
in the middle of a sentence.** A chart explaining the answer is a widget. A prototype the user will
come back to is an artifact.

They should share the sandbox plumbing and share nothing above it.

---

## 3. The host contract we would be implementing

Extracted from `read_me`. These are the constraints the generated code is written against, so
Otto's renderer has to honour them or every widget a model writes will be subtly broken.

### Structural

- **Fragments only.** No DOCTYPE, `<html>`, `<head>`, `<body>`. Content starts immediately.
- **Container is `display: block; width: 100%`.** No wrapper div expected from the model.
- **Height is content-driven.** The frame viewport sizes itself to in-flow content. This is why
  `position: fixed` is banned in generated code — it collapses the frame to `min-height: 100px`.
  Modal mockups are told to use a normal-flow faux-viewport div instead.
- **No nested scrolling.** Auto-fit height; the chat scrolls, the widget does not.
- **Transparent outer background** — the host supplies the page background.

### Theming

The host injects CSS variables the fragment consumes. All auto-adapt to light/dark:

- Surfaces: `--surface-2`, `--surface-1`, `--surface-0`; role tints `--bg-{accent,danger,success,warning}`
- Text: `--text-primary`, `--text-secondary`, `--text-muted`; role `--text-{accent,danger,success,warning}`
- Borders: `--border`, `--border-strong`, `--border-stronger`; role `--border-{accent,danger,success,warning}`
- Type: `--font-sans`, `--font-voice` (serif), `--font-mono`
- Layout: `--radius` (8px), `--pad-{sm,md,lg,xl}`, `--gap-{xs,sm,md,lg,xl}`

Dark mode is mandatory in the contract — SVG uses pre-built colour classes (`c-blue`, `c-teal`,
`c-amber`) and text classes (`t`, `ts`, `th`) that the host stylesheet defines.

A Tabler **outline** icon webfont (5800+ glyphs) is described as "already loaded", used as
`<i class="ti ti-home"></i>`. Otto would have to actually load it — see §6.1.

### The two host globals

This is the part that makes a widget a control surface rather than a picture, and it is the piece
Otto has no precedent for:

- **`sendPrompt(text)`** — sends a message to chat as if the user typed it. The contract tells the
  model to use it whenever the next step benefits from Claude thinking, and to handle filtering,
  sorting and arithmetic in local JS instead.
- **`openLink(url)`** — routes through the host's link-confirmation dialog. Plain `<a href>` clicks
  are intercepted into the same path.

### Streaming

The contract assumes token-by-token rendering and shapes the code for it:

- Order is `<style>` (short) → content HTML → `<script>` last; SVG puts `<defs>` first.
- Inline `style="..."` is preferred over `<style>` blocks so controls look right mid-stream.
- Scripts execute only after streaming completes.
- No `display: none` sections, tabs, or carousels — hidden content streams invisibly.
- No gradients/shadows/blur — they flash during streaming DOM diffs.

### Network

CSP-enforced allowlist: `cdnjs.cloudflare.com`, `esm.sh`, `cdn.jsdelivr.net`, `unpkg.com`,
`fonts.googleapis.com`, `fonts.gstatic.com`. Everything else silently fails. Libraries load as UMD
globals via `<script src>` before any inline script that uses them. The `chart` module's guidance
is built on Chart.js and D3 loaded this way.

### Accessibility

HTML widgets open with a visually-hidden `<h2 class="sr-only">` one-sentence summary. SVG widgets
use `role="img"` with `<title>` and `<desc>`.

---

## 4. What Otto already has

More than half the hard parts, because artifacts paid for them.

**A sandboxed HTML host on all three platforms**, all with the identical
`ArtifactHtmlViewProps { html: string }` interface:

| Platform | File                                                           | Mechanism                                                                                                                     |
| -------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Native   | `packages/app/src/components/artifacts/artifact-html-view.tsx` | `react-native-webview`, empty `originWhitelist`, file access off                                                              |
| Web      | `…/artifact-html-view.web.tsx`                                 | `<iframe srcDoc>`, `sandbox="allow-scripts allow-forms allow-popups allow-modals"` — `allow-same-origin` deliberately omitted |
| Electron | `…/artifact-html-view.electron.tsx`                            | `<webview>` on partition `otto-artifact-preview`, `data:` URL                                                                 |

The Electron file carries a comment worth preserving into any widget work: the app shell's
`script-src 'self'` CSP is injected onto `defaultSession` and **is inherited by same-document
iframes**, which is why a plain `srcDoc` iframe has its inline scripts blocked in Electron and a
`<webview>` guest on its own session is required. This is already recorded in the
`csp-iframe-inheritance-webview-escape` memory. Any widget renderer hits the same wall.

**Server-side sanitisation and CSP injection** — `packages/server/src/server/artifact/html-validator.ts`
(108 lines): strips markdown code fences, trims trailing prose after `</html>`, injects a CSP meta
tag idempotently.

**A tool catalog with per-group gating** — `packages/server/src/server/agent/tools/otto-tools.ts`
(4,673 lines). `createOttoToolCatalog` at :988, dependency interface at :132, and a
`registerTool(name, { title, description, inputSchema, outputSchema }, handler)` shape. Groups are
declared in `@otto-code/protocol/provider-config` and surfaced in Host settings via
`packages/app/src/screens/settings/otto-tools-config.ts`.

**A precedent for "tool call becomes chat UI"** — `spawn_task` (otto-tools.ts:2537) produces the
Suggested Tasks chips rendered by `packages/app/src/suggested-tasks/overlay.tsx`. Widgets are the
same pattern with a heavier renderer.

**A tool-call presentation layer** — `packages/app/src/tool-calls/presentation.ts`,
`buildToolCallPresentation`, is where a tool call turns into UI metadata.

---

## 5. The gaps, ranked by real cost

### 5.1 Content-driven auto-height — the actual hard problem

Every existing renderer is a full-pane host: `flex: 1`, `width: 100%`, `height: 100%`. A widget must
be as tall as its content and no taller, inside a scrolling chat list, on three platforms, while
the content is still arriving.

The mechanism is the same everywhere — the guest measures itself and posts its height to the host,
which sizes the frame:

```
ResizeObserver on documentElement → post { type: "height", px } → host sets frame height
```

The per-platform cost differs:

- **Web** — the iframe has no `allow-same-origin`, so its origin is `"null"`. `postMessage` still
  works, but `event.origin` is useless for validation. Handshake with a `MessageChannel` port
  transferred in at load and validate on the port identity, not the origin. Do not be tempted to
  add `allow-same-origin`; it would hand the guest access to the parent document.
- **Electron** — the guest is a `data:` URL on a separate partition. Reaching the host needs a
  preload script on the `<webview>` and `ipcRenderer.sendToHost`. The preload is also the natural
  place to define `sendPrompt`/`openLink`.
- **Native** — `injectedJavaScriptBeforeContentLoaded` to define the globals,
  `window.ReactNativeWebView.postMessage` + `onMessage` for the return path.

Height must be debounced and clamped, and it must not fight the chat's scroll anchoring. A widget
that grows after the user has scrolled past it is a jank source.

### 5.2 The `sendPrompt` / `openLink` bridge

Same three transports as above. Beyond transport, this needs policy:

- `sendPrompt` injects text into the chat **as the user**. That is a privilege. It must be
  rate-limited, length-capped, and gated on the widget being in the _active_ chat — a widget in a
  background tab must not be able to type into it.
- It should be visible. The user should see the message appear as a normal user turn, not have the
  agent mysteriously continue.
- `openLink` routes to Otto's existing link-confirmation path, not `window.open`.
- Untrusted-content rule: the fragment is model-generated and may itself be reflecting content the
  model read from a hostile file or web page. `sendPrompt` text is data, and the resulting turn
  should be attributed so a reader can tell it came from a widget click.

### 5.3 Inline placement in the transcript

`packages/app/src/components/message.tsx` is 3,574 lines. Widgets need to render at their tool
call's position, which means touching that file or extending the tool-call presentation layer
around it.

**The markdown pipeline is not an option and must not be used.** `docs/markdown-rendering.md` is
explicit: Otto translates embedded HTML rather than rendering it, `markdown-it` runs with
`html: false`, and unknown tags unwrap to their text. That policy is correct and should not be
weakened. A widget is not markdown content — it is a tool-call-anchored renderer that sits beside
the markdown, exactly as the Suggested Tasks card does.

### 5.4 The host stylesheet

`--surface-*`, `--text-*`, `--border-*`, the font and layout tokens, the SVG colour classes
(`c-blue`, `c-teal`, …) and text classes (`t`, `ts`, `th`) all have to exist inside the guest,
mapped to Otto's theme tokens from `docs/design.md`, in both modes. This is a bounded, unglamorous
piece of work and it gates everything visual.

### 5.5 Streaming

Claude renders the fragment as it arrives. Whether Otto can do the same depends on whether partial
tool-call inputs reach the client — a grep of `packages/app/src/types/stream.ts` found no
`input_json_delta` handling, so the current answer looks like _no_, but this is **unverified** and
must be checked before committing to a phase.

If partial inputs are unavailable, v1 renders on tool-call completion and shows `loading_messages`
until then. That is a legitimate cut, and it makes several contract rules (script ordering, no
`display: none`, no gradients) irrelevant for us while remaining harmless — the model will follow
them anyway.

### 5.6 Provider rollout

Per the fork's rule, a capability is done when every provider has it. `show_widget` goes in the
Otto tool catalog, so Claude and the native openai-compat loop get it through their existing
injection paths. The per-provider question is whether each surfaces tool calls to the client with
enough fidelity to anchor a renderer. Codex/Copilot/OpenCode need a check, not an assumption.

---

## 6. Design decisions to make before building

### 6.1 Network policy — the one genuinely contested call

Claude's widget CSP permits five CDNs plus Google Fonts. Otto's artifact CSP permits nothing:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'
```

That `connect-src 'none'` is deliberate and documented as "the one hardening layer that reaches all
platforms". Three options:

- **(a) Match Claude** — allow the five CDNs. Chart.js and D3 work, so the `chart` and `art`
  modules' whole design vocabulary works. Cost: a model-authored fragment can now make outbound
  requests to four public CDNs, which is an exfiltration channel (a URL is a payload). Directly
  contradicts the existing artifact posture.
- **(b) Match artifacts** — no network at all. Safest, and consistent. Cost: no Chart.js, no D3,
  no webfont. Charts become hand-rolled SVG. A large slice of what makes widgets impressive is off
  the table.
- **(c) Vendor the short list** — keep `connect-src 'none'`, and serve Chart.js, D3 and the Tabler
  webfont from the daemon over a `self`-scoped origin, injected into the guest. Cost: bundle size,
  and we own version bumps.

**Recommendation: (c).** It preserves the hardening posture that artifacts already committed to,
keeps the two libraries the contract actually leans on, and avoids a per-widget network surface. It
is more work than (a) and less risk than (a) by a wide margin. Note that (c) also removes the
"silently fails" failure mode — a model reaching for an un-vendored library gets a blocked request
either way, so the guest should surface that as a visible render error rather than a blank box.

### 6.2 Do we ship `read_me`, and how big?

Claude's is 99K characters. Otto is a token-cost-conscious fork —
`projects/token-cost-audit/` measured ~9.7–14.9K tokens per request and
`projects/token-cost-fixes/` exists to bring that down. A 99K-char always-available tool is not
free even when unused, and once used it is enormous.

Options: skip it and put a compact contract in the tool description; ship a much smaller single
document; or copy the modular design (a stub listing modules, details loaded on demand) which is
what makes Claude's size tolerable.

**Recommendation: the modular shape, aggressively trimmed.** A stub under 2K characters, and
per-module documents in the 5–10K range covering the runtime rules and Otto's tokens — not a full
design system. Most of Claude's 99K is aesthetic doctrine (colour philosophy, prose style, "words
to avoid") that Otto does not need to relitigate.

### 6.3 Tool group and default state

New `widgets` group in `OTTO_TOOL_GROUPS`, surfaced in Host settings alongside Artifacts. Default
on or off is a judgement call; given the sandbox and `sendPrompt` privilege, **default off for the
first release**, on by default once the bridge has soaked.

### 6.4 Naming

`docs/glossary.md` rules: UI label wins, no synonyms. "Widget" is the term the user reaches for and
it does not collide with anything in Otto today. Adopt it, add a glossary entry, and keep it
distinct from "artifact" in all copy.

### 6.5 Persistence

Widgets die with their transcript position. But `docs/chat-lifecycle.md` covers archive and
retained transcripts — a re-opened chat should re-render its widgets from the stored tool-call
input, which it can, since the input is the content. No separate store. Confirm this holds for the
retained-transcript path specifically.

---

## 7. Build plan

Phased so each phase is independently verifiable, and so the risky part is proven before the
polish is paid for.

### Phase 0 — Verification spike (no shipping code)

Answer the three questions that could invalidate the plan:

1. Do partial tool-call inputs reach the client? (§5.5)
2. Does an Electron `<webview>` on a `data:` URL with a preload cleanly `sendToHost`? (§5.1)
3. Do Codex/Copilot/OpenCode surface a tool call with enough fidelity to anchor a renderer? (§5.6)

Output: a note in this folder recording the answers. Phases 1–4 assume them.

### Phase 1 — The sandbox primitive

`WidgetHtmlView` alongside `ArtifactHtmlView`, same three-file platform split, differing in exactly
two ways: content-driven height instead of `flex: 1`, and a message bridge. No tool yet — drive it
from a hardcoded fixture. Ship the host stylesheet (§5.4) here.

**Done when:** a fixture fragment renders at its natural height in all three renderers, correct in
light and dark, and reports height changes.

### Phase 2 — The tool

`show_widget` in `otto-tools.ts`, new `widgets` group, sanitiser extended for fragments (the
existing one assumes full documents — its `</html>` trimming and `isValidHtmlContent` structural
checks are wrong for a fragment and must be branched, not reused as-is). Renders on completion,
`loading_messages` while pending.

**Done when:** an agent can call `show_widget` and the fragment appears inline in the transcript
at the right position, on Claude and openai-compat.

### Phase 3 — The bridge

`sendPrompt` and `openLink` across all three transports, with the §5.2 policy: rate limit, length
cap, active-chat gate, visible attribution.

**Done when:** a widget button sends a user turn that is visibly attributed to the widget, and a
background-tab widget cannot.

### Phase 4 — The contract document

`read_me` per §6.2, plus the vendored library decision from §6.1.

**Done when:** a model with no prior knowledge writes a correct widget from the tool description
and `read_me` alone.

### Phase 5 — Rollout and fold-in

Remaining providers. Then per the repo's project rule: fold the durable facts into `docs/` — a new
`docs/widgets.md`, a `docs/glossary.md` entry, and a cross-reference from
`docs/markdown-rendering.md` recording _why_ widgets bypass that pipeline — and delete this folder.

---

## 8. Security posture

The fragment is model-generated and untrusted, and may be reflecting hostile content the model read
from a file or web page. The existing artifact posture is the floor, not the ceiling, because
widgets add a channel artifacts do not have.

- Keep `allow-same-origin` off on web. Validate the bridge on port identity, never `event.origin`.
- Keep the Electron guest on its own non-default partition.
- Keep `connect-src` closed (§6.1 option c).
- `sendPrompt` is the new attack surface: a widget that can silently type into the chat is a
  self-prompting loop. Rate-limit, cap length, gate on active chat, and attribute visibly.
- `openLink` never bypasses the confirmation dialog.
- A blocked resource must render as a visible error, never a blank box — silent failure is how a
  broken widget gets mistaken for a working one.

---

## 9. Open questions

1. Streaming — resolved by Phase 0, but if partial inputs are unavailable, is completion-only
   rendering acceptable for v1? (Assumed yes.)
2. Mobile — a content-height widget inside a scrolling chat on a phone is the least certain part of
   the layout story. Does it need a max-height with a "expand" affordance on compact form factors?
3. Does a widget belong in the Visualizer's node view, or is it strictly a chat-surface object?
4. Should a widget be promotable to an artifact ("keep this")? Cheap to add later, wrong to design
   for now.
5. Interaction with `docs/safe-unattended.md` — should `show_widget` be callable at all in an
   unattended run, where nobody is looking and `sendPrompt` could self-drive the loop? Leaning no.

---

## 10. Evidence appendix

Everything above that is a claim about existing code, with its source:

| Claim                                             | Source                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Widget = MCP tool call, code in `widget_code`     | `~/.claude/projects/C--Users-phili-Projects-otto-code/a5b374f0-….jsonl`; 5 transcripts contain `show_widget` |
| Host contract, 1,189 lines, modular               | `mcp__visualize__read_me` output                                                                             |
| Artifacts are file-backed, kind `html` only       | `packages/protocol/src/artifacts/types.ts:3,26`                                                              |
| Artifact CSP blocks all network                   | `packages/server/src/server/artifact/html-validator.ts:26-29`                                                |
| Web iframe omits `allow-same-origin`              | `packages/app/src/components/artifacts/artifact-html-view.web.tsx:23`                                        |
| Electron needs `<webview>` due to CSP inheritance | `…/artifact-html-view.electron.tsx:20-28`                                                                    |
| Native uses RN WebView, empty origin whitelist    | `…/artifact-html-view.tsx:14,25`                                                                             |
| Tool registration shape and catalog entry point   | `packages/server/src/server/agent/tools/otto-tools.ts:132,988,2537`                                          |
| Tool groups surfaced in Host settings             | `packages/app/src/screens/settings/otto-tools-config.ts:14-56`                                               |
| Markdown pipeline does not render HTML            | `docs/markdown-rendering.md`                                                                                 |
| No `input_json_delta` handling found (unverified) | grep of `packages/app/src/types/stream.ts`                                                                   |
