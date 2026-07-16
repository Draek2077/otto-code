/**
 * DoneStep — the wizard's closing bookend. Mirrors the Welcome cover (same
 * WizardBrandBackdrop + blurred plasma ring), shows a short summary of what was
 * set up, and a single "Get started" button that marks the wizard complete and
 * goes home (the shell owns that on the callback).
 *
 * Presentational only — `onFinish` is wired by the shell.
 * TODO(i18n): inline English, translated in a later pass.
 */

import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { InterfaceMode } from "@/hooks/use-settings";
import { BlobLoader } from "@/components/blob-loader";
import { OttoLogo } from "@/components/icons/otto-logo";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor, useIsExtraCompactFormFactor } from "@/constants/layout";
import { WizardBrandBackdrop } from "./wizard-brand-backdrop";

// Same bloom as the welcome ring, for a matching bookend (see welcome-step).
const RING_BLUR = 2.0;

interface DoneStepProps {
  interfaceMode: InterfaceMode;
  primaryProviderLabel: string | null;
  rosterCount: number;
  activeTeamName: string | null;
  onFinish: () => void;
}

export function DoneStep({
  interfaceMode,
  primaryProviderLabel,
  rosterCount,
  activeTeamName,
  onFinish,
}: DoneStepProps) {
  const isCompact = useIsCompactFormFactor();
  const isExtraCompact = useIsExtraCompactFormFactor();
  const insets = useSafeAreaInsets();

  const sizeForFormFactor = (extraCompact: number, compact: number, wide: number) => {
    if (isExtraCompact) return extraCompact;
    if (isCompact) return compact;
    return wide;
  };
  const glyphSize = sizeForFormFactor(72, 92, 108);
  const ringSize = sizeForFormFactor(110, 132, 150);
  // Stack box is the larger layer so ring + glyph center on one point.
  const heroSize = Math.max(glyphSize, ringSize);

  const containerStyle = useMemo(
    () => [styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.top, insets.bottom],
  );

  const heroBoxStyle = useMemo(
    () => [styles.hero, { width: heroSize, height: heroSize }],
    [heroSize],
  );

  const summary = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [
      { label: "Interface mode", value: interfaceMode === "user" ? "User" : "Developer" },
    ];
    if (primaryProviderLabel) {
      rows.push({ label: "Provider", value: primaryProviderLabel });
    }
    if (rosterCount > 0) {
      rows.push({
        label: "Agents",
        value: rosterCount === 1 ? "1 agent" : `${rosterCount} agents`,
      });
    }
    if (activeTeamName) {
      rows.push({ label: "Active team", value: activeTeamName });
    }
    return rows;
  }, [interfaceMode, primaryProviderLabel, rosterCount, activeTeamName]);

  return (
    <WizardBrandBackdrop>
      <View style={containerStyle}>
        <View style={heroBoxStyle}>
          {/* Plasma ring halo, centered behind the glyph. */}
          <View style={styles.heroRingLayer} pointerEvents="none">
            <BlobLoader size={ringSize} blur={RING_BLUR} wobble={false} />
          </View>
          <View style={styles.heroGlyphLayer}>
            <OttoLogo size={glyphSize} />
          </View>
        </View>

        <View style={styles.copy}>
          {/* TODO(i18n): extract */}
          <Text accessibilityRole="header" style={styles.headline}>
            You&rsquo;re all set
          </Text>
          <Text style={styles.subtitle}>Otto is ready. Here&rsquo;s what we set up:</Text>
        </View>

        <View style={styles.summary}>
          {summary.map((row) => (
            <View key={row.label} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{row.label}</Text>
              <Text style={styles.summaryValue}>{row.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Button variant="default" size="lg" onPress={onFinish}>
            {/* TODO(i18n): extract */}
            Get started
          </Button>
        </View>
      </View>
    </WizardBrandBackdrop>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    maxWidth: 520,
    alignItems: "center",
    paddingHorizontal: { xs: 24, md: 32 },
  },
  hero: {
    alignItems: "center",
    justifyContent: "center",
  },
  // Both layers fill the stack box and center their child; explicit zIndex
  // keeps the glyph above the ring on web (positioned siblings otherwise paint
  // in DOM order regardless of nesting).
  heroRingLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 0,
  },
  heroGlyphLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  copy: {
    alignItems: "center",
    gap: 8,
    marginTop: { xs: 22, md: 28 },
  },
  headline: {
    color: theme.colors.foreground,
    fontSize: { xs: 28, md: 32 },
    lineHeight: { xs: 34, md: 38 },
    fontWeight: "600",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: 16, md: 15 },
    textAlign: "center",
  },
  summary: {
    width: "100%",
    maxWidth: 340,
    marginTop: { xs: 24, md: 28 },
    gap: 8,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  summaryLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: { xs: 15, md: 14 },
  },
  summaryValue: {
    color: theme.colors.foreground,
    fontSize: { xs: 15, md: 14 },
    fontWeight: "600",
  },
  actions: {
    width: "100%",
    maxWidth: 340,
    alignItems: "stretch",
    gap: 10,
    marginTop: { xs: 30, md: 36 },
  },
}));
