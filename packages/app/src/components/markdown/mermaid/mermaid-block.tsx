import { useCallback } from "react";
import { Text, View, type TextStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import type { Theme } from "@/styles/theme";
import type { MermaidThemeConfig } from "./mermaid-contract";
import { MermaidDiagram } from "./mermaid-diagram";
import { buildMermaidThemeConfig } from "./mermaid-theme";

// Surface-facing wrapper: what a ```mermaid fence renders as. Platform
// differences stop at MermaidDiagram; everything about how a diagram degrades
// lives here, once, for chat + the file viewer + the pull-request panel.

interface MermaidBlockOwnProps {
  code: string;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
}

interface MermaidBlockInnerProps extends MermaidBlockOwnProps {
  /** Supplied by the withUnistyles mapping below, not by callers. */
  theme: MermaidThemeConfig;
}

function MermaidBlockInner({ code, inheritedStyles, textStyle, theme }: MermaidBlockInnerProps) {
  // A diagram that cannot be drawn falls back to the thing it was written as.
  // Never an empty box, and never raw markup — the same policy the HTML
  // translation follows (docs/markdown-rendering.md).
  const renderFallback = useCallback(
    (error: string | null) => (
      <View>
        <HighlightedCodeBlock
          code={code}
          language="mermaid"
          inheritedStyles={inheritedStyles}
          textStyle={textStyle}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    ),
    [code, inheritedStyles, textStyle],
  );

  return <MermaidDiagram code={code} theme={theme} renderFallback={renderFallback} />;
}

const ThemedMermaidBlock = withUnistyles(MermaidBlockInner);

function mermaidThemeMapping(theme: Theme): Partial<MermaidBlockInnerProps> {
  return { theme: buildMermaidThemeConfig(theme) };
}

export function MermaidBlock(props: MermaidBlockOwnProps) {
  return <ThemedMermaidBlock {...props} uniProps={mermaidThemeMapping} />;
}

const styles = StyleSheet.create((theme) => ({
  errorText: {
    marginTop: -theme.spacing[2],
    marginBottom: theme.spacing[3],
    color: theme.colors.statusWarningStrong,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
}));
