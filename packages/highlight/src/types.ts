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

// Diff colors. Row tints are semi-transparent so they layer over the existing
// surface color instead of replacing it. Every syntax theme ships its own
// added/removed pair so diff rows are never "unthemed" -- the exact hue/alpha
// varies by theme, but it's always recognizably green (added) / red (removed).
export interface DiffBackgroundColors {
  diffAdded: string;
  diffRemoved: string;
  // Palette-owned foregrounds for added and removed coordinates, markers, and
  // compact diff text. These stay independent of app status colors so the
  // active syntax theme owns the complete diff language.
  diffAddedForeground: string;
  diffRemovedForeground: string;
  // Intraline emphasis pair: the same hues at a stronger alpha, for the
  // changed-span highlight layered over a diff row. Derived here rather than
  // re-alpha'd in app stylesheets - on web, Unistyles CSSVars mode hands
  // stylesheets `var(--...)` strings that string math cannot re-alpha.
  diffAddedEmphasis: string;
  diffRemovedEmphasis: string;
  // A theme-owned background for whitespace-only changes. It is deliberately
  // neither the added nor removed tint because formatting did not add or
  // remove meaning.
  diffFormatting: string;
  // A theme-owned foreground color for code that is still the same code but
  // moved, reordered, or compactly renamed. It must not borrow an app status
  // color: syntax themes are selected independently from the app chrome.
  diffMoved: string;
}
