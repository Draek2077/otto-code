/**
 * Shared domain interfaces used across discovery, decision, and runtime layers.
 * Kept dependency-free so any module can import the shapes without pulling in
 * behavior. Behavioral defaults live with the code that produces each value.
 */

export interface ModelMetadata {
  // gguf.summarize returns null (not undefined) for fields absent from a header,
  // so the numeric fields carry null; the VRAM math already guards with typeof.
  arch?: string | null;
  name?: string | null;
  basename?: string | null;
  contextLength?: number | null;
  blockCount?: number | null;
  headCount?: number | null;
  headCountKv?: number | null;
  keyLength?: number | null;
  valueLength?: number | null;
  embeddingLength?: number | null;
  /**
   * Whether the model's chat template exposes a thinking/reasoning channel
   * (a `<think>` block, `reasoning_content`, or an `enable_thinking` toggle).
   * Derived from the GGUF template in `gguf.summarize`, mirroring how LM Studio
   * flags a reasoning model - works for any local model, catalog or not.
   */
  reasoning?: boolean;
  [key: string]: unknown;
}

export interface ModelFeatures {
  mtp: boolean;
  imatrix: boolean;
  distilled: boolean;
}

export type ModelComponentRole = "vision_projector" | "speculative_drafter";

/** A catalog-declared companion artifact resolved against local disk. */
export interface ModelComponent {
  id: string;
  label: string;
  description: string;
  role: ModelComponentRole;
  path: string | null;
  bytes: number;
  required: boolean;
  defaultDownload: boolean;
  defaultLoad: boolean;
  available: boolean;
  unavailableReason?: string;
  minRuntimeBuild?: number;
}

/** A GGUF model discovered on disk (or resolvable from the download catalog). */
export interface Model {
  id: string;
  displayName: string;
  modelPath: string;
  mmprojPath: string | null;
  mmprojBytes: number;
  quant: string | null;
  sizeBytes: number;
  publisher?: string | null;
  dir?: string;
  sharded?: boolean;
  features: ModelFeatures;
  metadata: ModelMetadata | null;
  metadataError?: string | null;
  /** Which source the model was found in, for scan display. */
  origin?: "managed" | "lmstudio";
  // --- Coding-capability metadata, reconciled from the download catalog by
  // hfRepo path when a scanned file matches a CatalogModel (see
  // models/enrich.ts). Absent when the model has no catalog entry (a
  // hand-placed or LM Studio model outside the catalog). Track B1 of the brain
  // coding-capabilities work: carries useCases/tier/thinking past download so
  // discovery and routing can later see which local models are coding-tuned.
  /** Curated use-case tags from the catalog (e.g. "coding", "reasoning"). */
  useCases?: string[];
  /** Curation tier label from the catalog. */
  tier?: string;
  /** Whether the catalog marks this as a thinking/reasoning model. */
  thinking?: boolean;
  /** Per-request reasoning levels accepted by the model's OpenAI-compatible API. */
  reasoningEfforts?: string[];
  /** The catalog's advertised max context, if known. */
  contextMax?: number;
  /** Back-reference: the id of the reconciled catalog entry, if matched. */
  catalogId?: string;
  /** Back-reference: the hfRepo of the reconciled catalog entry, if matched. */
  catalogHfRepo?: string;
  /** Hosting-profile family from the catalog or normalized GGUF metadata. */
  family?: string;
  /** Present only when this catalog entry declares a component manifest. */
  components?: ModelComponent[];
}

/** A resolved llama.cpp runtime: an executable paired with its vendor DLL dir. */
export interface Runtime {
  label: string;
  /** Human-readable runtime identity, separate from the filesystem-safe label. */
  displayName?: string;
  version: string;
  dir: string;
  exe: string;
  vendorDir: string | null;
  source: "lmstudio" | "managed";
}

export interface GpuInfo {
  name: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  driver: string;
  computeCapability: string;
}
