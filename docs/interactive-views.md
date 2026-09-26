# Interactive Views

An Interactive View is a typed, validated diagram (Architecture, Workflow, Sequence, Data Flow,
or Lifecycle) that belongs to a Knowledge article. The daemon renders it with the vendored
Archify renderer (`vendor/archify`, adapter in `packages/server/src/server/archify/`) into a
self-contained HTML document, and sanitizes it behind the artifact CSP
(`packages/server/src/server/artifact/html-validator.ts`). Storage, drafts, publishing, and
staleness are covered in [project-knowledge.md](project-knowledge.md) and the Knowledge project page.

This page is about how Otto **presents** a rendered View. The rule: **a View is a document, and
Otto owns its chrome.**

## Presentation contract

Archify's viewer ships its own chrome: a theme switch, four visual styles, a presentation stage,
an export menu, a navigation dock, and a title header. Otto hides all of it and presents the View
the way the File Editor presents a file:

| Part              | Owner                                                  | What it holds                                                                                              |
| ----------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Toolbar (36px)    | The host surface (`InteractiveViewActions`)            | Find, Semantic lens, Trace a route, Overview map, Zoom out/in, Fit, Motion (trace-enabled Views), Export ▾ |
| Pinned notices    | `InteractiveViewCanvas`, via `FileEditorWarningBanner` | Source changed since publish; viewer failures; authoring publish/delete errors. Always dismissible         |
| Canvas            | The guest document                                     | The diagram, its detail cards, and the panels the toolbar opens                                            |
| Status bar (24px) | `InteractiveViewStatus`                                | View type, component and relationship counts, source freshness, zoom %. Read-only, like the editor's strip |

The four surfaces that show a View all compose these same pieces: the Knowledge reader (actions join
the Knowledge toolbar), the published View tab, the authoring split beside its chat, and the legacy
draft tab. Do not add a second presentation path; extend
`packages/app/src/components/architectural-views/interactive-view.tsx`.

## One Otto theme

There are no View themes or styles to choose. `buildInteractiveViewTheme`
(`packages/app/src/architectural-views/view-theme.ts`) maps the **active Otto theme** onto
Archify's closed set of CSS variables, so every Otto theme and syntax palette produces a matching
View:

- Surfaces, text, borders, and emphasis come from the theme's semantic colours.
- Archify uses its **frontend** kind colour as its UI accent too (focus rings, Guided Views labels,
  the finder), so that one carries Otto's **accent**. The other node-kind colours come from the
  **syntax palette**, the same source the diff visuals use.
- Light or dark follows Otto. The guest reports Otto's scheme to `prefers-color-scheme` queries, and
  the classic visual style is pinned.
- A theme change is pushed into the running View, so pan, zoom, and open panels survive it.

**Typography:** the View follows the user's font choices.

- The **content** font is the baseline: the root font size is the content size preference, and
  panels, cards, and menus use the UI font family.
- **Diagram text** uses the user's **monospace** font. Archify's node-text fitting assumes a
  monospace advance, so a monospace choice keeps every label inside the box Archify sized for it.
- Archify keeps every relative size and all diagram geometry it computed; do not override
  individual sizes.
- Otto's bundled faces (Inter and JetBrains Mono) are embedded into the guest as data URLs
  (`view-font.ts`) because the guest is offline (`font-src data:`). A system font the user picks
  resolves by name.

## The bridge

The View is untrusted, isolated content, so Otto never patches the vendored viewer. It injects one
style block and one bootstrap script into the sanitized HTML, right after the CSP meta and ahead of
the viewer's own head script (`prepareInteractiveViewDocument` in
`packages/app/src/architectural-views/view-bridge.ts`). The script:

- answers host commands through the viewer's public `window.Archify` API (`view`, `finder`,
  `semanticLens`, `routeProbe`, `radar`, `motionGovernor`, `exportMenu`);
- captures the viewer's blob downloads, so exports come back to the host as data URLs and are saved
  through Otto's download flow (or copied to the clipboard). Only PNG, JPEG, WebP, SVG, and WebM
  are accepted;
- rewrites the export SVG as it is serialized (`XMLSerializer`), so every export (SVG and the
  rasters drawn from it) uses the diagram's on-screen mono font instead of the JetBrains Mono
  Archify bakes in, with the face embedded when Otto supplied one;
- turns the viewer's `alert()` failures into host notices instead of modals;
- claims the viewer's `T`/`S`/`F`/`E` shortcuts (theme, style, stage, export). Its own handler skips
  prevented events. Reader shortcuts such as `/`, `?`, `+`, `-`, and `0` still work;
- reports state changes (zoom, counts, open panels, motion) to the host.

Every guest message is re-parsed into bounded fields on the host before use.

Transports differ per platform and are hidden behind `InteractiveViewFrameHandle`:

| Platform | Frame                                     | Commands                                        | Guest events                     |
| -------- | ----------------------------------------- | ----------------------------------------------- | -------------------------------- |
| Electron | `<webview>`, artifact partition           | `executeJavaScript` resolving the guest promise | Prefixed `console-message`       |
| Web      | Sandboxed `srcdoc` iframe, no same-origin | `postMessage`                                   | `postMessage`                    |
| Native   | `react-native-webview`                    | `injectJavaScript`                              | `ReactNativeWebView.postMessage` |

**Gotcha: Electron loads through a bootstrap page.** A View plus its embedded fonts can exceed what
Electron accepts in a `data:` URL, and the guest then silently stays on `about:blank`. The frame
loads a tiny bootstrap and writes the View in with `document.write`, the Mermaid runtime's pattern.
**The bootstrap's CSP stays in force after the write**, so it must mirror the artifact CSP exactly.
A stricter bootstrap policy breaks embedded fonts and export rasterization.

Export is not offered on native: Views on phones are a reading surface.

## Known limits

- Exports are Archify's canonical exports of the whole diagram, in the Otto colours on screen.
- The export file name comes from Archify (the diagram's project name, for example `otto.png`).
- The authoring preview reloads when the agent writes a new draft, so the camera resets on each
  update.
