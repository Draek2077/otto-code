---
id: "finding-2026-08-21-sent-user-image-missing-from-chat"
kind: "finding"
title: "Sent user image missing from the chat row"
status: "proposed"
tags: ["finding","chat","attachments","images","regression","provider-parity"]
created_at: "2026-08-21T16:01:54.706Z"
updated_at: "2026-08-21T16:06:37.051Z"
---
# Sent user image missing from the chat row

<!-- compiled_truth -->

A user reported that a just-sent image was absent from the corresponding User message in a GPT/Codex chat. The regression may be provider-specific or may affect the provider-neutral user-image presentation path; investigation is in progress.

## Timeline

- time: "2026-08-21T16:01:54.706Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T16:01:54.706Z"
  kind: "evidence"
  summary: "User report on 2026-08-21: after sending an image in a GPT chat, the User message did not show the image. They noted a previous occurrence had been fixed and suspected a regression."
- time: "2026-08-21T16:06:37.051Z"
  kind: "evidence"
  summary: "The affected Codex session persisted two user-role input records at creation: an earlier text-only bootstrap record followed by a record containing four `input_image` parts. `handoffCreatedAgentUserMessageToStream` selected the first canonical user row unconditionally, so it could transfer the local image metadata to the bootstrap row rather than the submitted prompt. The client-side attachment store no longer contained the sent `att_*` files, consistent with the actual message row having lost its live attachment reference. The handoff now ranks client id, provider id, and submitted text before falling back to the last canonical user row; a unit regression test covers the Codex bootstrap case."
  source: "Local Codex session and app code inspection on 2026-08-21"
