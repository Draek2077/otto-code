/**
 * Shared domain interfaces used across discovery, decision, and runtime layers.
 * Kept dependency-free so any module can import the shapes without pulling in
 * behavior. Behavioral defaults live with the code that produces each value.
 */

export interface ModelMetadata {
  // gguf.summarize returns null (not undefined) for fields absent from a header,
  // so the numeric fields carry null; the VRAM math already guards with typeof.
  arch?: string | null;
  contextLength?: number | null;
  blockCount?: number | null;
  headCount?: number | null;
  headCountKv?: number | null;
  keyLength?: number | null;
  valueLength?: number | null;
  embeddingLength?: number | null;
  [key: string]: unknown;
}

export interface ModelFeatures {
  mtp: boolean;
  imatrix: boolean;
  distilled: boolean;
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
}

/** A resolved llama.cpp runtime: an executable paired with its vendor DLL dir. */
export interface Runtime {
  label: string;
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
