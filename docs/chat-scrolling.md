# Chat transcript scrolling

How the conversation view decides where to put the scroll position, and the one
rule that everything else in this page follows from.

**While the reader holds the scroll position, the app writes nothing to it.** Not
on a stream flush, not when a run of tool calls folds into a group, not when the
mobile keyboard resizes the viewport, not when older history splices in. The only
scroll write allowed in that state is the one that cancels motion out (see
[Holding the position](#holding-the-position-while-the-document-changes)).

## Two states, and only user input moves between them

| State         | What it means                                      | Who can leave it                                                                                         |
| ------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Following** | The view is pinned to the newest content           | Any user input that moves the view up                                                                    |
| **Detached**  | The reader owns the position; the app is hands-off | The reader returning to the bottom, the jump-to-bottom button, sending a message, first opening the chat |

First opening a chat, the jump-to-bottom button and sending a message are the
explicit "take me to the bottom" requests. Everything else the app does (content
arriving, content collapsing, the viewport resizing) is not a reason to move the
view.

### Returning to a retained tab preserves ownership

A tab that is temporarily hidden stays mounted. Returning to it is not a new
chat entry: a tab that was following output re-sticks to the bottom, while a
detached reader returns to the same place they were reading. The state, not the
numeric scroll position, decides this. A hidden web scroller can be clamped to
zero by `display: none`, so each strategy retains the last active reader
position and restores it only for the detached case. It never turns a reader's
intentional scroll-up into a bottom request.

**Queueing counts as sending.** Pressing Enter against a busy agent puts the
message on the steer queue instead of the wire, but the reader did the same thing
and expects the same answer: show me where my words landed. The queue path was
left out of this originally, so a reader who had scrolled up stayed scrolled up
with no sign the message had gone anywhere. Every path that accepts a composer
submission calls `onMessageSent`, sent or queued.

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

Whatever is left is the reader - with one landing-state backstop. The bound
above compares against the _last recorded_ metrics, and scroll events coalesce:
several writes and clamps can land between two events and leave the recorded
scrollHeight stale. A downward move that ends a shrink at the exact bottom of
the document is the browser clamping to a smaller range regardless of what the
deltas say - a reader scrolling up ends _away_ from the bottom, or the document
did not shrink - so that case never detaches.

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

### Overscroll needs a tolerance, and it is not cosmetic

The stick refuses to fight a container that is overscrolled past its own bottom
(elastic scrolling, `overscroll-behavior: contain`). That test needs
`BOTTOM_OVERSCROLL_TOLERANCE_PX`, because `scrollTop` is fractional while
`clientHeight` and `scrollHeight` are integers: at any display scale or browser
zoom that is not 100%, the distance from the bottom sits permanently a fraction
below zero. Read literally, both `scheduleStickToBottom` and
`scrollMessagesToBottom` become no-ops for the whole session. The transcript
stops following, and the jump-to-bottom button does nothing on the first press
and appears to work on the second. Windows at 125% or 150% display scaling hits
this every time, which is why it read as "scrolling is broken" rather than as a
zoom bug.

### Asking for older history is once per page, not once per scroll event

`history-start-pagination.ts` is a state machine, and the reason it is one is
that the naive version fires on **every** scroll event inside the 96px band.
Each request splices a page in above the reader, and near the top of a
transcript nothing holds them: the anchor skips the virtualized block and every
mounted row is below the fold, so `findScrollAnchor` returns `null` **by
design**. A burst of pages there is the "thrown to the very top" report.

The dedupe key is `olderHistoryProgressKey`, which changes once per page
delivered. A null key means "no page to dedupe against" and the machine refuses
to load at all, so the key must be wired from the built-in hook and not only
from the `historyPagination` override.

Re-arming happens on a user scroll **into** the band from above, not on every
upward event inside it. Deciding it from the classified scroll rather than from
`wheel` follows the rule above (the overlay scrollbar fires no wheel event) and
keeps the in-flight-load guard from being the only thing standing between the
machine and the burst it exists to prevent.

The same machine covers a first page that does not fill the viewport, where no
scroll event is ever produced: `scrollTop` is 0, which is inside the band, and
the progress key stops it asking twice.

Near-bottom is reported to the view as **"the app is following"**, not
"`scrollTop` happens to be within 64px of the end". A reader who nudged the view
up ten pixels is reading: the jump-to-bottom button appears and the
mounted-window pin engages, even though they are still inside the band.

## Holding the position while the document changes

A chat transcript changes length in both directions under a reader who is not at
the bottom: actions pop in one by one and then fold into a single group row,
markdown settles, images load, older history splices in above.

While detached, the web viewport keeps a **scroll anchor**: the first on-screen
row plus its offset **in the content**, measured with `getBoundingClientRect`
against the scroll container. Not `offsetTop`, so that the whole container moving
on screen (which is what the mobile keyboard does) cancels out instead of reading
as drift. After every commit, and on every resize, the anchor's drift is measured
and subtracted back off. The row under the reader's eyes does not move.

**Content space, not viewport space, and that is load-bearing.** A row's
viewport-relative top is `contentRelativeTop - scrollTop`, so the reader
scrolling and the document reflowing move it by the same kind of number and a
correction computed from it cannot tell the two apart. It does not have the
information. A content-relative position is independent of `scrollTop` by
construction: the reader can move as much as they like and the measured drift
stays exactly zero, so the app writes nothing.

That distinction has to be structural rather than inferred, because the app
cannot win the race that would otherwise decide it. The correction runs from a
layout effect, which React runs synchronously at commit, while the scroll event
that reports the reader's movement is dispatched asynchronously afterwards. The
commit is therefore first in the ordinary case, not the rare one. A viewport-space
anchor saw the reader's own scroll as drift and wrote it straight back one
frame before `handleDomScroll` could re-capture, and because the restored value
then matched `programmaticScrollTopRef`, the handler classified the reader's
movement as the app's own echo and never refreshed the anchor. The transcript
pinned itself at the moment of detach and could not be scrolled again: measured
on a 157-item chat, seventeen consecutive gestures produced zero net movement.

The lesson generalises past this one site. `programmaticScrollTopRef` can only
answer "did the app write this value", never "did the app write it _because of_
the reader", so nothing downstream of a write may be the thing that decides
whether the write was legitimate. Keep the two causes separable in the
measurement itself.

Two regions, two mechanisms, and **one owner per correction**:

- **Mounted rows** use the scroll anchor above.
- **The virtualizer's block** compensates `scrollTop` itself when a row swaps its
  estimate for its measured height, via TanStack Virtual's
  `shouldAdjustScrollPositionOnItemSizeChange`. The anchor skips this block by
  its `data-stream-virtualized-block` attribute; anchoring to it would count the
  same correction twice.

Skipping the block as an anchor _candidate_ is not enough on its own, because
the anchored row sits **below** the block, and the block reflowing moves that
row in content space. The anchor sees it and corrects it - so if the absorb
also fires, the same reflow is corrected twice. The double write is a ratchet:
when estimates overshoot, every measurement batch subtracts the error twice and
the reader walks to the very top of the transcript one commit at a time, which
is exactly the reported "bounces to the very top" shape. The rule is ownership,
decided in the `shouldAdjustScrollPositionOnItemSizeChange` closure in
`strategy-web.tsx`:

- **Anchor active** (detached, a mounted row on screen): the anchor owns every
  correction; the absorb declines.
- **Anchor null** (following - where it is null by construction - or detached
  so deep in virtualized territory that no mounted row is on screen): the
  absorb is the only stabilizer and stays on.

When the absorb does fire, it asks **one** question: is the resized row above
the viewport. Overriding the hook replaces TanStack's default guard
(`item.start < scrollOffset`) outright, so an override that returns one global
answer opts in every row it measures, including the overscan **below** the
viewport. Growth the reader cannot see must not move them.

It must also stay on **while following**. It used to be skipped there, on the
reasoning that the app is heading to the bottom anyway and a correction would
only fight the stick. It does not fight the stick, and skipping it is what
threw the reader to the top of the transcript on send: the stick writes an
**absolute** position (`scrollTop = scrollHeight`), so a relative correction
applied before it is overwritten rather than doubled, and with nothing
subtracting re-measurement growth back off, the once-per-frame rAF was left
chasing a document that grew faster than it could catch.

### The handoff is lossless

Rows crossing the mounted/virtualized boundary used to swap their real heights
for `estimateStreamItemHeight` guesses in a single commit. The document shrank
by the total estimate error, the browser clamped `scrollTop`, and everything
downstream of that clamp was compensation. Two of the worst bugs lived there:
the clamp's scroll event could be misread as the reader scrolling up, detaching
them mid-stream with no input at all; and the jump-to-bottom button re-entered
the same collapse on every press via the pin release, undoing itself - the
button that "does not work".

Now every mounted and live-head row renders inside a plain flex-column wrapper
(the in-flow twin of the virtual-row wrapper, so both boxes lay out
identically), and a per-commit layout pass records each wrapper's real height
into a per-chat cache. The virtualizer's `estimateSize` consults that cache
before falling back to the guess. A row that was ever on screen is therefore
handed over at its true height: no shrink, no clamp, nothing to misread and
nothing to re-absorb. Estimates only remain for history that was **never**
mounted this session - the older pages of a cold-loaded chat - which is the
case the absorb rules above exist for.

Scrolling up is what feeds the virtualizer never-measured rows, and their
estimates undershoot badly: history nobody has mounted has no cached block
heights, so an assistant reply is guessed at 220px and a tool row at 40. Each
measurement therefore reports a large positive delta, and with `overscan: 8`
that is thousands of pixels per batch, far more than a wheel tick. Applied for
rows below the fold it pushes the reader down harder than they can scroll up, so
the reachable range collapses to the part of the transcript that was already
measured. The reported shape is a chat that only scrolls through its last tenth
and behaves as though 90% of the way down were the top. Both halves live in
`shouldAbsorbVirtualRowResize` (`web-virtualization.ts`).

Corrections for rows **above** the viewport are not a wall and must stay: the
document grows above the reader by exactly what they gained, so their position in
the content is preserved and upward progress still converges on the first
message.

This is the only thing holding the position near the top of a long transcript.
The anchor is deliberately inert there: it skips the virtualized block, and every
mounted row is below the fold, so `findScrollAnchor` returns `null`.

The mounted/virtualized boundary is separately **pinned** while detached
(`findMountedWindowStart` in `web-virtualization.ts`). Left free it advances as
the agent streams, and nothing already under the reader's eyes may be handed to
the virtualizer while they are reading it.

The walk-back to the turn's opening user message is deliberately **uncapped**.
A 40-row cap existed while the mounted tail was 12 rows, and it settled for a
boundary inside a long streaming turn - which advanced the boundary mid-turn,
row by row, each advance a handoff commit under a reader who was just watching.
With the full walk, the boundary is frozen for the whole of a turn and moves
only when a new user message enters, and a send is an explicit bottom request.
The cost is upstream Paseo's cost: a very long turn stays fully mounted while
it streams.

The mounted tail (50 rows) and the virtualize-above threshold (100 items) are
upstream Paseo's numbers, restored after being cut to 12/8/40 for mobile
streaming cost. The cut parked the virtualizer against the live turn and paid
for itself in the compensation machinery above; if mobile needs the cost back,
win it by making rows cheaper, not by shrinking the tail.

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
| `agent-stream/web-virtualization.ts`       | The mounted/virtualized split, the pin that freezes it, and the resize guard    |
| `agent-stream/history-start-pagination.ts` | One older-history request per page delivered, and when it re-arms               |
| `agent-stream/view.tsx`                    | Owns `isNearBottom`, the pin state, the jump-to-bottom button                   |

Tests that encode the rules above: `strategy-web.test.tsx` (scrollbar drag
detaches, clamping does not, the anchor holds a row still, a reader scroll is not
written back when a commit lands before the scroll event, one older-history
request per page), `web-virtualization.test.ts` (a row resized below the fold
does not move the reader, a row resized above it is absorbed in **both**
follow states, a long single turn stays fully mounted while following, and the
re-measure that follows a pin release leaves nothing over to push the reader
up) and `bottom-anchor-controller.test.ts` (drag beats a pending verification,
a single layout jump does not).
