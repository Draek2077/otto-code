export type HighlightStyle =
  | "keyword"
  | "comment"
  | "string"
  | "number"
  | "literal"
  | "function"
  | "definition"
  | "class"
  | "type"
  | "tag"
  | "attribute"
  | "property"
  | "variable"
  | "operator"
  | "punctuation"
  | "regexp"
  | "escape"
  | "meta"
  | "heading"
  | "link";

export interface HighlightToken {
  text: string;
  style: HighlightStyle | null;
}

// Diff row background tints. Semi-transparent so they layer over the existing
// surface color instead of replacing it. Every syntax theme ships its own
// added/removed pair so diff rows are never "unthemed" -- the exact hue/alpha
// varies by theme, but it's always recognizably green (added) / red (removed).
export interface DiffBackgroundColors {
  diffAdded: string;
  diffRemoved: string;
  // Intraline emphasis pair: the same hues at a stronger alpha, for the
  // changed-span highlight layered over a diff row. Derived here rather than
  // re-alpha'd in app stylesheets — on web, Unistyles CSSVars mode hands
  // stylesheets `var(--...)` strings that string math cannot re-alpha.
  diffAddedEmphasis: string;
  diffRemovedEmphasis: string;
}
