---
id: "knowledge-only-commits-fail-format-hook"
kind: "finding"
title: "Knowledge-only commits fail the format hook despite valid generated Markdown"
status: "confirmed"
tags: ["project-knowledge","tooling","formatting","lefthook"]
created_at: "2026-08-20T03:48:32.883Z"
updated_at: "2026-08-20T03:50:01.764Z"
---
# Knowledge-only commits fail the format hook despite valid generated Markdown

<!-- compiled_truth -->

The project-knowledge writer emits valid Markdown. The pre-commit format job does not exclude `.otto/knowledge/**`, while oxfmt does; when a staged commit contains only Knowledge files, oxfmt receives no eligible targets and exits non-zero. This is hook-selection plumbing, not generated-content formatting.

## Timeline

- time: "2026-08-20T03:48:32.883Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-20T03:48:32.883Z"
  kind: "evidence"
  summary: "Verified 2026-08-19: `.oxfmtrc.json` ignores `.otto/knowledge/**`; `lefthook.yml` format excludes do not mirror that pattern. `npm run format:check:files -- .otto/knowledge/index.md <knowledge-page>` exits with “Expected at least one target file.” Adding CHANGELOG.md makes the same invocation pass and reports one formatted file."
- time: "2026-08-20T03:50:01.764Z"
  kind: "note"
  summary: "The user requested the verified hook configuration fix on 2026-08-19. New status: confirmed."
