---
id: "brain-bundle-download-progress-ring"
kind: "requirement"
title: "Bundle downloads show an inline progress ring"
status: "confirmed"
tags: []
created_at: "2026-08-11T15:56:14.938Z"
updated_at: "2026-08-11T19:43:28.559Z"
---

# Bundle downloads show an inline progress ring

<!-- compiled_truth -->

When a bundle download is running, the Library replaces the fixed-width progress bar with a compact determinate progress ring immediately before the quant action button. The ring does not alter the aligned action-row layout. The bundle options control remains visible only once a bundle quant is installed.

## Timeline

- time: "2026-08-11T15:56:14.938Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T15:56:14.938Z"
  kind: "evidence"
  summary: "User-directed UX decision in this implementation conversation on 2026-08-11."
- time: "2026-08-11T18:31:06.136Z"
  kind: "evidence"
  summary: "Bundle component selections now launch one unified pull plan containing the selected primary quant and all selected companion artifacts. The determinate progress ring is rendered only inside the bundle action button; the separate adjacent ring/progress rendering was removed."
  source: "User feedback and implementation, 2026-08-11."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T18:42:19.099Z"
  kind: "evidence"
  summary: "Observed during bundle-download diagnosis, 2026-08-11: the bundle CLI branch updated host activity but emitted no child stderr progress, while the daemon derives job percent solely from child output. The progress ring therefore froze even when bytes continued. Bundle option switches must only select companions; starting transfers remains the explicit quant Download action so dismissing the options sheet cannot affect a running transfer. A failed bundle job suppresses its Installed badge and keeps the quant retryable while its terminal job record is retained."
  source: "Implementation and user-reported reproduction, 2026-08-11."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T18:45:15.726Z"
  kind: "evidence"
  summary: "Follow-up correction, 2026-08-11: a bundle row must keep Download enabled when its selected primary quant is already installed, because the same explicit bundle job adds selected missing companions and safely skips the existing primary."
  source: "User feedback and implementation, 2026-08-11."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T18:48:34.775Z"
  kind: "evidence"
  summary: "Superseding the prior interaction note per explicit user correction, 2026-08-11: bundle component switches are direct installation controls. Enabling a companion starts the unified pull for the currently selected quant and checked components; disabling it removes that optional artifact. The operation is daemon-owned and continues after the options sheet closes. The row must bind switches to the currently selected quant rather than a catalog default."
  source: "Explicit user-directed UX correction, 2026-08-11."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T19:43:28.559Z"
  kind: "evidence"
  summary: "Follow-up diagnosis, 2026-08-11: the bundle options sheet must derive switch state from the live joined model inventory, not from catalog defaultDownload values. After a component mutation it refreshes that inventory and uses the resolved installed model ID for removal, so an option does not remain checked merely because the primary model exists or because catalog defaults are stale."
  source: "User-reported verification and implementation, 2026-08-11."
  affects: ["brain-model-bundles"]
