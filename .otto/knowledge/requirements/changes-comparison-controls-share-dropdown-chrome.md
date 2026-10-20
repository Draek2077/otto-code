---
id: "changes-comparison-controls-share-dropdown-chrome"
kind: "requirement"
title: "Changes comparison controls share dropdown chrome"
status: "proposed"
tags: ["changes", "git", "ui", "dropdown"]
created_at: "2026-08-14T18:09:15.452Z"
updated_at: "2026-08-14T18:10:42.561Z"
---

# Changes comparison controls share dropdown chrome

<!-- compiled_truth -->

# Requirement

In the Changes panel, the committed/uncommitted mode selector and committed base-branch selector are both visually explicit dropdown triggers. Each presents a trailing disclosure arrow and they share the same resting, hover, and pressed chrome colors.

The base selector remains disabled when the host cannot change the comparison base; disabled styling must not imply the control is editable.

## Timeline

- time: "2026-08-14T18:09:15.452Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["structural-diff-review-experience"]
- time: "2026-08-14T18:09:15.452Z"
  kind: "evidence"
  summary: "User request on 2026-08-14, with supplied Changes-panel screenshot and follow-up: “also their chrome colors should be the same.”"
- time: "2026-08-14T18:10:42.561Z"
  kind: "decision"
  summary: "Tighten the proposal to the user-requested visual contract without adding an unverified focus-state requirement."
  source: "User request on 2026-08-14."
  affects: ["structural-diff-review-experience"]
