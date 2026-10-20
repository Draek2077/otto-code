---
id: "file-mention-quoting-is-the-intentional-user-visible-form-wysiwyg-not-a-leak"
kind: "decision"
title: "File mention quoting is the intentional user-visible form (WYSIWYG), not a leak"
status: "proposed"
tags: ["file-mention","composer","agent-input","wysiwyg"]
created_at: "2026-08-18T22:43:40.763Z"
updated_at: "2026-08-18T22:43:40.763Z"
---
# File mention quoting is the intentional user-visible form (WYSIWYG), not a leak

<!-- compiled_truth -->

The double-quoted, escaped path that `@` file-mention autocomplete inserts into the composer (e.g. `"src/components/chat.tsx"`, via `formatQuotedFileMentionPath` in `packages/app/src/utils/file-mention-autocomplete.ts`) is the intentional user-visible representation, and is deliberately the same string sent to the agent. There is no separate display/wire boundary: the composer's plain TextInput string flows untransformed through `submitAgentInput` → `dispatchComposerAgentMessage` → `sendAgentMessage`, and is reused verbatim by the user bubble (`message.tsx`), Copy, Rewind, and history recall. Keeping one form end-to-end preserves WYSIWYG; the quotes/escaping exist for the model (they make paths containing spaces or quotes unambiguous). A clean token display form (Option A) was evaluated and rejected: the composer has no structured token infra, so a serializer could not re-detect which `@x` spans are mentions, and diverging display vs. wire forms would break copy/rewind/history consistency. The doc comment on `formatQuotedFileMentionPath` and the tests in `file-mention-autocomplete.test.ts` pin this contract; only a move to structured mention tokens would change it.

## Timeline

- time: "2026-08-18T22:43:40.763Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-18T22:43:40.763Z"
  kind: "evidence"
  summary: "Investigation confirmed: (1) `use-agent-autocomplete.ts` inserts `formatQuotedFileMentionPath` output directly into composer state; (2) send path `composer/input/input.tsx` → `composer/index.tsx` `handleSubmit` → `submitAgentInput` (trim only) → `dispatchComposerAgentMessage` sends `input.text` unchanged; (3) `UserMessage` renders `{message}` verbatim; (4) git history: quoted form present since feature commit d30bb8474, escaping hardened (backslash pass added) in d66aefde5 \"remediate code scanning findings\", function extracted for reuse in bd937850b. Decision documented in code comment on `formatQuotedFileMentionPath`; tests hardened with backslash cases (10 tests passing, plus 201 composer/autocomplete tests green)."
