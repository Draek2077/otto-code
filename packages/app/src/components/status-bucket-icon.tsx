import type { ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import {
  CircleAlertFilled,
  CircleHelpFilled,
  CircleNotificationsFilled,
} from "@/components/icons/material-icons";
import type { Theme } from "@/styles/theme";

/**
 * The single source of truth for "this agent/workspace needs you" glyphs.
 * Every surface that renders an actionable status bucket (sidebar workspace
 * rows, the sidebar status list, workspace tabs) draws the same filled-circle
 * badge from here so a given state always shows the same icon and color:
 *
 * - needs_input → question mark, amber
 * - failed      → exclamation mark, red
 * - attention   → bell, green
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

const ThemedCircleHelpFilled = withUnistyles(CircleHelpFilled);
const ThemedCircleAlertFilled = withUnistyles(CircleAlertFilled);
const ThemedCircleNotificationsFilled = withUnistyles(CircleNotificationsFilled);

export function StatusBucketIcon({
  bucket,
  size,
}: {
  bucket: AttentionStatusBucket;
  size: number;
}): ReactElement {
  switch (bucket) {
    case "needs_input":
      return <ThemedCircleHelpFilled size={size} uniProps={amberColorMapping} />;
    case "failed":
      return <ThemedCircleAlertFilled size={size} uniProps={redColorMapping} />;
    case "attention":
      return <ThemedCircleNotificationsFilled size={size} uniProps={greenColorMapping} />;
  }
}
