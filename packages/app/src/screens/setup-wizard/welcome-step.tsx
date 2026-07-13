/**
 * WelcomeStep — the setup wizard's animated brand cover, the first thing a
 * user sees on their first host connection (first-time-wizard charter,
 * "Brand bookends").
 *
 * Renders WizardBrandBackdrop with the hero cluster — the Otto glyph and the
 * live BlobLoader plasma ring, composed like the marketing feature graphic —
 * plus a headline, subtitle, and the primary "Start" button.
 *
 * Motion: the glyph fades in with a slight rise, holds, then winks once — a
 * crossfade OttoLogo → OttoLogoWink → OttoLogo (~180ms each way), two glyph
 * layers stacked absolutely. The entry/wink use reanimated's default
 * ReduceMotion.System, so under prefers-reduced-motion they collapse to a
 * plain appear (the charter's reduced-motion fallback). BlobLoader is never
 * gated on reduce-motion — it hard-codes ReduceMotion.Never itself.
 *
 * Layout: mobile-first. On compact form factors the hero stacks in a column
 * (glyph above ring) and type bumps +2px per the app's compact conventions;
 * on desktop the cluster is a row (glyph left, ring right) like the feature
 * graphic. The content respects safe-area insets and the action buttons are
 * full-width within a capped column (≥44px tap targets via Button's own
 * compact geometry).
 *
 * API (presentational only — no routing, no persistence):
 *   <WelcomeStep onStart={advanceToModeStep} onSkip={skipWizard} />
 *
 *   - onStart: () => void  — called when "Start" is pressed (required).
 *   - onSkip?: () => void  — optional; renders a ghost "Skip setup" button
 *     when provided. The wizard shell owns what skipping means.
 *
 * Per the unistyles gotcha (docs/unistyles.md): every Animated.View node uses
 * plain RN StyleSheet styles; unistyles styles only touch static nodes.
 */

import { useEffect, useMemo } from "react";
import { StyleSheet as RNStyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlobLoader } from "@/components/blob-loader";
import { OttoLogo, OttoLogoWink } from "@/components/icons/otto-logo";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { WizardBrandBackdrop } from "./wizard-brand-backdrop";

interface WelcomeStepProps {
  onStart: () => void;
  onSkip?: () => void;
}

// Hero sizing. The glyph sits ON TOP of the ring (the ring is the halo behind
// it). The ring is sized to frame the visible mark (the 512-unit viewBox
// carries big empty margins, so the mark is smaller than the box). Both center
// on the same point — see the hero stack in the JSX. The ring size is the
// visible ring diameter basis regardless of blur — BlobLoader keeps the bloom
// inside its own over-scanned canvas — so these need no blur compensation.
const GLYPH_SIZE_WIDE = 250;
const GLYPH_SIZE_COMPACT = 200;
const RING_SIZE_WIDE = 300;
const RING_SIZE_COMPACT = 225;

// Gaussian bloom on the plasma ring — the "black hole" halo behind the glyph.
// stdDeviation in the ring's 0..100 viewBox space (resolution-independent, so
// it reads the same at both ring sizes). Bumped to 5 for a softer, wider bloom
// now that the ring glows behind the logo. Tuned 2026-07-12.
const RING_BLUR = 7;

// Entry: fade + slight rise. Then hold, then one wink.
const ENTRY_MS = 600;
const ENTRY_RISE_PX = 16;
const WINK_DELAY_AFTER_ENTRY_MS = 800;
const WINK_FADE_MS = 250;
const WINK_HOLD_MS = 200;

// Plain RN styles for reanimated nodes — never unistyles on an Animated.View
// (docs/unistyles.md, "Reanimated Animated.View + Dynamic Styles Crashes").
const glyphStyles = RNStyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});

/**
 * The winking glyph: fades/rises in, then crossfades OttoLogo → OttoLogoWink
 * → OttoLogo once. Both faces are stacked absolutely so only opacity moves.
 * No explicit `color` — the glyphs use their themed foreground mapping, so the
 * mark is dark on a light field and light on a dark field.
 */
function WinkingGlyph({ size }: { size: number }) {
  const entry = useSharedValue(0);
  const wink = useSharedValue(0);

  useEffect(() => {
    entry.value = 0;
    entry.value = withTiming(1, {
      duration: ENTRY_MS,
      easing: Easing.out(Easing.cubic),
    });

    wink.value = 0;
    wink.value = withDelay(
      ENTRY_MS + WINK_DELAY_AFTER_ENTRY_MS,
      withSequence(
        withTiming(1, { duration: WINK_FADE_MS, easing: Easing.inOut(Easing.quad) }),
        withDelay(
          WINK_HOLD_MS,
          withTiming(0, { duration: WINK_FADE_MS, easing: Easing.inOut(Easing.quad) }),
        ),
      ),
    );

    return () => {
      cancelAnimation(entry);
      cancelAnimation(wink);
    };
  }, [entry, wink]);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: entry.value,
    transform: [{ translateY: (1 - entry.value) * ENTRY_RISE_PX }],
  }));

  const neutralAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - wink.value,
  }));

  const winkAnimatedStyle = useAnimatedStyle(() => ({
    opacity: wink.value,
  }));

  const containerStyle = useMemo(
    () => [{ width: size, height: size }, containerAnimatedStyle],
    [size, containerAnimatedStyle],
  );
  const neutralLayerStyle = useMemo(
    () => [glyphStyles.layer, neutralAnimatedStyle],
    [neutralAnimatedStyle],
  );
  const winkLayerStyle = useMemo(() => [glyphStyles.layer, winkAnimatedStyle], [winkAnimatedStyle]);

  return (
    <Animated.View style={containerStyle}>
      <Animated.View style={neutralLayerStyle}>
        <OttoLogo size={size} />
      </Animated.View>
      <Animated.View style={winkLayerStyle}>
        <OttoLogoWink size={size} />
      </Animated.View>
    </Animated.View>
  );
}

export function WelcomeStep({ onStart, onSkip }: WelcomeStepProps) {
  const isCompact = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();

  const glyphSize = isCompact ? GLYPH_SIZE_COMPACT : GLYPH_SIZE_WIDE;
  const ringSize = isCompact ? RING_SIZE_COMPACT : RING_SIZE_WIDE;
  // The stack box is the larger of the two so both layers center on one point.
  const heroSize = Math.max(glyphSize, ringSize);

  // Status-bar/safe-area offset (docs/floating-panels.md). Insets change at
  // most on rotation, so the inline pixel values are not a web-CSS-registry
  // churn concern (docs/unistyles.md).
  const containerStyle = useMemo(
    () => [styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.top, insets.bottom],
  );

  const heroBoxStyle = useMemo(
    () => [styles.hero, { width: heroSize, height: heroSize }],
    [heroSize],
  );

  return (
    <WizardBrandBackdrop>
      <View style={containerStyle}>
        <View style={heroBoxStyle}>
          {/* Plasma ring halo, centered behind the glyph. */}
          <View style={styles.heroRingLayer} pointerEvents="none">
            <BlobLoader size={ringSize} blur={RING_BLUR} wobble={false} />
          </View>
          <View style={styles.heroGlyphLayer}>
            <WinkingGlyph size={glyphSize} />
          </View>
        </View>

        <View style={styles.copy}>
          {/* TODO(i18n): extract — wizard strings are owned by the i18n pass. */}
          <Text accessibilityRole="header" style={styles.headline}>
            Welcome to Otto
          </Text>
          <Text style={styles.subtitle}>
            An agentic coding assistant with personality, for every model, cloud or local.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button variant="default" size="lg" onPress={onStart}>
            {/* TODO(i18n): extract */}
            Start
          </Button>
          {onSkip ? (
            <Button variant="ghost" size="md" onPress={onSkip}>
              {/* TODO(i18n): extract */}
              Skip setup
            </Button>
          ) : null}
        </View>
      </View>
    </WizardBrandBackdrop>
  );
}

// Layout/type. Colors are theme tokens so the cover inverts with the app
// theme; the breakpoint records carry the compact +2px font convention
// (xs/sm = compact). The CTA and ghost buttons use Button's own themed
// variants (accent fill / muted ghost) — no per-button color overrides.
const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    maxWidth: 720,
    alignItems: "center",
    paddingHorizontal: {
      xs: 24,
      md: 32,
    },
  },
  hero: {
    alignItems: "center",
    justifyContent: "center",
  },
  // Both hero layers fill the stack box and center their child; explicit
  // zIndex keeps the glyph above the ring on web (positioned siblings would
  // otherwise paint in DOM order regardless of nesting).
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
    gap: 10,
    marginTop: {
      xs: 28,
      md: 36,
    },
  },
  headline: {
    color: theme.colors.foreground,
    fontSize: {
      xs: 30,
      md: 34,
    },
    lineHeight: {
      xs: 38,
      md: 42,
    },
    fontWeight: "600",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: 18,
      md: 16,
    },
    lineHeight: {
      xs: 26,
      md: 24,
    },
    letterSpacing: 0.2,
    textAlign: "center",
  },
  actions: {
    width: "100%",
    maxWidth: 340,
    alignItems: "stretch",
    gap: 12,
    marginTop: {
      xs: 32,
      md: 40,
    },
  },
}));
