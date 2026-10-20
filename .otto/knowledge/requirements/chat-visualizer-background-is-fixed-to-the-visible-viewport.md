---
id: "chat-visualizer-background-is-fixed-to-the-visible-viewport"
kind: "requirement"
title: "Chat visualizer background is fixed to the visible viewport"
status: "proposed"
tags: ["visualizer","chat","layout","interaction"]
created_at: "2026-09-05T23:51:22.169Z"
updated_at: "2026-09-06T02:46:17.827Z"
---
# Chat visualizer background is fixed to the visible viewport

<!-- compiled_truth -->

The Visualizer can occupy the visible chat pane behind both the conversation and the Composer area, including the bottom inset. Its canvas is stationary while messages scroll over it and resizes with the pane, never with transcript length. The Composer input, its flyovers, and restore controls remain above the graph and usable, including while the conversation is hidden. The full-width Composer gutter is transparent in background mode. The entire Composer section, including empty gutters and the bottom inset, is excluded from background hover and click gestures. Entering it clears the hover hint without changing an explicitly hidden conversation.

The background is a passive presentation, like PIP: no Visualizer toolbar, Live indicator, playback strip, or informational panels. Readable conversation text stays opaque normally. Hover preview starts only after a 200 ms pause in clearly empty space, checking 10 px above and below the pointer to exclude short inter-message/action gaps. No sideways clearance is required, so narrow side gutters remain usable. Movement beyond 6 px restarts the entry delay; slight pointer jitter does not. Once active, moving within clear space keeps the preview stable. Returning to content immediately restores normal reading opacity. Pointer presses, exit/cancel, scrolling, resizing, and disabling the background cancel pending previews. An active hover preview fades the conversation to 25%; clicking empty background hides the conversation and shows the graph at full opacity. Clicking again or using the explicit restore control returns the conversation without losing its scroll position. Escape also restores it on web and desktop. Text selection, message interactions, and scrolling retain their normal behavior.

The placement is remembered and shares the existing Visualizer renderer and provider-neutral event adapter with [[visualizer-pip]]. The background explicitly follows its owning chat, resolving attended and observed child chats to the same workspace-root session used by the event adapter. Selection waits until that session is registered in the guest. Only the focused visible chat mounts a background guest, and background, PIP, and tab placements are mutually exclusive in the active workspace.

When the conversation is hidden, the focused root AI node retains its latest assistant reply through the Visualizer's native `messageBubbles` renderer. The bubble survives user prompts and tool activity, and only the next assistant reply replaces it. It is not a chat-card overlay or a second message renderer. The native auto-fit camera reserves the bubble's full footprint so the reply stays within the canvas. Regular tab and PIP Visualizer surfaces keep message bubbles suppressed.

In background mode, both chat seam fades reveal the actual animated visualizer by masking the transcript to transparency across the top and bottom 24 pixels. The normal painted seam gradients are suppressed only in this mode. The scrollbar gutter stays opaque in the mask, and outline/jump controls remain outside it. The mask wrapper stays mounted when placement changes, preserving the scrolling transcript. The backing fill beneath the translucent guest uses its stage color. Closing background mode disables the mask and restores both normal chat seam gradients.

The background overlay toolbar offers a direct Collapse to picture-in-picture action beside the conversation and tab controls. It switches through the shared placement controller and remembers PIP. The action is hidden on compact layouts where PIP is unavailable.

The PIP hover controls also offer Use as chat background whenever the workspace has a chat or draft. This closes PIP, focuses the currently focused chat (or the first available chat when another pane type is focused), and remembers background placement through the same controller.

## Timeline

- time: "2026-09-05T23:51:22.169Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["visualizer-pip"]
- time: "2026-09-05T23:51:22.169Z"
  kind: "evidence"
  summary: "User request on 2026-09-05: use only the visible window area and scroll the chat over the non-moving visualizer; approved implementation with 'go'. Follow-up explicitly requires no Live indicator or toolbar, similar to PIP. Implemented and documented in docs/visualizer.md, Chat background. Chromium runs of packages/app/e2e/browser/visualizer-open-boot.spec.ts verified fixed bounds while scrolling, 50% hover opacity, hide/restore, retained scroll position, inert hidden content, and resize, with screenshots. The final tab-return assertion was corrected after video showed a rendered guest with a chat picker shrunk out of view in a narrow split; the subsequent rerun timed out in Metro startup, so the complete E2E spec is not claimed green. Three use-chat-background-pointer tests, typecheck, targeted lint, and diff whitespace checks passed. Electron/native runtime behavior has not been separately exercised."
- time: "2026-09-06T00:30:26.900Z"
  kind: "decision"
  summary: "User requested the canvas extend behind the Composer to the bottom of the pane and reported missing agents. Extended coverage and corrected a verified child-chat session identity mismatch; the user's exact missing-agent state was not independently reproduced. Chromium E2E now passes selected-session, full-pane/Composer bounds, retained scroll, opacity toggles, editable Composer while hidden, resize and tab return. The 27 focused adapter tests (including shared parent/child graph session), app typecheck and targeted lint pass."
  source: "2026-09-05 user follow-up and verified implementation"
  affects: ["visualizer-pip"]
- time: "2026-09-06T00:42:09.348Z"
  kind: "decision"
  summary: "User explicitly requested that the chat fade use the visualizer background color only when background mode is enabled. The renderer now publishes its actual stage color to the surrounding pane and fades. Verified with the focused Chromium E2E: computed gradient contains the stage color while enabled and equals its original gradient after closing; screenshot checked. Targeted lint passes. App typecheck is currently blocked by an unrelated pre-existing working-tree error in e2e/support/helpers/chat-outline.ts:51, where 'chat' is outside the settings-section union."
  source: "User request and Chromium verification, 2026-09-05"
- time: "2026-09-06T01:29:15.258Z"
  kind: "decision"
  summary: "The user's screenshot showed that the previous flat stage-color override still left a visible band (empty gutter RGB 25,25,28 brightening to roughly 30,30,34). Replaced painted overlays in background mode with transcript alpha masks on both edges, revealing the actual canvas. Two dark/black-theme Chromium runs passed pixel checks at both seams; the sampled gutter stayed RGB 7,7,7 across both fade regions, and screenshots were inspected. The first run also verified both normal gradients restored on closing, before a test locator failed. Corrected that locator and a later test assumption that required an entire long bubble to fit onscreen. The final focused rerun timed out in test setup at DaemonClient.createAgent (60 seconds), before the app loaded, and its worker teardown also timed out; the whole spec is not claimed green for this revision. App typecheck, targeted lint and diff whitespace checks pass. Native/Electron runtime rendering has not been separately exercised."
  source: "User screenshot correction and verified Chromium seam captures, 2026-09-05"
- time: "2026-09-06T01:33:14.277Z"
  kind: "decision"
  summary: "User requested a PIP button in the chat background overlay toolbar. Added the existing PictureInPicture icon and collapseToPip transition with the same compact-layout gate as the tab toolbar. Documented in docs/visualizer.md. App typecheck, targeted lint and whitespace checks pass; this small control addition was not separately browser-exercised."
  source: "User request and implementation, 2026-09-05"
- time: "2026-09-06T01:37:38.456Z"
  kind: "decision"
  summary: "User pointed out that PIP had no direct return to chat background. Added a Layers control using the existing showAsBackground transition, with availability derived from chat/draft tabs. Both placement callbacks were reviewed for mutually exclusive settings and remembered placement. App typecheck, targeted lint and diff whitespace checks pass; runtime switching was not separately browser-exercised in this change."
  source: "User request and implementation, 2026-09-05"
- time: "2026-09-06T01:42:53.917Z"
  kind: "decision"
  summary: "User requested a stronger conversation fade while hovering the visualizer background. Lowered hover opacity from 50% to 25%, retaining the existing 80% background opacity. Updated the documented value and existing browser assertion. App typecheck, targeted lint and whitespace checks pass; the browser spec was not rerun for this opacity adjustment."
  source: "User feedback and implementation, 2026-09-05"
- time: "2026-09-06T01:50:35.624Z"
  kind: "decision"
  summary: "User requested that the whole Composer area stop activating the background visualizer hint. The pointer classifier now excludes the existing chat-visualizer-composer wrapper and all descendants, covering empty space as well as controls. The focused pointer suite passes all four tests, including entering the Composer shell/gutter/input from an active hover hint, rejecting Composer clicks as background toggles, and re-entering conversation background. App typecheck, targeted lint and whitespace checks pass."
  source: "User feedback and verified interaction regression, 2026-09-05"
- time: "2026-09-06T01:57:18.473Z"
  kind: "decision"
  summary: "User reported flashing while crossing small gaps between chat elements. Added delayed hover entry and bounded neighborhood hit testing instead of activating from the exact pointer target alone. Click gestures retain their existing deliberate-toggle behavior. The focused pointer suite passes all 11 tests, covering delayed entry, movement versus jitter, steady preview in clear space, narrow gaps and edge gutters, cancellation, new content arriving during the delay, Composer exclusion, and existing click/selection/scroll safeguards. Updated documentation and the browser expectation for a narrow gutter. App typecheck, targeted lint and whitespace checks pass; the full browser spec was not rerun."
  source: "User feedback and verified interaction regressions, 2026-09-05"
- time: "2026-09-06T02:03:47.125Z"
  kind: "decision"
  summary: "User reported the 24 px all-direction clearance made the hover preview inaccessible and requested vertical-only clearance of 10 px. Updated hit testing to sample at the pointer and 10 px above/below, permitting narrow side gutters beside messages while retaining the 350 ms dwell. All 11 focused interaction tests pass, including side-gutter access next to content and a 20 px vertical opening; app typecheck, targeted lint and whitespace checks pass. Updated documentation and the existing browser assertion; the browser spec was not rerun."
  source: "User correction and verified regression tests, 2026-09-05"
- time: "2026-09-06T02:12:54.405Z"
  kind: "decision"
  summary: "User requested reducing the hover entry delay from 350 ms to 200 ms. Updated the delay, documentation and timing assertions. All 11 focused interaction tests, app typecheck, targeted lint and whitespace checks pass."
  source: "User tuning request and verified tests, 2026-09-05"
- time: "2026-09-06T02:21:19.720Z"
  kind: "evidence"
  summary: "User requested that the fully hidden chat-background state retain one conversational surface instead of reverting to the old transcript feed: the latest assistant reply is shown above the graph until another assistant reply begins. Implemented a bounded, internally scrollable Markdown card sourced from the canonical tail/head stream. It re-joins promoted assistant markdown blocks, keeps the previous reply across later user prompts and tool activity, and replaces it only with the next visible assistant response. Added three focused extraction tests; targeted lint, app typecheck, formatter, and diff whitespace checks pass."
  source: "User request and implementation verification, 2026-09-05"
- time: "2026-09-06T02:39:11.766Z"
  kind: "decision"
  summary: "The user rejected the bespoke chat-card overlay and explicitly approved the native Visualizer node-bubble presentation; the durable behavior is now a persistent latest assistant reply that the native auto-fit camera keeps fully in view."
  source: "User feedback and verified native Visualizer implementation, 2026-09-06"
  affects: ["visualizer-pip"]
- time: "2026-09-06T02:46:17.827Z"
  kind: "evidence"
  summary: "User reported that submitting from the Composer restored the chat and that the native reply bubble retained too little content. Hidden background state is now keyed to the workspace tab and is cleared only by restore/closing the background, so composer sends and the draft-to-agent replacement preserve the graph-only view. The native persistent bubble receives a viewport-relative line budget of up to 78% of visible canvas height and 24 wrapped lines; ordinary transient bubbles retain eight lines. `npm run build:visualizer`, the 11 focused chat-background-pointer tests, targeted lint, app typecheck, and diff whitespace checks pass."
  source: "User feedback and verification, 2026-09-06"
  affects: ["visualizer-pip"]
