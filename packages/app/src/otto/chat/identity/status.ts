import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
export type AttentionBucket = Extract<SidebarStateBucket, "needs_input" | "failed" | "attention">;
export function isAttentionBucket(bucket: string | null | undefined): bucket is AttentionBucket {
  return bucket === "needs_input" || bucket === "failed" || bucket === "attention";
}
const GLYPHS = { needs_input: "SirenQuestion", failed: "Error", attention: "Siren" } as const;
export function statusGlyph(bucket: AttentionBucket) {
  return GLYPHS[bucket];
}
// Exact notify colors used by the released status-bucket glyphs.
export function statusGlyphColor(bucket: AttentionBucket): string {
  return { needs_input: "#f59e0b", failed: "#ef4444", attention: "#22c55e" }[bucket];
}
export function statusLabel(bucket: AttentionBucket): string {
  return { needs_input: "Needs input", failed: "Error", attention: "Needs attention" }[bucket];
}
