# Archify runtime in Otto

Pinned upstream: tt-a1i/archify at 9e35d2b0b39b155553ba9fcfe0b4f2a5198dd993 (2.17.0-dev.1). Recovered byte-for-byte from Otto frozen source 95a19522a191394a874320041eaf05f6c5f3c682, except the patch below. MIT and Cocoon AI notices are retained.

Only the deterministic runtime, schemas, renderer assets and reference contracts are included. Upstream tests, examples, development lockfile, brand catalogue, browser/network launchers and build tooling are omitted. Otto's daemon invokes only the bounded deliver entry point; it never enables open, preview, visual-check or brand capture.

## Carried patch

- generated-brand-marks.mjs exports an empty BRAND_MARKS catalogue. No upstream brand artwork or catalogue is distributed. Otto uses the ordinary semantic component kinds. All adapter, persistence and presentation code lives in Otto-owned modules outside this directory.

The vendor tree is excluded from Otto formatting/linting so unchanged upstream files stay pinned. Validate/render fixtures, packaged asset checks and the presentation bridge must be checked after a deliberate pin update.
