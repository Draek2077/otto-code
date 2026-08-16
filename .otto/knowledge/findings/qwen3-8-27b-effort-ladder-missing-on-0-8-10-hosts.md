---
id: "qwen3-8-27b-effort-ladder-missing-on-0-8-10-hosts"
kind: "finding"
title: "Qwen3.8 27B effort ladder missing on 0.8.10 hosts"
status: "confirmed"
tags: ["brain", "qwen", "effort", "version-skew", "0.8.10"]
created_at: "2026-08-16T15:16:51.372Z"
updated_at: "2026-08-16T15:16:51.372Z"
---

# Qwen3.8 27B effort ladder missing on 0.8.10 hosts

<!-- compiled_truth -->

On Otto 0.8.10 (and anything before commits 00caaf540 + eced2717b, both 2026-08-14), Qwen3.8 27B's effort dropdown degrades to Off/Low/Medium with Medium default instead of the full low/medium/xhigh ladder with xhigh default. The catalog entry and its reasoningEfforts/reasoningEffortDefault fields only exist in the brain package after those commits, and the dropdown is built server-side by the openai-compat agent from the brain's /models listing. A brain or daemon on an older build cannot advertise the ladder even if the other side is updated — both must be post-0.8.10. The runtime catalog is read from the installed brain package's config/downloads.json (packages/brain/src/config/store.ts:85), so a stale package install keeps the old entry.

## Timeline

- time: "2026-08-16T15:16:51.372Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["qwen3-8-27b-effort-discovery-gap","brain-model-settings-preserve-reasoning"]
- time: "2026-08-16T15:16:51.372Z"
  kind: "evidence"
  summary: "User reported Qwen3.8 27B dropdown showing only Off/Low/Medium (Medium default) on a remote brain running Otto 0.8.10. git diff v0.8.10..main on packages/brain/config/downloads.json shows the reasoningEfforts/reasoningEffortDefault fields were added after v0.8.10. parseModelReasoningEfforts + buildAdvertisedThinkingOptions in openai-compat-agent.ts build the dropdown from the /models listing, so an older brain or older daemon reproduces the degraded menu."
