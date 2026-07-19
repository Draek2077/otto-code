# Relative image resolution — charter

Workstream 2 of [file-rendering.md](file-rendering.md), broken out because it turned out to be
two independent code paths, a security boundary, and a fallback-behavior decision rather than the
one-paragraph task the parent charter described.

**Goal:** a repo markdown file that references its own images — `![](docs/diagram.png)`,
`<img src="packages/website/public/logo.svg">` — renders those images in the viewer, the way it
does on GitHub. Client-side work plus one existing daemon RPC; no protocol change.

## Why it's visible

Our own `README.md` is the reproduction. The logo line

```html
<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Otto logo" />
</p>
```

renders the `<img>` tag as literal text. That is the whole of this workstream — the `<p>` wrapper
half was fixed separately (layout-only tags now unwrap in `markdown/html-ish.ts`).

## The two paths that both need fixing

Relative srcs die in two different places, for two different reasons. Fixing one leaves the other
broken, and README-style files hit the HTML path more often than the markdown path.

| Path                 | Entry                                                                                            | Why a relative src fails today                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Markdown `![](path)` | `react-native-markdown-display` default `image` rule (no custom rule in `markdown/renderer.tsx`) | `allowedImageHandlers` has no match, so `defaultImageHandler` prefixes it — the src becomes `https://./diagram.png`      |
| HTML `<img src>`     | `markdown/html-ish.ts:30` `SAFE_IMAGE_SRC_RE`                                                    | Only `https?:` and `data:image/...` pass; a relative path is rejected and falls back to `token.raw`, i.e. visible markup |

Neither path has any base-path context to resolve against: `MarkdownRendererProps`
(`markdown/renderer.tsx:70-79`) has no cwd/basePath field, and `file-pane.tsx:499` renders
`<MarkdownRenderer text={body} />` with nothing else passed down.

## Shape of the fix

Four pieces, in dependency order.

1. **Carry a base path.** Add an optional base-path input to `MarkdownRendererProps` — the
   containing file's directory plus the workspace root (GitHub resolves relative srcs against the
   file's directory, and root-relative `/x.png` against the repo root, so both are needed).
   `file-pane.tsx` supplies it; chat leaves it unset and keeps today's behavior.
2. **Resolve and contain.** Reuse `resolveRelativePathUnderRoot`
   (`assistant-file-links/parse.ts:635-663`), which already collapses `.`/`..` and returns null
   when a path escapes above the root — do not write a second resolver. Unresolvable or escaping
   srcs fall back (see below) rather than being fetched.
3. **Fetch and hand back a URL.** Mirror `createFilePanePreview` (`file-pane.tsx:123-165`):
   `client.readFile(cwd, path)` → `persistAttachmentFromBytes` → `useAttachmentPreviewUrl`. This
   reuses the attachment store's blob-URL (web) / `file://` (native) lifecycle and its GC, so no
   new caching layer is introduced.
4. **Let the resolved URL through.** Both consumers gate on scheme: widen
   `allowedImageHandlers` to accept the store's `blob:`/`file:` URLs, and extend
   `SAFE_IMAGE_SRC_RE` the same way. Widen for the _resolved_ URL only — the raw author-supplied
   src must still never reach an `<Image>`.

## Constraints and decisions

- **Security invariant.** The scheme allowlists exist to keep `javascript:` and friends inert, and
  the test at `markdown/html-ish.test.ts:167` pins that. Relative resolution is an _additive_
  allowed class routed through the daemon read, never a loosening of the scheme check. `file:` and
  absolute host paths supplied by the document stay rejected.
- **Containment is app-side, by choice.** The daemon deliberately does not bound single-file reads
  to a known workspace (`file-explorer/workspace-files-session.ts:218-221`) — `resolveScopedPath`
  only stops `..`/symlink escapes relative to the cwd it is given. So a markdown file must not be
  able to name an arbitrary host path and have us fetch it: containment happens at step 2 before
  any RPC is issued. This is the same posture as the gated multi-root work (`resolveEditGate`
  gates edits; this gates reads-for-display).
- **Fallback behavior — decide before building.** Today an unresolvable src shows raw markup, which
  is the worst option. Proposed: render the `alt` text (plus a broken-image affordance), so the
  document stays readable and the failure is legible. Needs confirming, because it also changes
  what a rejected `javascript:` src looks like, and the existing test asserts raw passthrough there.
  Suggested split: dangerous scheme → keep inert raw (unchanged, still covered by that test);
  merely unresolvable → alt text.
- **Fan-out.** A badge-heavy README can reference dozens of images; each is an unbounded whole-file
  read (`file-explorer/service.ts:366-418` has no size cap). Needs de-duplication by resolved path
  and a sane cap/lazy trigger before this goes near a large repo.
- **SVG.** The most common README logo format, and it splits by platform today — native decodes to
  `SvgXml`, web goes through the attachment blob URL (`file-pane.tsx:139-158`). The resolver must
  hand SVGs to the same two paths rather than assuming one.
- **Chat stays off.** Chat renders with `enableHtmlish={false}` and no workspace base path;
  turning this on there is a separate decision about trusting agent-authored srcs.

## Exit

Relative images render in the viewer on web and native, escaping paths are refused before any RPC,
unresolvable srcs degrade to alt text, and the scheme-safety tests still pass. Then fold the
resolution rules into `docs/` alongside the html-ish subset (neither is documented there yet) and
prune workstream 2 from the parent charter.
