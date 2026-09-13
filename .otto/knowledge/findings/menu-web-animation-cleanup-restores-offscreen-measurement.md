---
id: "menu-web-animation-cleanup-restores-offscreen-measurement"
kind: "finding"
title: "Web menu animation cleanup could restore the off-screen measurement box"
status: "proposed"
tags: ["menus","animation","ux","project-knowledge"]
created_at: "2026-09-13T05:05:23.511Z"
updated_at: "2026-09-13T05:05:23.511Z"
---
# Web menu animation cleanup could restore the off-screen measurement box

<!-- compiled_truth -->

## Observed failure

The Project Knowledge Tags picker could appear correctly and then disappear while remaining open internally. The shared web menu used a custom Reanimated entering keyframe whose delayed cleanup restored a captured layout rectangle. That rectangle could still contain the initial `(-9999, -9999)` measurement position. React retained the correct anchored position, so no ordinary state update repaired the DOM overwrite. A long scrollable Tags menu reproduced the issue; the user's Types menu did not.

## Verified correction

Shared web menus now animate only opacity and scale through Web Animations after positioning. Anchor measurement and content layout retain ownership of position and size. Native menus keep the existing Reanimated entering animation. The old height-clearing timers were removed because they ran before the later geometry rewrite. Durable guidance is in `docs/menus.md`.

The correction was verified in the running development browser and a focused browser regression test. Installed release and native device behavior were not tested in this effort.

## Timeline

- time: "2026-09-13T05:05:23.511Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-13T05:05:23.511Z"
  kind: "evidence"
  summary: "Otto browser tools inspected the running development Knowledge page at localhost:8081. Before the change, the Tags picker contained 542 items; the DOM surface settled at x=-9999/y=-9999 while React's FloatingSurface frame props specified x=340.6667/y=301.1111. On reopening, 35ms samples showed a correctly positioned ~322px menu before it returned off-screen near the custom keyframe cleanup deadline. Local Reanimated source componentUtils.ts calls setElementPosition from scheduleAnimationCleanup; domUtils.ts sets cleanup to 5 times the 150ms animation duration. After replacing the web entering animation, the live menu remained positioned beyond 1750ms. A subsequent check scrolled to 600px, confirmed a visible architectural-views tag was hit-testable, selected it, waited 1100ms with the menu still open, and toggled it back to restore the filter. Focused real-browser test use-menu-web-entering-animation.browser.test.tsx passed, checking geometry, content growth, and hit testing beyond the old cleanup deadline. App typecheck and targeted lint passed."
