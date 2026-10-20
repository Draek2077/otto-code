---
id: "brain-hosting-profile-system-prompts-are-injected-by-the-router-not-the-jinja"
kind: "decision"
title: "Brain hosting-profile system prompts are injected by the router, not the Jinja template"
status: "proposed"
tags: ["otto-brain", "hosting-profiles", "router", "system-prompt"]
created_at: "2026-08-12T22:17:32.583Z"
updated_at: "2026-08-12T22:17:32.583Z"
---

# Brain hosting-profile system prompts are injected by the router, not the Jinja template

<!-- compiled_truth -->

A Brain hosting profile's `systemPromptAddendum` is carried onto the launch profile as `chatSystemAddendum` by `resolveHostingProfileForLaunch`, and the router appends it to each buffered completion request in `injectSystemAddendum` (packages/brain/src/service/router.ts). It is deliberately not spliced into the selected Jinja chat template.

Splicing was the original design and cannot be done portably: it requires rewriting the `messages` list from inside the template, minja's list-mutation support differs from Jinja2's, every model family's template consumes the system turn differently, and a message's `content` is an array of parts for multimodal requests rather than a string to concatenate onto.

Injection happens in `proxyBuffered`, after the scheduler has made the target model resident, so the addendum always belongs to the model that will actually serve the request rather than the one that was resident when the request was queued. It appends after the agent's own system prompt (Anthropic's top-level `system` field, or the first `system`/`developer` message for OpenAI), handles string and structured content, and forwards any body it cannot parse untouched so llama-server still returns its own error.

## Timeline

- time: "2026-08-12T22:17:32.583Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-profile-selection-and-editor-ux"]
- time: "2026-08-12T22:17:32.583Z"
  kind: "evidence"
  summary: "Established on 2026-08-12 while fixing the Brain prompt/template feature: systemPromptAddendum was persisted, validated and edited in the UI but read by no launch or request path. Covered by injection tests in packages/brain/src/service/router.test.ts and resolution tests in packages/brain/src/config/hosting-profiles.test.ts."
