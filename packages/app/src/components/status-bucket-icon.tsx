import type { ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import { Error, Siren, SirenQuestion } from "@/components/icons/material-icons";
import type { Theme } from "@/styles/theme";

/**
 * The single source of truth for "this agent/workspace needs you" glyphs.
 * Every surface that renders an actionable status bucket (sidebar workspace
 * rows, the sidebar status list, workspace tabs) draws the same semantic
 * glyph from here so a given state always shows the same icon and color:
 *
 * - needs_input → siren with a question mark, amber
 * - failed      → error, red
 * - attention   → siren, green
 *
 * Running (loader) and done (empty/check) are surface-specific and stay with
 * their render sites.
 */
export type AttentionStatusBucket = "needs_input" | "failed" | "attention";

export function isAttentionStatusBucket(
  bucket: string | null | undefined,
): bucket is AttentionStatusBucket {
  return bucket === "needs_input" || bucket === "failed" || bucket === "attention";
}

const amberColorMapping = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const redColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });
const greenColorMapping = (theme: Theme) => ({ color: theme.colors.palette.green[500] });

const ThemedSirenQuestion = withUnistyles(SirenQuestion);
const ThemedError = withUnistyles(Error);
const ThemedSiren = withUnistyles(Siren);

export function StatusBucketIcon({
  bucket,
  size,
}: {
  bucket: AttentionStatusBucket;
  size: number;
}): ReactElement {
  switch (bucket) {
    case "needs_input":
      return <ThemedSirenQuestion size={size} uniProps={amberColorMapping} />;
    case "failed":
      return <ThemedError size={size} uniProps={redColorMapping} />;
    case "attention":
      return <ThemedSiren size={size} uniProps={greenColorMapping} />;
  }
}
