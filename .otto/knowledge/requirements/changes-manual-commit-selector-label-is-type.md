---
id: "changes-manual-commit-selector-label-is-type"
kind: "requirement"
title: "Changes manual commit selector label is Type"
status: "proposed"
tags: ["changes","git","ui","copy"]
created_at: "2026-08-21T15:47:37.300Z"
updated_at: "2026-08-21T15:53:15.094Z"
---
# Changes manual commit selector label is Type

<!-- compiled_truth -->

The manual commit message controls in the Changes sidebar label the conventional commit-type selector as "Type" rather than "Commit type", and label its no-prefix option as lowercase "none". The selector's behavior and other option descriptions are unchanged.

## Timeline

- time: "2026-08-21T15:47:37.300Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T15:47:37.300Z"
  kind: "evidence"
  summary: "User request on 2026-08-21: \"for the manual commit message of the changes sidebar, the type has the label \\\"Commit type\\\" and should just say \\\"Type\\\"\". Implemented in `packages/app/src/i18n/resources/en.ts` and covered by the visible-label assertion in `packages/app/e2e/commit-type-selector.verify.spec.ts`."
- time: "2026-08-21T15:53:15.094Z"
  kind: "decision"
  summary: "User requested that the selector's \"None\" option match the lowercase styling of the other conventional commit options; implementation and the focused E2E assertion were updated accordingly."
  source: "User request on 2026-08-21; packages/app/src/i18n/resources/en.ts; packages/app/e2e/commit-type-selector.verify.spec.ts"
