import { isWeb } from "@/constants/platform";
export const COLUMN = {
  // Width is a floor only - `rankWidth()` below sizes this column to the widest
  // rank actually on screen, and both the header and the rows take that number.
  // A fixed 3-digit box on a list of nine models is 17px of slack sitting
  // between the rank and the name it numbers, and slack inside a left-aligned
  // box reads as a wider gap than the gap itself.
  rank: { width: 10, flexShrink: 0 as const },
  name: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  // Every fixed column is the wider of its value and its HEADER, plus a hair. A
  // column wider than both spends the surplus as a gap the eye reads as one; a
  // column narrower than its header wraps it ("Run/s"), which is worse than any
  // gap. So: "100.0%" and a 3-digit count at `fontSize.code` mono against
  // "Score" and "Runs" at `fontSize.xs`, and the grade's 16px medal plus a 6px
  // gap plus "Unusable" at `fontSize.sm`.
  score: { width: 48, flexShrink: 0 as const, textAlign: "right" as const },
  runs: { width: 34, flexShrink: 0 as const, textAlign: "right" as const },
  // No `textAlign` here: the grade cell is a View (medal + label), so the right
  // edge is won with `justifyContent` below and `textAlign` on the Text uses.
  grade: { width: 86, flexShrink: 0 as const },
} as const;

// `numberOfLines={1}` is not single-line truncation on web. It compiles to
// `-webkit-line-clamp`, which still WRAPS the text first - and CSS breaks lines
// at hyphens, so "gemma-4-E4B-it-Q4_K_M" clamps at a hyphen well short of the
// column edge and leaves the rest of the cell empty. Model ids are nothing but
// hyphens, so every name in this table hit it.
//
// So web truncates in CSS instead and never asks for the clamp: `nowrap` keeps
// it one line, and the ellipsis lands at the real box edge. (`display: block`
// would belong here too, but the RN style types reject it - the cell is a flex
// item, so it is blockified anyway and `text-overflow` applies.) Native has no
// line-clamp and truncates at the box edge already, so it keeps the prop.
export const SINGLE_LINE_TRUNCATE = isWeb
  ? ({ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" } as const)
  : null;

/**
 * The `numberOfLines` half of the pair above: 1 on native, where it is the only
 * way to stop a wrap, and undefined on web, where asking for it is the bug.
 *
 * Column headers take both as well. A header is a fixed label in a fixed box -
 * if it does not fit, the answer is a wider column, never a second line.
 */
export const ONE_LINE = isWeb ? undefined : 1;

// 10px, not `theme.spacing[3]` (12): there is no 10px spacing token, and the
// header and the rows have to carry the identical value or the two drift apart.
export const COLUMN_GAP = 10;

/**
 * The rank column, sized to the widest rank the list can show.
 *
 * A ranked list of nine and a ranked list of two hundred do not deserve the same
 * gutter, and a box wide enough for the second one puts a channel of dead space
 * between "1" and the model it belongs to. Ranks run 1..n, so the row count is
 * the widest value.
 *
 * It stays a single number for the whole table rather than per row: the header
 * sits outside the row scroll region, so anything that sizes to its own content
 * drifts out of line with the rows below it.
 */
export const RANK_DIGIT_WIDTH = 8; // A digit at `fontSize.code` mono, rounded up.

export function rankWidth(rowCount: number): number {
  return Math.max(COLUMN.rank.width, String(Math.max(rowCount, 1)).length * RANK_DIGIT_WIDTH);
}

// Narrower than this and a column stops earning its keep, dropped least-useful
// first. Both live on in the detail pane, so losing them from a squeezed list
// costs nothing. Widths above plus a 10px gap each, 32px of row padding, a
// two-digit rank and the name's 100px floor: everything fits in ~356px, and
// dropping Runs makes it ~312px. Re-derive these whenever a width above moves.
export const RUNS_HIDE_BELOW = 356;
export const GRADE_HIDE_BELOW = 312;

// The run list under the leaderboard. `config` is the one column that runs long
// (a spelled-out profile), so it takes the slack; `model` only appears when the
// list is not already scoped to one, and gets less room than the config it
// qualifies.
// `ran` holds "Aug 3, 09:13 PM" - 15 proportional characters at `fontSize.xs`,
// which needs ~108px. It was 92, so every row truncated a timestamp that had
// nothing optional left in it. A fixed column has to be sized for its widest
// value or the ellipsis stops being a fallback and becomes the rendering.
export const RUN_COLUMN = {
  model: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  config: { flexGrow: 2, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  ran: { width: 108, flexShrink: 0 as const, textAlign: "right" as const },
  score: { width: 56, flexShrink: 0 as const, textAlign: "right" as const },
  count: { width: 40, flexShrink: 0 as const, textAlign: "right" as const },
  spread: { width: 56, flexShrink: 0 as const, textAlign: "right" as const },
} as const;

// Same least-useful-first rule as the leaderboard. Spread goes before the run
// count because a spread with no count beside it is the less readable half, and
// both are repeated on the card the row opens. Widths above plus a 10px gap
// each, 32px of row padding and the config column's 120px floor: everything
// fits in ~452px, dropping Spread makes it ~386px, and dropping Runs ~336px.
// Re-derive these whenever a width above moves.
export const SPREAD_HIDE_BELOW = 460;
export const COUNT_HIDE_BELOW = 395;
export const RAN_HIDE_BELOW = 345;

// The delta line above the compared cards. Stated rather than inherited, and
// shared by the reserved box and the text inside it, because the two must agree
// exactly: the box is what stops the cards moving when a comparison opens, and
// it can only do that if it is the same height the text would have taken.
export const DELTA_LINE_HEIGHT = 16;

/**
 * The bench's five grades (`packages/brain/src/bench/index.ts`), best first.
 *
 * The top three take a gold, silver and bronze medal; the two below them take
 * the same medal in the muted foreground. That is deliberate - a grade is a
 * position on a fixed ladder, not a colour scale, so the failing tiers get the
 * shape without the reward rather than a red badge that reads as an error.
 */
