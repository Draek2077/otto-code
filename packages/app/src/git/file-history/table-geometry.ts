/**
 * Column widths for the history and blame tables.
 *
 * They live here, as numbers, because the header row and the data rows are
 * separate components: the header must not scroll away with the rows, so it
 * cannot be a row of the same list, and the moment the two carry their own
 * widths they drift and the table stops being a table. One import, one source
 * of truth, alignment guaranteed.
 *
 * Widths are fixed rather than flexed for the same reason — a fixed column
 * holds its edge as content changes, so the eye can run straight down it. Only
 * the message/summary column flexes, because it is the one that should absorb
 * the remaining space.
 */

/** Abbreviated object name, monospace. Fits git's 7–8 char short sha plus air. */
export const COLUMN_WIDTH_SHA = 84;
/** Relative date ("3d ago") — tabular numerals, so it never twitches. */
export const COLUMN_WIDTH_DATE = 108;
/** Author name, ellipsized. Wide enough for "Firstname Lastname". */
export const COLUMN_WIDTH_AUTHOR = 148;
/**
 * Row height. Fixed so rows tile predictably and the table reads as a grid
 * rather than as a stack of paragraphs.
 */
export const TABLE_ROW_HEIGHT = 26;
export const TABLE_HEADER_HEIGHT = 24;
/**
 * How much the table's fixed heights grow on compact form factors, passed to
 * `compactUp`. Text there is two points larger and a row is a touch target, so
 * the desktop heights would clip the one and be too small for the other. Not the
 * default 2x: these are text rows, not icon chrome, and doubling them would turn
 * a scannable table into a list of bands.
 *
 * Shared with the diff pane's header, which is deliberately the same height as
 * this table's header so the two panes' first rows line up across the splitter.
 */
export const TABLE_COMPACT_SCALE = 1.5;
