---
id: "browser-chrome-find-and-project-history"
kind: "requirement"
title: "Browser chrome offers find and project browsing history"
status: "proposed"
tags: ["browser","project-settings","keyboard","history"]
created_at: "2026-09-12T14:24:10.934Z"
updated_at: "2026-09-12T14:24:10.934Z"
---
# Browser chrome offers find and project browsing history

<!-- compiled_truth -->

The Otto browser keeps common navigation controls visible and groups lower-frequency tools in its standard More menu, including Open in external browser and Find in page.

Ctrl+F must reach the browser tab while focus is inside its guest page. Find uses a blue-tinted bar with the File Editor notice geometry, a query, previous/next, match count, Highlight All, Match Case, Match Diacritics, Whole Words, and Close. Its controls must remain usable in narrow panes.

Browsing history belongs to the project on its daemon and is shared across that project's workspaces. The address bar offers matching URLs or titles in an optional popup: no matches means no popup; Enter uses the typed address until the user deliberately selects a suggestion with arrows or a click. Project settings provides Clear browsing history, with project and host scope stated in its confirmation and no clearing of cookies, site data, or open tabs.

See docs/preview.md for the implementation contract and current HTML-text search limits.

## Timeline

- time: "2026-09-12T14:24:10.934Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["browser-tab-registry"]
- time: "2026-09-12T14:24:10.934Z"
  kind: "evidence"
  summary: "User requested these browser features on 2026-09-12 and supplied a find-bar reference. Implemented in browser pane/resident lifecycle, browser-keyboard forwarding, project-settings-browser-section, and daemon browser-history store/RPCs. Verified 22 focused Chromium-rendered pane/search tests; focused resident guest regression tests; 8 desktop keyboard tests; 2 disk-backed history tests. App, client, protocol, server and desktop typechecks and targeted lint passed. An isolated, hidden Electron guest verified actual Ctrl+F forwarding, accent/whole-word search, previous wrapping, and highlight cleanup without a daemon. This is checkout validation, not an installed-app or packaged-release claim. Search limitations, including cross-origin frames and the built-in PDF viewer, are documented."
