---
id: "brain-model-bundles"
kind: "project"
title: "Brain model bundles"
status: "confirmed"
tags: ["brain", "models", "bundles", "vision", "vram"]
delivery_status: "partial"
progress_completed: 4
progress_total: 6
progress_unit: "phases"
created_at: "2026-08-11T06:54:59.270Z"
updated_at: "2026-08-14T19:53:01.577Z"
---

# Brain model bundles

<!-- compiled_truth -->

## Outcome

Otto Brain treats a multi-artifact local model as one selectable bundle. Users explicitly choose optional artifacts at download time and independently enable only downloaded optional artifacts at load time. Single-file text models keep the current simple workflow.

## Confirmed implementation design

- Catalog entries remain `CatalogModel` records. An entry is a bundle only when it has a declared component manifest.
- Each component has a stable ID, user-facing label and description, role, exact repository/file identity, known byte size when available, required/optional state, and default download/load behavior.
- The primary artifact is required. Current vision projectors and speculative drafters are optional. Installed components may remain disabled at load time.
- Profiles persist enabled component IDs only. Primary and component file paths are re-derived on the host and never accepted from clients.
- Bundle readiness, download plans, scanning, deletion, launch arguments, VRAM estimates, calibrations, and benchmarks are component-aware.
- VRAM accounts for primary weights, each enabled projector and drafter, main KV, drafter KV when applicable, image processing buffers, runtime overhead, and parallel slots. Downloaded but disabled components do not contribute.
- Calibration and benchmark identity includes the complete enabled component configuration. Main-model-only historical calibration cannot be described as exact for a component-enabled bundle.
- The first delivery remains single-resident because the current Supervisor owns one llama.cpp server process. It must not claim concurrent arbitrary main-model loads. Multi-resident bundles are a separate managed-process-pool delivery requiring one process per independently allocated bundle, explicit VRAM reservations, and no assumed cross-process weight sharing.
- Daemon/protocol additions are optional and gated through `server_info.features.*`. Existing host protocol behavior remains parse-compatible; old hosts show the upgrade boundary, with no feature fallback.

## Curated catalog commitments

- Every audited current vision-capable repository declares its optional projector with exact identity: Qwen3.6 27B MTP, Gemma 3 27B, Gemma 4 31B, Mistral Small 3.2 24B, Ornith 1.0 35B, and DeepSeek OCR 2.
- Muse Glimmer uses `unsloth/Muse-Glimmer-30B-GGUF`, primary `Muse-Glimmer-30B-UD-Q4_K_XL.gguf` (15,878,222,368 bytes), optional `mmproj-Muse-Glimmer-30B-Q8_0.gguf` (2,051,685,088 bytes), and optional `dflash-kquant.gguf` (1,631,205,312 bytes).
- Muse's b10353 minimum llama.cpp build is structural runtime compatibility, not catalog prose.
- Curated seed refresh continues to update by stable ID while retaining user-added rows; replacements remove declared retired curated IDs, including the Qwen3 Coder predecessor.

## Delivery sequence

1. Record this detailed design and compatibility boundary.
2. Add bundle schemas and safe catalog/profile migrations with focused persistence tests.
3. Implement exact component download plans, discovery/inventory, persisted selections, and coherent artifact deletion with focused tests.
4. Add component launch argv, VRAM and calibration identity tests.
5. Add capability-gated daemon/protocol/UI controls, preserving remote-host and text-only behavior.
6. Record the multi-server process-pool allocator as follow-on work unless it can be landed safely as a true independently budgeted pool.
7. Run targeted Vitest, required typechecks, npm-script lint, and formatting.

## Acceptance criteria

- Existing ordinary catalog entries and profiles are unchanged.
- Curated rows refresh, user-added rows survive, and retired curated IDs are removed.
- All audited vision models expose correct optional projectors; Muse exposes its optional projector and drafter.
- Undownloaded components cannot be enabled.
- Downloaded but disabled components affect neither argv nor budget.
- Enabled components affect launcher argv, budget, and calibration identity.
- Older clients and hosts cross the explicit feature gate, never a broken schema.
- Current dev catalog has no stale duplicate Qwen3 Coder row.

## Timeline

- time: "2026-08-11T06:54:59.270Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-bundles-are-the-unit-of-download-and-runtime-allocation"]
- time: "2026-08-11T06:54:59.270Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11. Catalog audit verified companion projector artifacts for all seven current vision-capable catalog repositories, and a DFlash drafter for Muse Glimmer."
- time: "2026-08-11T07:06:17.718Z"
  kind: "decision"
  summary: "The user supplied the detailed confirmed implementation contract and sequencing on 2026-08-11."
  source: "User direction, 2026-08-11"
- time: "2026-08-11T07:20:24.512Z"
  kind: "note"
  summary: "Bundle schema, catalog, exact downloads, component-aware inventory/profile/argv/budget, and capability-compatible protocol surface are implemented. The managed multi-process pool is intentionally sequenced as a separate charter."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T07:20:32.830Z"
  kind: "note"
  summary: "Bundle schema, catalog, exact downloads, component-aware inventory/profile/argv/budget, and capability-compatible protocol surface are implemented. The managed multi-process pool is intentionally sequenced as a separate charter."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T13:23:52.861Z"
  kind: "evidence"
  summary: "Download UX correction: the normal quant picker remains the primary control for bundles. A compact Bundle options control only chooses optional companion artifacts. The selected quant and enabled download components form one job with unified progress; bundle deletion should be offered whenever any artifact is installed and remove the complete bundle."
  source: "User feedback, 2026-08-11"
- time: "2026-08-11T17:45:33.853Z"
  kind: "evidence"
  summary: "Bundle profile settings now use the component toggle as the sole vision control for models with a component manifest. The legacy `Vision` profile field remains only for hand-scanned single-file models, avoiding two controls for the same projector state."
  source: "User feedback and implementation, 2026-08-11."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T18:00:13.992Z"
  kind: "evidence"
  summary: "Brain inventory capability badges now show image understanding for any bundle that declares a vision projector, even when that projector is not downloaded. Download readiness remains represented separately by the bundled component toggle."
  source: "User feedback and implementation, 2026-08-11."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T19:58:08.019Z"
  kind: "evidence"
  summary: "Fix verification, 2026-08-11: service-owned successful pull jobs now rescan the in-memory inventory before reporting completion. The live DeepSeek OCR 2 inventory changed from projector unavailable (0 bytes) despite a physical companion file to available (512,537,792 bytes), with `vision-projector` enabled and included in the VRAM budget. The service job runner now also reports parsed download percentage and retains actionable stderr status instead of a JSON fragment."
  source: "Live dev host verification on 2026-08-11."
  affects: ["brain-hugging-face-projector-bundle-discovery","brain-library-downloaded-models-show-bundle-state"]
- time: "2026-08-11T20:11:42.616Z"
  kind: "evidence"
  summary: "Authoritative Library quant and bundle interaction contract: (1) a selected downloaded quant shows Delete and Bundle options when a bundle exists; Delete removes both the primary quant and its bundle artifacts. (2) a selected undownloaded quant shows Download and Bundle options when a bundle exists. (3) enabling a bundle option starts its download and refreshes UI on completion. (4) disabling it deletes that bundle artifact and refreshes UI on completion. The catalog and Hugging Face discovery paths must have identical semantics, while each row renders only one Bundle options control."
  source: "User acceptance contract, 2026-08-11"
  affects: ["brain-hugging-face-projector-bundle-discovery","brain-bundle-download-progress-ring"]
- time: "2026-08-11T21:16:19.452Z"
  kind: "evidence"
  summary: "The Models tab now applies a shared normalized-artifact dedupe guard before sorting inventory rows. When duplicate representations of the same GGUF arrive during bundle enrichment or refresh, it keeps the richer projector-capable row and suppresses the duplicate. The Library's installed-artifact filter uses the same helper; its focused regression test covers case- and separator-insensitive identity."
  source: "User-reported Models-tab regression and implementation, 2026-08-11."
  affects: ["brain-library-installed-models-exclude-catalog-artifacts"]
- time: "2026-08-14T15:34:52.135Z"
  kind: "evidence"
  summary: "While a selected Brain bundle quant is downloading, enabling additional Bundle options must not interrupt or cancel the active transfer. The new artifacts join that bundle's download queue, and the Library progress ring reports byte-weighted aggregate progress across the primary quant and every queued companion artifact."
  source: "User requirement, 2026-08-14"
  affects: ["brain-bundle-download-progress-ring"]
- time: "2026-08-14T19:41:43.106Z"
  kind: "evidence"
  summary: "Remote Brain must preserve the Library's concurrent-download contract: a second model entry can start its own pull while another is active, while additional bundle components queue only behind the active transfer for that same entry. Implemented in the resident host job runner and host-job API, with focused service coverage."
  source: "User requirement and implementation, 2026-08-14"
- time: "2026-08-14T19:53:01.577Z"
  kind: "evidence"
  summary: "Bundle progress requires a known byte total. Catalog verification filled the missing projector sizes for Qwen3.8 27B (927,607,488), Gemma 4 31B (1,200,725,984), Mistral Small 3.2 24B (887,647,040), Ornith 1.0 35B (902,822,240), and DeepSeek OCR 2 (512,537,792), allowing their combined primary-plus-component download rings to report live progress."
  source: "User report and Hugging Face repository metadata, 2026-08-14"
