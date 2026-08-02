import React, { useMemo } from "react";
import { Text } from "react-native";
import { renderToString } from "katex";
import type { MathFormulaProps } from "./math-formula-contract";

/**
 * A rendered TeX formula, on web and Electron.
 *
 * **MathML output, not KaTeX's HTML output.** The HTML mode needs
 * `katex.min.css` and a set of woff2 fonts, which would mean shipping a
 * stylesheet and font files into a React Native Web bundle that has no CSS
 * pipeline. MathML is rendered natively by every browser Otto runs in, so this
 * costs one script dependency and no styling at all, and the formula inherits
 * the surrounding text's colour and size for free.
 *
 * `dangerouslySetInnerHTML` is the same mechanism `MermaidDiagram` uses for its
 * SVG, and is safe for the same reason: the markup is produced by KaTeX from
 * the formula, never taken from the document.
 */
export function MathFormula({ tex, display, style }: MathFormulaProps) {
  const rendered = useMemo(() => {
    try {
      return renderToString(tex, {
        output: "mathml",
        displayMode: display,
        // Otto renders documents it did not write, so a malformed formula is a
        // typo in someone else's README. Throwing here is caught below and
        // falls back to the source, which is what the document already said.
        throwOnError: true,
        strict: false,
      });
    } catch {
      return null;
    }
  }, [display, tex]);

  const markup = useMemo(() => ({ __html: rendered ?? "" }), [rendered]);
  const spanStyle = useMemo(
    () => ({
      color: typeof style.color === "string" ? style.color : undefined,
      display: display ? ("block" as const) : ("inline" as const),
      textAlign: display ? ("center" as const) : undefined,
    }),
    [display, style.color],
  );

  // Unparseable TeX shows as written. Dropping it would lose content, and an
  // error message would be less useful than the formula the author typed.
  if (rendered === null) {
    return (
      <Text selectable style={style}>
        {tex}
      </Text>
    );
  }
  return <span style={spanStyle} dangerouslySetInnerHTML={markup} />;
}
