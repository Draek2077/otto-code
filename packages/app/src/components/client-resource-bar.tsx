import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useResourceSnapshot } from "@/diagnostics/resource-report/use-resource-snapshot";
import { useIsCompactFormFactor } from "@/constants/layout";
import { resolveResourceBarLayout } from "@/components/client-resource-bar.layout";
import { compactUp, SPACING } from "@/styles/theme";

// A dense readout of everything the resource monitor currently knows, pinned to
// the bottom of the Metrics screen or the whole app according to Settings.
// Grouped left-to-right by what it answers:
// how smooth is it, how much is retained, how loud is the daemon connection -
// and finally what is growing fastest, which is the one field that turns the
// strip from a gauge into a lead.
//
// It scrolls horizontally in its own container rather than wrapping: the value
// order is the diagnosis order, and reflowing it into ragged rows at narrow
// widths would scramble that. Scrolling is the floor, not the plan - the strip
// first shortens its labels and then sheds its least diagnostic groups so that a
// narrow window still shows a readable gauge rather than a scrollable one. See
// `client-resource-bar.layout.ts` for the rules and the drop order.

export function ClientResourceBar(): ReactElement | null {
  const { latest, elapsedMs, samples, topGrowth, running } = useResourceSnapshot();
  const isCompact = useIsCompactFormFactor();
  // Measured on the bar itself, so the strip reacts to the window rather than to
  // a breakpoint: a half-width desktop window gets the same treatment a small one
  // does. Padding is subtracted here because the layout estimate is content-only.
  const [barWidth, setBarWidth] = useState(0);
  const handleBarLayout = useCallback(
    (event: LayoutChangeEvent) => setBarWidth(event.nativeEvent.layout.width),
    [],
  );
  const horizontalPadding = (isCompact ? SPACING[3] : SPACING[6]) * 2;
  const layout = useMemo(
    () =>
      resolveResourceBarLayout({
        availableWidth: barWidth > 0 ? barWidth - horizontalPadding : 0,
        isCompact,
      }),
    [barWidth, horizontalPadding, isCompact],
  );

  if (!running && samples === 0) {
    return (
      <View style={styles.bar}>
        <Text style={styles.offText}>
          Performance monitoring is off. Enable it in Settings › Diagnostics to record frame timing,
          retained state and daemon traffic.
        </Text>
      </View>
    );
  }

  if (!latest) {
    return (
      <View style={styles.bar}>
        <Text style={styles.offText}>Collecting the first resource sample…</Text>
      </View>
    );
  }

  // Every reading the strip can show, keyed by field id. Built whole regardless
  // of what the current width keeps: the formatters are cheap, and building only
  // the surviving subset would put a width check in front of each metric read.
  const values: Record<string, string> = {
    fps: formatNumber(latest.metrics["frames.fps"], 1),
    p95: formatMs(latest.metrics["frames.p95FrameMs"]),
    worst: formatMs(latest.metrics["frames.worstFrameMs"]),
    longFrames: formatNumber(latest.metrics["frames.longFrames"], 0),
    heap: formatBytes(latest.metrics["heap.usedBytes"]),
    domNodes: formatCount(latest.metrics["dom.nodes"]),
    queries: formatCount(latest.metrics["query.queries"]),
    unobserved: formatCount(latest.metrics["query.unobserved"]),
    observers: formatCount(latest.metrics["query.observers"]),
    intervals: formatCount(latest.metrics["runtime.liveIntervals"]),
    timeouts: formatCount(latest.metrics["runtime.pendingTimeouts"]),
    messages: formatCount(latest.metrics["traffic.messages"]),
    bytes: formatBytes(latest.metrics["traffic.bytes"]),
    handler: formatSeconds(latest.metrics["traffic.handlerMs"]),
    ofSession: formatShare(latest.metrics["traffic.handlerMs"], latest.uptimeMs),
    streamItems: formatCount(latest.metrics["store.session.sessions.*.agentStreamTail.*.length"]),
    agents: formatCount(latest.metrics["store.session.sessions.*.agents.size"]),
    workspaces: formatCount(latest.metrics["store.session.sessions.*.workspaces.size"]),
    observed: formatDuration(elapsedMs),
    samples: String(samples),
    growth: topGrowth
      ? `${shortKey(topGrowth.key)} +${formatGrowth(topGrowth.slopePerHour)}/h`
      : "none",
  };

  const isShort = layout.labelMode === "short";

  return (
    <View style={styles.bar} onLayout={handleBarLayout}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {layout.groups.map((group, index) => (
          <View key={group.id} style={styles.group}>
            {index > 0 && <View style={styles.divider} />}
            <View style={styles.groupInner}>
              <Text style={styles.groupTitle}>{isShort ? group.shortTitle : group.title}</Text>
              <View style={styles.fields}>
                {group.fields.map((field) => {
                  const value = values[field.id] ?? MISSING_VALUE;
                  return (
                    <View key={field.id} style={styles.field}>
                      <Text style={styles.fieldLabel}>{isShort ? field.short : field.label}</Text>
                      <Text
                        style={value === MISSING_VALUE ? styles.fieldValueMuted : styles.fieldValue}
                      >
                        {value}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// What a reading that this platform cannot supply renders as. Compared against
// (not just printed) so those cells render muted - a dash in the same weight as a
// real number reads as a value.
const MISSING_VALUE = "-";

function formatNumber(value: number | undefined, digits: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING_VALUE;
  return value.toFixed(digits);
}

function formatCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING_VALUE;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING_VALUE;
  return `${value.toFixed(1)}ms`;
}

function formatSeconds(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING_VALUE;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatShare(part: number | undefined, whole: number): string {
  if (typeof part !== "number" || !Number.isFinite(part) || whole <= 0) return MISSING_VALUE;
  return `${((part / whole) * 100).toFixed(2)}%`;
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING_VALUE;
  const units = ["B", "KB", "MB", "GB"];
  let scaled = value;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return `${scaled.toFixed(unitIndex === 0 ? 0 : 1)}${units[unitIndex]}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatGrowth(value: number): string {
  if (!Number.isFinite(value)) return MISSING_VALUE;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(value < 10 ? 1 : 0);
}

/** Metric paths are long by design; the strip only has room for the tail. */
function shortKey(key: string): string {
  const parts = key.split(".").filter((part) => part !== "*");
  return parts.slice(-2).join(".");
}

// The strip is the bottom-most band of the app chrome, so it reads as a peer of
// the sidebar's icon row rather than a taller slab under it: same height, to the
// pixel. That row is a `spacing[8]` button box (1.5x on compact) inside
// `spacing[3]` vertical padding, over a 1px rule - see `left-sidebar`'s
// `sidebarFooter` and `sidebar-footer-nav`'s `footerIconButton`.
//
// Applied as a floor, not a fixed height: the readout is three text lines deep
// and a user who scales fonts up in Settings should get a taller bar, not a
// clipped one. At default sizes the content lands under the floor, so the two
// bands match.
const FOOTER_BAND_HEIGHT = ((): Record<"xs" | "sm" | "md" | "lg" | "xl", number> => {
  const button = compactUp(SPACING[8], 1.5);
  const chrome = SPACING[3] * 2 + 1;
  return {
    xs: button.xs + chrome,
    sm: button.sm + chrome,
    md: button.md + chrome,
    lg: button.lg + chrome,
    xl: button.xl + chrome,
  };
})();

const styles = StyleSheet.create((theme) => ({
  bar: {
    minHeight: FOOTER_BAND_HEIGHT,
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[1],
  },
  group: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  groupInner: {
    gap: 2,
    justifyContent: "center",
  },
  divider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: theme.colors.border,
    marginHorizontal: theme.spacing[4],
  },
  // Line heights are pinned tight (and derived from the live font size, which
  // `applyAppearance` patches) so three stacked lines clear the band floor.
  groupTitle: {
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs + 2,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  fields: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  field: {
    gap: 0,
  },
  fieldLabel: {
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs + 2,
    color: theme.colors.foregroundMuted,
  },
  // Numbers line up column-to-column only in the mono face, and this strip is
  // read by scanning down the values.
  fieldValue: {
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code + 3,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foreground,
  },
  fieldValueMuted: {
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code + 3,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  offText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[2],
  },
}));
