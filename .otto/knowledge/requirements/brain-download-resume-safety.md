---
id: "brain-download-resume-safety"
kind: "requirement"
title: "Brain downloads resume only with validated identity"
status: "confirmed"
tags: ["brain", "downloads", "reliability"]
created_at: "2026-08-11T06:00:37.471Z"
updated_at: "2026-08-11T06:00:37.471Z"
---

# Brain downloads resume only with validated identity

<!-- compiled_truth -->

Otto Brain model downloads must resume partial files whenever it can safely prove they belong to the same remote representation. Resume requires saved source identity and exact byte-range validation; otherwise the partial must be discarded and the download restarted cleanly.

## Timeline

- time: "2026-08-11T06:00:37.471Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T06:00:37.471Z"
  kind: "evidence"
  summary: "User requirement, 2026-08-10: 'download should 100% resume partials if it can do it safely.'"
