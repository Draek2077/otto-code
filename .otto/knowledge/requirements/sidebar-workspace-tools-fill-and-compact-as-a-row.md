---
id: "sidebar-workspace-tools-fill-and-compact-as-a-row"
kind: "requirement"
title: "Sidebar workspace tools fill available width before compacting"
status: "proposed"
tags: ["ui","sidebar","workspace-tools","responsive","layout"]
created_at: "2026-08-21T15:39:18.964Z"
updated_at: "2026-09-02T12:36:18.762Z"
---
# Sidebar workspace tools fill available width before compacting

<!-- compiled_truth -->

The active workspace tools toolbar in the left sidebar measures its full available width and uses it without arbitrary per-button caps.

The smallest usable row is icon-only. As the row gains room, labels reveal progressively in a stable, useful order rather than all switching together:

- **Scripts** reveals first.
- The current **Git** primary-action label reveals next.
- **Open** reveals last, because its editor icon remains recognizable while its split button needs the least early width.

With Scripts, Open, and Git all available, the tested thresholds are 304px for Scripts, 356px for Git, and 392px for Open. Revealed controls share the remaining width; controls whose labels are still hidden stay icon-only with their existing accessible names and tooltips. If Scripts is unavailable, its width is not reserved and Git becomes the first label to reveal. In fully icon-only mode all three controls take equal shares of the row; wrappers between the row and a control (such as the Scripts tooltip trigger) must carry the fill flex styles themselves or they cap the wrapped control at natural width.

**Heights are cooperative, never pinned.** The row's controls are not equalized by fixed heights or minHeight pins across components. Instead every control shares the git Commit split button's geometry recipe (sm label font on a 1.5 line height with the compact +2 bump, spacing[1] vertical padding, 1px border), so each control naturally lands on the same height, in the sidebar row and in the workspace header alike. The one intrinsic minimum allowed is inside a control's own content: the label's line height stays the content minimum so the icon-only state matches the labeled state.

## Timeline

- time: "2026-08-21T15:39:18.964Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T15:39:18.964Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-21, supported by screenshot showing icon-only controls despite ample sidebar width and an overflowing Scripts control. Implemented in sidebar-active-workspace-tools.tsx plus the shared Scripts, Open in Editor, and Git split-button fill styles."
- time: "2026-08-25T03:32:00.970Z"
  kind: "decision"
  summary: "User requested fluid progressive label reveal on 2026-08-24; implemented and verified with focused unit test, app lint, and app typecheck."
- time: "2026-09-02T12:36:18.762Z"
  kind: "decision"
  summary: "User rejected two pinned-height equalization attempts (26px header pin, then a 32px floor) and stated explicitly that the git Commit split button is the correct size and sibling controls must reach that height naturally from the same geometry recipe. Scripts and Open were converged onto that recipe on 2026-09-02 (Scripts lost its fixed 26px height and 16px label; Open gained the vertical inset and sm label). The same fix made icon-only mode split the row into equal thirds by giving the tooltip wrapper the fill flex styles. User verified the result visually. Status returned to proposed for review."
  source: "Chat fix 2026-09-02: packages/app/src/screens/workspace/workspace-scripts-button.tsx, workspace-open-in-editor-button.tsx, components/sidebar/sidebar-active-wor"
