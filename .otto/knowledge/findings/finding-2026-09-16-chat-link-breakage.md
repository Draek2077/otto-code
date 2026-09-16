---
id: "finding-2026-09-16-chat-link-breakage"
kind: "finding"
title: "Chat links are underlined before anything proves they can open"
status: "proposed"
tags: ["chat","links","file-navigation","tooltips"]
created_at: "2026-09-16T20:12:44.840Z"
updated_at: "2026-09-16T20:12:44.840Z"
---
# Chat links are underlined before anything proves they can open

<!-- compiled_truth -->

Chat decides whether to underline a link without checking that a click can open it. Markdown `[text](href)` links are always underlined; `message.tsx` renders every `link` node through `AssistantMarkdownLink`. Backticked tokens are underlined when `canResolveFile` returns true, and that includes every `needsLookup` token, before the daemon has found anything. Across the corpus, about 27% of underlined chat links cannot open. Most of the failures come from backticked tokens that look like files, not from real URLs.

Verified classifier false positives:
(1) Tokens starting with a dot count as file names, so extensions and method names are underlined (`.ts`, `.sln`, `.csproj`, `.catch()`, `.cm-scroller`).
(2) Any absolute path counts as plausible, so slash commands and routes (`/compact`, `/cloud`, `/setup`) become file links.
(3) Markdown links to Windows backslash paths are percent-encoded by markdown-it to `C:%5C...`, classified as external URLs, and dropped silently.
(4) Only http(s) opens: the desktop opener throws for `mailto:` and `vscode://`, and the throw is swallowed.
(5) Directory links and extensions outside `ASSISTANT_FILE_EXTENSIONS` (Dockerfile, .png, .adoc, NOTICE) do nothing when clicked, with no feedback. However, `mailto:` autolinks and markdown links are still underlined.
(6) The suffix lookup uses `limit: 1`, so an ambiguous name such as `view.tsx` opens an arbitrary match.

Stale paths in older chats (files that have since moved) account for the remaining silent failures. The daemon suffix search itself works.

## Timeline

- time: "2026-09-16T20:12:44.840Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["chat-detected-links-expose-terminal-equivalent-actions"]
- time: "2026-09-16T20:12:44.840Z"
  kind: "evidence"
  summary: "Method, 2026-09-16: extracted 10,081 assistant text blocks from the 300 most recent Claude sessions for this repo. Parsed them with `createAssistantMarkdownParser()` and ran each rendered link (markdown links, autolinks, and backticked tokens that chat underlines) through `classifyForResolution` with the repo root as `workspaceRoot`. Resolved files were checked on disk, and lookups against `git ls-files` suffix matches.\n\nResults: 5,970 underlined links.\n- OK: 60.2% backticked lookup found, 12.1% markdown link to an existing file, 2.4% http(s).\n- Broken: 12.3% backticked bare name with no such file (top: remaining-work.md, .slnx, .sln, .ts, .csproj, .web.tsx, .cm-scroller, .transform()); 3.6% backticked relative path with no such file; 3.3% backticked absolute or home path that does not exist (~/.otto, /cloud, /compact, /open-project); 2.9% markdown link to a moved or missing file (mostly legacy `projects/` pages); 1.4% backticked directory (file-only search); 0.6% directory opened as a file; 0.1% `C:%5C` markdown links; plus small silent buckets.\n\nThe daemon's `searchDirectoryEntries` with `matchMode: \"suffix\"` was run on Windows against 19 real queries, and all resolved (about 1s each for bare names). `packages/desktop/src/features/opener.ts` rejects non-HTTP(S) URLs.\n\nCaveats: these are Claude CLI sessions, not Otto chats, but they come from the same agents and repo. `~` paths were checked without tilde expansion. Click behavior was not exercised in a running app.\n\nMitigation shipped in the working tree the same day: hover tooltips on every chat link show the real target, and say \"Otto can't open this link\" or \"No matching file in this workspace\" when it cannot open."
