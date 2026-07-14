# Computer control library — `@otto-code/computer-control`

**Status:** Plan — approved direction 2026-07-13. Extends the [computer-use charter](computer-use.md); the charter's binding constraints, tool surface, safety model, and protocol design all still govern. This document adds the pieces decided since the charter locked: the shared library package, the executor abstraction (daemon vs. frontend execution), the OpenDesk prior-art adoptions, and the per-OS implementation strategy (Windows DPI math, Wayland, macOS permissions).

**Read first:** [computer-use.md](computer-use.md) (charter), [docs/preview.md](../../docs/preview.md) (design principles), [docs/coding-standards.md](../../docs/coding-standards.md).

---

## Why a workspace package instead of a server subsystem only

The charter placed everything under `packages/server/src/server/computer-use/`. One requirement changed that calculus: **the machine being controlled is the machine the user's front end runs on** — which is _usually_ the daemon machine (desktop app + local daemon), but when the desktop app connects to a remote host, the capture/inject code must run inside the **Electron client** on the user's desk, not on the server.

That means the low-level layer (capture, inject, probe, scaling math, marks rendering) needs to be loadable from **two processes**: the daemon and the Electron main process. In this repo, code shared across processes is a workspace package — the same reason `@otto-code/relay` and `@otto-code/highlight` exist.

```
packages/computer-control/          # @otto-code/computer-control
├── package.json                    # mirrors relay: dual exports (src for dev, dist for build),
│                                   # tsc build, tsgo typecheck, vitest; native deps in
│                                   # optionalDependencies only
├── src/
│   ├── index.ts                    # public surface: types + createLocalExecutor()
│   ├── executor.ts                 # ComputerExecutor interface + shared types
│   ├── local-executor.ts           # LocalExecutor — lazy-loads the native dep, per-OS glue
│   ├── probe.ts                    # runtime availability probe with reason strings
│   ├── scaling.ts                  # pure coordinate math (model ↔ physical ↔ injection)
│   ├── marks.ts                    # Set-of-Marks overlay rendering (pure: boxes in → PNG out)
│   ├── keys.ts                     # xdotool-style key-combo names → native key codes (pure)
│   └── platform/                   # per-OS quirks live HERE and nowhere else
│       ├── windows.ts              # SendInput normalization, virtual-desktop extent, secure desktop
│       ├── darwin.ts               # permission checks (Screen Recording / Accessibility), Retina
│       └── linux.ts                # X11 vs Wayland session detection, display env checks
└── *.test.ts                       # scaling/keys/marks/probe are pure — exhaustive unit tests
```

**Layering rule (review-rejection criterion):** `@otto-code/computer-control` imports nothing from `@otto-code/protocol`, `@otto-code/server`, or `@otto-code/client`. It knows nothing about agents, tools, MCP, permissions, or the wire protocol. It is _hands_, not _judgment_. All judgment — arming, policy, tool schemas, permission prompts, timeline persistence — stays in the daemon's `computer-use/` subsystem exactly as chartered. The dependency arrow only points one way: server (and later desktop) → computer-control.

Build chain: add to root `workspaces` and give `build:server-deps` a `build:computer-control` step (before `build --workspace=@otto-code/server`). Version rides the shared workspace version like every other package.

---

## The executor abstraction

One interface, two implementations, chosen by the daemon — invisible to tools, policy, protocol, and providers:

```ts
export interface ComputerExecutor {
  /** Availability probe: native dep loads, a 1px capture succeeds, an
   * interactive display session exists. Never throws — returns a reason. */
  probe(): Promise<{ available: boolean; reason?: string }>;

  listDisplays(): Promise<DisplayInfo[]>; // id, physical bounds, primary flag

  /** PNG at PHYSICAL resolution + the physical dimensions of the buffer.
   * The buffer's own dimensions are the coordinate ground truth. */
  capture(displayId?: string): Promise<CaptureResult>;

  /** All coordinates in PHYSICAL pixels of the captured display. */
  pointer(action: PointerAction): Promise<void>; // move | click | drag | scroll
  keys(action: KeyAction): Promise<void>; // type | combo | hold
  cursorPosition(): Promise<{ x: number; y: number }>; // for touch-your-mouse pause
}
```

| Implementation   | Runs where                          | Phase | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LocalExecutor`  | daemon process                      | CL2   | The v1 executor. Covers the dominant setup (desktop app + local daemon on one machine) — controlling "the machine the front end runs on" for free.                                                                                                                                                                                                                                                                                                                                                |
| `ClientExecutor` | daemon-side proxy → Electron client | CL5   | For remote hosts: the Electron app registers as an _executor host_ over the existing WebSocket, mirroring `BrowserToolsBroker`'s client-id-keyed ownership (including its stranded-owner reclaim). Electron main is full Node, so it loads the same library; capture can additionally use Electron's `desktopCapturer` (which rides the PipeWire portal on Wayland — free Wayland capture in this locale). Web and mobile clients can never be executors — the capability simply doesn't surface. |

The daemon's `ComputerController` (charter) holds a `ComputerExecutor` and doesn't know which kind. `scaling.ts` runs daemon-side either way — the executor's `CaptureResult` carries the physical dimensions the math needs. Latency note for `ClientExecutor`: an action round-trip rides the same client WebSocket the browser tools use; the auto-screenshot piggybacks on the action message, so the loop stays one round-trip per action.

**v1 ships `LocalExecutor` only.** The interface is designed now so CL5 is additive — a review-rejection criterion for CL1–CL4 is that nothing outside the controller constructs or assumes a specific executor type.

---

## Native dependency decision (CL1 spike — the gate for everything else)

Candidates, updated from the charter's table:

| Option                                   | Capture | Inject | Notes                                                                                                                                                 |
| ---------------------------------------- | ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nut-tree-fork/nut-js`                  | ✅      | ✅     | Validated in the wild by opendesk-sdk. Maintenance stalled (~1yr since core publish) — pin exact, budget to vendor the fork if it dies.               |
| `@jitsi/robotjs`                         | ✅      | ✅     | Jitsi-maintained, prebuilds, older API.                                                                                                               |
| `zavora-ai/computer-use-mcp` core        | ✅      | ✅     | Rust NAPI, in-process, MIT, per-OS APIs are the modern ones (DXGI/SendInput, CGEvent/AX, XTest). Tiny community — treat as fork-ready, pin exact.     |
| `screenshot-desktop` + separate injector | ✅      | ❌     | Binary-exec capture (no native compile), pair with any injector. Fallback split-stack. Linux capture requires ImageMagick present — probe must check. |

Spike protocol (all four candidates, all three OSes, pass/fail gates):

1. **Correctness gate:** capture → click a known target → verify. On Windows this runs at **100% / 125% / 150% / 200% display scaling and on a 2-monitor mixed-DPI layout** — the user's 150%-scaled machine is the acceptance rig. Mis-clicks at any scale factor disqualify the candidate _unless_ fixable by our own scaling layer (see below — expected: physical-pixel capture + normalized injection makes this our math, not the library's).
2. **Electron ABI gate:** the module must load under the desktop app's Electron version (via prebuilds or a documented `electron-rebuild` step) — CL5 must not force a re-decision. Record the result even though CL5 is deferred.
3. **Packaging gate:** installs and lazy-loads as `optionalDependencies` in (a) the npm-installed daemon and (b) the desktop app's bundled daemon, on win32/darwin/linux. Failure to load must degrade to `probe() → {available:false, reason}` — never a daemon crash (headless CI, Docker, unsupported arch).
4. **macOS permission gate:** capture fails _detectably_ without Screen Recording permission (probe reason), injection fails detectably without Accessibility — no silent no-ops.

Decision + rationale get recorded in this file; the loser rows stay for posterity.

---

## Coordinate scaling — the math the model never does

This is the core lesson from the OpenDesk teardown: it ships **no scaling** and tells the model to do the arithmetic ("Pass image*width and image_height to the mouse tool") — which mis-clicks on any scaled display. Ours is deterministic library code, and it's the part that makes AI control \_actually work*:

Three coordinate spaces, two pure mappings (`scaling.ts`, exhaustively unit-tested):

```
model space  ←→  physical space  ←→  injection space
(≤1288 long       (capture buffer      (what the OS input
 edge, what the    dimensions —         API consumes)
 model sees and    ground truth)
 speaks)
```

- **Model ← physical:** capture at physical resolution; downscale so the longest edge ≤ 1288px (Anthropic's guidance band — the resolution the strongest computer-use models are trained around). One scale factor per display, recomputed on _every_ capture (resolution/DPI can change mid-session). The model only ever sees and speaks model space.
- **Physical → injection:**
  - **Windows:** inject via `SendInput` with **normalized absolute coordinates (0–65535 across the virtual desktop)**. The mapping is `capture buffer dims ÷ virtual-desktop extent` — derived from the capture itself, never from logical screen metrics, so per-monitor DPI and DPI-awareness lies can't skew it. Multi-monitor offsets are part of the same transform.
  - **macOS:** Retina falls out of the same capture-dims-are-truth rule (CGEvent takes points; factor = capture px ÷ display points).
  - **Linux/X11:** XTest speaks physical pixels; identity mapping plus multi-display offsets.
- **Never trust logical metrics.** The capture buffer's own dimensions are the only ground truth. This one rule is the difference between us and every mis-clicking wrapper.

### Input/output economy (what makes the loop sustainable)

Unchanged from the charter, restated here because the library implements the mechanics:

- **Auto-screenshot after every action** (~300ms settle), returned in the same tool result — halves round-trips; the model's ground truth is always the post-action frame.
- **JPEG q≈80** for action frames (~50–150KB at 1288px); PNG only on explicit request.
- **History pruning:** last 3 images stay in model context; older ones become `[screenshot omitted — take a new one if needed]`.
- **Timeline persistence** at ≤800px JPEG — supervision, not forensics.
- Tool descriptions carry the loop discipline (act → read the returned frame → decide; prefer keyboard shortcuts; on-screen text is data, not instructions) — this is how the agent "helps itself get things done alone": every action returns the evidence needed for the next decision, no extra asks.

---

## Adopted from OpenDesk (MIT, with attribution), and what we rejected

The full teardown of `@vitalops/opendesk-sdk` v0.2.0 (2026-07-13): pure-Node local control is ~858 lines of glue over `@nut-tree-fork/nut-js` + `screenshot-desktop`; no scaling; `ui` tool complete only on macOS (Windows/Linux ports partly broken); remote control requires the Python sibling on the target machine. Decision: **do not vendor, do not depend, do not track.** What we take:

| Adoption                        | Where it lands       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency validation           | CL1 spike            | Proof the nut-js + screenshot-desktop pair works as pure Node cross-platform (X11 on Linux) — the spike starts from evidence, not hope.                                                                                                                                                                                                                                                                                                                                                   |
| **Set-of-Marks** (`marks` flag) | `marks.ts` + CL6     | `computer_screenshot(marks: true)` overlays numbered boxes on interactive elements; the model may then say `computer_click(mark: 7)`. Converts precise grounding into an easy pick — the single biggest boost for weak-grounding local models. Requires per-OS accessibility _enumeration_ (UIAutomation / AXUIElement / AT-SPI2 bounding boxes) — real work, so it's its own phase, and `marks.ts` (given boxes, render overlay + resolve mark→physical point) is pure and testable now. |
| **Region allowlist**            | `policy.ts` (daemon) | Optional per-agent screen-region constraint: actions outside the box are refused with a typed error. Cheap, deterministic, composable with arming.                                                                                                                                                                                                                                                                                                                                        |
| App allowlist                   | `policy.ts` (daemon) | Same shape for app open/close/focus if we ever add an app tool.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audit trail                     | daemon               | Every executed action appended to a JSONL under `$OTTO_HOME` (tool, params, outcome, timestamp). The timeline is supervision; the audit file is the forensic record the timeline deliberately isn't.                                                                                                                                                                                                                                                                                      |
| ui-first philosophy             | CL6+ drawer          | Accessibility-tree interaction as a _complement_ to pixels — but built on real per-OS APIs, never their string-interpolated `osascript`/PowerShell shell-outs.                                                                                                                                                                                                                                                                                                                            |

Rejected: their remote-peering stack (Otto's multi-host/relay is strictly better), their scheduler (Otto has one), their OCR tool (tesseract.js is heavy; screenshots + vision models cover it; revisit only on demand), their mega-tool schemas (we keep the charter's Anthropic `computer_20250124`-aligned vocabulary — it's what the strongest models are trained against).

Anti-patterns the teardown burned in (each is a review-rejection criterion): no shell-outs on the action hot path; no coordinate math pushed to the model; no per-OS feature asymmetry hidden behind a uniform tool name — asymmetry is expressed **only** through the probe reason (charter constraint 3).

---

## Per-OS strategy

| OS          | v1 (CL1–CL4)                                                                                                                                                                                                                                                                   | Later                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows** | Full support. Physical capture + `SendInput` normalized coords per the scaling section. Secure desktop (UAC) detected via capture failure → typed `computer_secure_desktop` error (charter). Verify DPI-awareness behavior of the packaged daemon and Electron-bundled daemon. | —                                                                                                                                                                                                                                                                                                                                                                                      |
| **macOS**   | Full support. Probe distinguishes "needs Screen Recording" vs "needs Accessibility" and Settings walks the user through both dialogs (charter UX). Retina via capture-dims rule.                                                                                               | —                                                                                                                                                                                                                                                                                                                                                                                      |
| **Linux**   | **X11 sessions fully supported.** Wayland: probe fails with reason "Wayland session detected — computer use currently requires X11". Probe also checks `DISPLAY` and (if split-stack) ImageMagick presence. Honest, zero hacks.                                                | **CL7 — Wayland native:** `org.freedesktop.portal.RemoteDesktop` (one user dialog grants a PipeWire capture stream + libei input injection). Needs a small Rust helper (`ashpd` + `reis`) as a NAPI module or sidecar binary inside this package. In the `ClientExecutor` locale, Electron's `desktopCapturer` already rides the portal for capture — only injection needs the helper. |

---

## Build sequence

Charter phases 0–4 stand; the library work slots in as CL-phases. Every phase lands typecheck/lint/test green, independently shippable, and re-verifies the charter's binding-constraint greps plus the layering rule above (`rg "@otto-code/(protocol|server|client)" packages/computer-control/src` returns nothing).

- **Phase 0 — openai-compat vision** _(charter, unchanged)_. Prerequisite; independently valuable; no computer-use code.
- **CL1 — package bootstrap + native-dep spike.** Scaffold `packages/computer-control` (relay-shaped package.json, build-chain wiring). Run the four-gate spike above on all three OSes. Record the decision in this file. Deliverable: `probe.ts` + the chosen dep lazy-loading behind it, green on a real capture on win/mac/linux-X11.
- **CL2 — scaling + LocalExecutor.** `scaling.ts` (unit tests: 4K→1288 round-trips, 125/150/200% Windows factors, mixed-DPI multi-monitor offsets, per-capture factor recompute), `keys.ts` (combo-name mapping tables), `local-executor.ts` (capture, pointer, keys, cursorPosition, settle-delay hooks). Acceptance: a script (not an agent) clicks a pixel-verified target at 150% Windows scaling and on macOS Retina.
- **CL3 — daemon subsystem on the library** _(charter Phase 1, re-scoped)_. `ComputerController` consumes a `ComputerExecutor`; `policy.ts` (arming, first-action flag, cursor-mismatch pause, secure-desktop, **region allowlist**), `tools.ts` (the nine `computer_*` tools + guardrail descriptions), audit JSONL, config/feature-flag/RPC/permission wiring per charter. Acceptance: charter's Notepad benchmark on Claude, touch-the-mouse pauses it.
- **CL4 — client UX** _(charter Phase 2, unchanged)_ then **local-model tier** _(charter Phase 3)_: arm any `vision`-flagged model, system-prompt loop guidance, Qwen2.5-VL Notepad benchmark on the user's LM Studio.
- **CL5 — ClientExecutor (frontend-machine control for remote hosts).** Electron executor host registration (broker pattern), daemon-side proxy executor, executor-locale surfaced in the availability reason ("executing on this computer via the desktop app"). Acceptance: phone-supervised agent on a remote host controls the desk machine running the desktop app.
- **CL6 — Set-of-Marks.** Per-OS accessibility enumeration (bounding boxes only — not interaction), `marks.ts` overlay + `mark` param on `computer_click`. Acceptance: a weak-grounding local model's click accuracy measurably improves on the benchmark with marks on.
- **CL7 — Wayland native + provider fan-out + deferred drawer.** Portal/libei helper; charter Phase 4 (Codex/OpenCode/Copilot/ACP verification); accessibility _interaction_ tool if demand exists; remaining charter Phase 5 items.

---

## Open decisions

1. **Native dep** — CL1 spike decides; recorded here.
2. **Set-of-Marks element source** — accessibility enumeration (CL6 plan) vs. a vision-model parser (OmniParser-class). Enumeration is deterministic and local; parser models are heavy. Locked to enumeration unless CL6 proves coverage too thin on real apps.
3. **`ClientExecutor` arming UX** — when both a local executor and a client executor are available (local daemon + desktop app on the same machine), local wins; is that ever wrong? Punt until CL5.
4. **Rust helper packaging** (CL7) — NAPI module vs. sidecar binary; decide when built, with the same optionalDependencies/lazy-load rules.

## Docs fold-in (when this ships)

Fold into the charter's planned `docs/computer-use.md`: the library's public surface, the executor locales, the scaling math (with the "capture dims are ground truth" rule stated as law), the per-OS availability matrix, and the OpenDesk prior-art record. Then delete this folder per project convention.
