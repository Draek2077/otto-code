# Chat transcript scrolling

How the conversation view decides where to put the scroll position, and the one
rule that everything else in this page follows from.

**While the reader holds the scroll position, the app writes nothing to it.** Not
on a stream flush, not when a run of tool calls folds into a group, not when the
mobile keyboard resizes the viewport, not when older history splices in. The only
scroll write allowed in that state is the one that cancels motion out (see
[Holding the position](#holding-the-position-while-the-document-changes)).

## Two states, and only user input moves between them

| State         | What it means                                      | Who can leave it                                                                                    |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Following** | The view is pinned to the newest content           | Any user input that moves the view up                                                               |
| **Detached**  | The reader owns the position; the app is hands-off | The reader returning to the bottom, the jump-to-bottom button, sending a message, entering the chat |

Route entry, the jump-to-bottom button and sending a message are the explicit
"take me to the bottom" requests. Everything else the app does (content arriving,
content collapsing, the viewport resizing) is not a reason to move the view.

The reported symptom when this breaks is unmistakable: scroll up in a live chat,
and the view flips back and forth on every flush, sometimes ending up at the very
top of the transcript.

## Web: detect the scroll, not the input device

`strategy-web.tsx` decides "did the reader move this?" from the scroll event
alone, by subtracting off the two things that move `scrollTop` without a user:

1. **The app's own writes.** Every write records the resulting `scrollTop`
   (`programmaticScrollTopRef`), so the scroll event that matches it is the app's
   own echo.
2. **Clamping.** A document that shrinks, or a viewport that grows, drags
   `scrollTop` down on its own. The drop is bounded by
   `(previousScrollHeight - scrollHeight) + (clientHeight - previousClientHeight)`,
   and anything within that bound is the browser, not a finger.

Whatever is left is the reader.

**This must not go back to listening for `wheel` / `pointerdown` / `touchmove` on
the scroll container.** That is what it used to do, and it had a hole big enough
to drive the original bug through: Otto's desktop overlay scrollbar
(`use-web-scrollbar.tsx`) is a _separate element_ that writes `scrollTo` on the
scroller. Dragging it fires none of those events, so follow-output never
disengaged and every flush yanked the reader back down. Page Up, find-in-page and
scroll anchoring had the same hole. The wheel and touch listeners that remain
exist only to cancel a queued stick on the same frame a gesture starts, so it
cannot land in the gap before the scroll event arrives. They no longer decide
anything.

Near-bottom is reported to the view as **"the app is following"**, not
"`scrollTop` happens to be within 64px of the end". A reader who nudged the view
up ten pixels is reading: the jump-to-bottom button appears and the
mounted-window pin engages, even though they are still inside the band.

## Holding the position while the document changes

A chat transcript changes length in both directions under a reader who is not at
the bottom: actions pop in one by one and then fold into a single group row,
markdown settles, images load, older history splices in above.

While detached, the web viewport keeps a **scroll anchor**: the first on-screen
row plus its offset from the top of the viewport, measured with
`getBoundingClientRect` against the scroll container. Not `offsetTop`, so that the
whole container moving on screen (which is what the mobile keyboard does) cancels
out instead of reading as drift. After every commit, and on every resize, the
anchor's drift is measured and subtracted back off. The row under the reader's
eyes does not move.

Two regions, two mechanisms, and they must not both claim the same correction:

- **Mounted rows** use the scroll anchor above.
- **The virtualizer's block** compensates `scrollTop` itself when a row swaps its
  estimate for its measured height, via TanStack Virtual's
  `shouldAdjustScrollPositionOnItemSizeChange` (which is simply "are we
  detached"). The anchor skips this block by its `data-stream-virtualized-block`
  attribute; anchoring to it would count the same correction twice.

The mounted/virtualized boundary is separately **pinned** while detached
(`findMountedWindowStart` in `web-virtualization.ts`). Left free it advances as
the agent streams, and the turn it hands to the virtualizer collapses from
measured heights to estimates in one frame, which is the "thrown to the top of the
chat" failure.

## Native: sustained movement beats a queued re-stick

The inverted `FlatList` keeps its position through content growth natively
(`maintainVisibleContentPosition`), so the native problem is not compensation but
**being allowed to detach at all**.

A streaming agent re-sticks on nearly every flush (~48ms), so
`bottom-anchor-controller.ts` almost always has a verification in flight. It used
to refuse to detach while one was pending, which made a live transcript
impossible to scroll away from: it snapped back under the reader's finger.

Now sustained movement away from the bottom wins over anything the app has queued
for itself. "Sustained" is deliberately two measurements, not one:

- at least `MIN_USER_SCROLL_AWAY_EVENTS` (2) consecutive scroll events moving
  away, **and**
- `USER_SCROLL_AWAY_DELTA_PX` (24) of accumulated movement.

One large jump on its own is not a gesture. The first layout pass of a native list
delivers exactly that with no finger involved, and treating it as intent breaks
anchoring on entry. Two events is about 16ms at `scrollEventThrottle={16}`, so a
real drag detaches imperceptibly fast.

An explicit anchor **request** (route entry, jump button, message sent) still
outranks a drag. That is the user asking for the bottom.

## Where this lives

| File                                       | What it owns                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `agent-stream/strategy-web.tsx`            | The web follow/detach state machine, the scroll anchor, the stick-to-bottom rAF |
| `agent-stream/bottom-anchor-controller.ts` | The native sticky/detached state machine and its post-layout verification       |
| `agent-stream/strategy-native.tsx`         | The inverted FlatList, keyboard settling, programmatic-scroll event budget      |
| `agent-stream/web-virtualization.ts`       | The mounted/virtualized split and the pin that freezes it                       |
| `agent-stream/view.tsx`                    | Owns `isNearBottom`, the pin state, the jump-to-bottom button                   |

Tests that encode the rules above: `strategy-web.test.tsx` (scrollbar drag
detaches, clamping does not, the anchor holds a row still) and
`bottom-anchor-controller.test.ts` (drag beats a pending verification, a single
layout jump does not).
