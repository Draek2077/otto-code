---
id: "dropdown-menu-section-labels-use-even-vertical-padding"
kind: "requirement"
title: "Dropdown menu section labels use even vertical padding"
status: "confirmed"
tags: ["ui", "dropdown-menu", "spacing"]
created_at: "2026-08-15T05:06:15.576Z"
updated_at: "2026-08-15T05:06:15.576Z"
---

# Dropdown menu section labels use even vertical padding

<!-- compiled_truth -->

The shared `DropdownMenuLabel` primitive uses equal top and bottom padding so section headers have visually balanced vertical spacing in every dropdown menu.

## Timeline

- time: "2026-08-15T05:06:15.576Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-15T05:06:15.576Z"
  kind: "evidence"
  summary: "User requested equal top and bottom spacing for the popup’s Favorites and Recent labels; inspection confirmed this is the shared DropdownMenuLabel primitive. Implemented in packages/app/src/components/ui/dropdown-menu.tsx and verified with formatting, lint, and app typecheck on 2026-08-14."
