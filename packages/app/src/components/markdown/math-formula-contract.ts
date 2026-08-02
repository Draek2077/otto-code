import type { TextStyle } from "react-native";

/**
 * What both `MathFormula` implementations take.
 *
 * Shared so the web and native files cannot drift apart: Metro picks one of
 * them per platform, so nothing at the call site would catch a mismatch.
 */
export interface MathFormulaProps {
  /** The TeX between the delimiters, exactly as written. */
  tex: string;
  /** Block math, which sits centred on its own line rather than inline. */
  display: boolean;
  /**
   * The surrounding text style.
   *
   * Web reads the colour off it and inherits the rest through CSS. Native has to
   * hand both the colour and the size to its webview, which has no surrounding
   * document to inherit from, and styles the source with it when it falls back.
   */
  style: TextStyle;
}
