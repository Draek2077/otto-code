import React from "react";
import { Text } from "react-native";
import type { MathFormulaProps } from "./math-formula-contract";

/**
 * A TeX formula on native, shown as its source.
 *
 * **This is a known gap, not an oversight.** KaTeX's only outputs are HTML and
 * MathML, and React Native renders neither: laying out a formula on native
 * means a WebView carrying a bundled KaTeX, which is the pattern
 * `mermaid-diagram.native.tsx` already established and which this should follow
 * when it is built. Until then the TeX is shown as written, in the code style,
 * which is what the document already contained and is legible to anyone who
 * writes maths in markdown.
 *
 * Deliberately not silent: dropping the formula, or rendering an error, would
 * both be worse than showing the source.
 */
export function MathFormula({ tex, display, style }: MathFormulaProps) {
  return (
    <Text selectable style={style}>
      {display ? tex : tex.trim()}
    </Text>
  );
}
