export const COLUMN = {
  // A dragged 25% list pane still keeps the model and score. The name gives
  // up its formerly cosmetic 140px floor and truncates instead of forcing the
  // score off the edge.
  name: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  score: { width: 44, flexShrink: 0 as const, textAlign: "right" as const },
  quant: { width: 52, flexShrink: 0 as const, textAlign: "right" as const },
  size: { width: 58, flexShrink: 0 as const, textAlign: "right" as const },
  tags: { width: 44, flexShrink: 0 as const, textAlign: "right" as const },
} as const;
