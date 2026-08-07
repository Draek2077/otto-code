# Chat transcript scrolling

The transcript has one ownership rule:

**While the reader holds a position, the app does not write the scroll position.**

Streaming output, markdown settling, tool-call grouping, image loading, viewport
resizes, tab retention, and older-history insertion are not requests to move a
detached reader. Explicit requests such as opening a chat, sending a message,
or pressing the jump-to-bottom button may take ownership and move to the end.

## Ownership states

| State     | Meaning                                     | What changes it                                                            |
| --------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| Following | The transcript stays at the newest content. | Upward reader input detaches it.                                           |
| Detached  | The reader owns the position.               | Reaching the bottom, an explicit jump, or sending a message reattaches it. |

The bottom is treated as a small band rather than one exact pixel. This matters
because `scrollTop` can be fractional while `scrollHeight` and `clientHeight`
are integers, especially with display scaling or browser zoom. The same band is
used when deciding whether input detaches the reader and whether reaching the
bottom reattaches them.

## Web implementation

The web strategy is vendored from Paseo's upstream implementation. Keep it
byte-identical to upstream when possible so a scrolling regression can be
reproduced against the source implementation. Otto-specific integration belongs
at the surrounding contracts and components, not in a second scroll strategy.

The strategy classifies reader intent from input evidence and then handles the
resulting scroll event. It recognizes:

- scrollbar-gutter presses by geometry;
- middle-button autoscroll, including upward movement during the gesture;
- `ArrowUp`, `PageUp`, `Home`, and `Shift+Space`, unless a nested scroller can
  consume the key; and
- the resulting scroll event within a short upward-input evidence window.

This is deliberately broader than wheel or touch detection. Find-in-page,
keyboard scrolling, browser scroll anchoring, and scrollbar dragging must all
participate in the same ownership rule. Do not make a wheel, pointerdown, or
touch listener the authority for whether the reader moved.

### Otto's desktop scrollbar

The desktop app paints a themed overlay scrollbar for its own renderer and hides
the native scrollbar on that surface. The overlay owns the drag and writes the
real chat scroller's `scrollTo` position. Because the overlay is a separate
element, its drag also re-emits a gutter-style pointerdown on the chat scroller.
That preserves the upstream strategy's scrollbar intent classification without
editing the vendored strategy.

The Chromium `OverlayScrollbar` feature remains enabled process-wide for the
browser pane's guest pages. Do not remove it to fix the chat scrollbar: classic
guest-page scrollbars consume layout width and change the page geometry that
Preview asks agents to verify.

## Holding position while content changes

The web scroller uses TanStack Virtual for older history. The virtualized region
uses estimates until rows are measured, and its resize adjustment only absorbs
height changes for rows above the viewport. Growth below the reader must not
move them. The scroller also disables the browser's independent
`overflow-anchor`; browser anchoring and application anchoring cannot both own
the same correction.

Older-history loading is stateful and progress-keyed. Being near the history
start does not issue a request on every scroll event. A page must make progress
before the next request is eligible, and an in-flight request is not duplicated.
The same state machine handles a transcript shorter than its viewport, where no
scroll event may occur.

## Native implementation

Native chat uses an inverted `FlatList`, which owns the mounted window and
maintains the visible position as content grows. The live streaming turn is
published through a stable external store, so a stream flush re-renders the
live header without handing a new header element to the list on every flush.
The list itself is memoized and uses phone-sized render windows and batches.

Native history remains one `FlatList` data source. Do not add the web history
split to native; that would double-virtualize the list and interfere with its
height measurement. Native older-history loading is also guarded at the history
start, and retained panels restore their last visible position when they become
active again.

## Performance boundaries

Web partial virtualization applies to long transcripts on both desktop and
mobile web. Short transcripts stay fully mounted because virtualizing them costs
more measurement work than it saves. The current mounted tail and threshold are
intentionally conservative: reducing the tail to chase mobile streaming cost
puts the virtualizer against the live turn and makes height corrections more
fragile.

The safe mobile performance levers are stable row identities, render-model
caching, isolated live-head updates on native, and making message rows cheaper.
Do not reintroduce the old web scroll compensation layer merely to support a
smaller mounted tail. Any change to the mobile window should be validated on a
real device with a long streaming transcript and with a detached reader.

## Where this lives

- Web scroll ownership and virtualization: `packages/app/src/agent-stream/strategy-web.tsx`.
- Web virtualizer policy: `packages/app/src/agent-stream/web-virtualization.ts`.
- Native list and live-header isolation: `packages/app/src/agent-stream/strategy-native.tsx`.
- Render-model and history-window caching: `packages/app/src/agent-stream/model.ts`.
- Desktop overlay scrollbar: `packages/app/src/components/use-web-scrollbar.tsx` and
  `packages/app/src/components/web-desktop-scrollbar.tsx`.
- Older-history state machine: `packages/app/src/agent-stream/history-start-pagination.ts`.

When changing scroll behavior, run the focused agent-stream tests, app typecheck,
lint, and formatting checks. For browser behavior, verify the running Electron
app with a long transcript: unit tests do not reproduce browser layout,
virtualizer measurement, native scroll anchoring, or overlay scrollbar input.
