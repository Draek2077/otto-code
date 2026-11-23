// Which vertical rails keep running below a tree row, packed into a single number.
//
// A tree row renders one rail column per ancestor level. Whether a given column
// draws a full-height rail, a half-height "last child" rail (└), or nothing at all
// depends on sibling position - which a FLATTENED row list has otherwise thrown away.
//
// Callers thread this mask down while they build their rows. It is deliberately a
// number rather than a boolean[]: the row lists are virtualized and their row
// components are memoized, so a fresh array identity per row would defeat both
// `React.memo` and the `useMemo` inside `TreeIndentGuides`.
//
// Bit `k` set = the node at depth `k` on this row's path (the row itself when
// `k === depth`) has a sibling after it, so its rail keeps running below this row.
// Bit 0 is unused - depth-0 rows draw no rails.

/** Every rail runs full height - the look before last-child detection existed. */
export const TREE_RAILS_ALL_CONTINUE = -1;

// Past this the bit would fall off a 32-bit int; such rows just keep full rails.
const MAX_TRACKED_DEPTH = 30;

/** Fold a row's own sibling position into the mask it inherited from its parent. */
export function withTreeRail(mask: number, depth: number, hasNextSibling: boolean): number {
  if (depth < 1 || depth > MAX_TRACKED_DEPTH) {
    return mask;
  }
  const bit = 1 << depth;
  return hasNextSibling ? mask | bit : mask & ~bit;
}

/** Does the rail belonging to depth `depth` keep running below this row? */
export function treeRailContinuesAt(mask: number, depth: number): boolean {
  if (depth < 1 || depth > MAX_TRACKED_DEPTH) {
    return true;
  }
  return (mask & (1 << depth)) !== 0;
}
