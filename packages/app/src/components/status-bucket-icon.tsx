import type { ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import { Error, Siren, SirenQuestion } from "@/components/icons/material-icons";
import { StatusPulseGlow } from "@/components/status-pulse-glow";
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
const statusBucketThemeMapping = (theme: Theme) => ({ theme });

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
  return (
    <ThemedStatusBucketGlyph bucket={bucket} size={size} uniProps={statusBucketThemeMapping} />
  );
}

// The halo is the glyph's own colour at that moment, and both resolve from the
// same theme pass, so they can never drift apart.
function StatusBucketGlyph({
  bucket,
  size,
  theme,
}: {
  bucket: AttentionStatusBucket;
  size: number;
  theme: Theme;
}): ReactElement {
  let haloColor: string;
  let glyph: ReactElement;
  if (bucket === "needs_input") {
    haloColor = theme.colors.palette.amber[500];
    glyph = <ThemedSirenQuestion size={size} uniProps={amberColorMapping} />;
  } else if (bucket === "failed") {
    haloColor = theme.colors.palette.red[500];
    glyph = <ThemedError size={size} uniProps={redColorMapping} />;
  } else {
    haloColor = theme.colors.palette.green[500];
    glyph = <ThemedSiren size={size} uniProps={greenColorMapping} />;
  }
  return (
    <StatusPulseGlow color={haloColor} size={size}>
      {glyph}
    </StatusPulseGlow>
  );
}

const ThemedStatusBucketGlyph = withUnistyles(StatusBucketGlyph);
