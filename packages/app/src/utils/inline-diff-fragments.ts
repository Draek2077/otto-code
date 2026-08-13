export type InlineDiffFragmentKind = "shared" | "removed" | "added" | "replacement-added";

export interface InlineDiffFragment {
  kind: InlineDiffFragmentKind;
  text: string;
}

interface DiffSegmentLike {
  text: string;
  changed: boolean;
}

function leadingWhitespace(value: string): string {
  return value.match(/^\s*/)?.[0] ?? "";
}

function appendFragment(
  fragments: InlineDiffFragment[],
  fragment: InlineDiffFragment,
): InlineDiffFragment[] {
  const previous = fragments.at(-1);
  if (previous?.kind === fragment.kind) {
    previous.text += fragment.text;
  } else if (fragment.text) {
    fragments.push(fragment);
  }
  return fragments;
}

function appendChangedSegmentFragments(
  fragments: InlineDiffFragment[],
  before: string,
  after: string,
): void {
  const changedFragments = buildInlineDiffFragments(before, after);
  const isReplacement = changedFragments.some((fragment) => fragment.kind === "removed");
  for (const fragment of changedFragments) {
    const kind = fragment.kind === "added" && isReplacement ? "replacement-added" : fragment.kind;
    appendFragment(fragments, { ...fragment, kind });
  }
}

function markReplacementAdditions(fragments: readonly InlineDiffFragment[]): InlineDiffFragment[] {
  const isReplacement = fragments.some((fragment) => fragment.kind === "removed");
  return fragments.map((fragment) =>
    fragment.kind === "added" && isReplacement
      ? { ...fragment, kind: "replacement-added" as const }
      : fragment,
  );
}

function spansForSide(fragments: readonly InlineDiffFragment[], side: "before" | "after"): string {
  return fragments
    .filter((fragment) =>
      side === "before"
        ? fragment.kind !== "added" && fragment.kind !== "replacement-added"
        : fragment.kind !== "removed",
    )
    .map((fragment) => fragment.text)
    .join("");
}

function preservesSourcePair(
  fragments: readonly InlineDiffFragment[],
  before: string,
  after: string,
): boolean {
  return spansForSide(fragments, "before") === before && spansForSide(fragments, "after") === after;
}

function commonPrefixLength(before: string, after: string): number {
  let index = 0;
  while (index < before.length && index < after.length && before[index] === after[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(before: string, after: string, prefixLength: number): number {
  let length = 0;
  while (
    length < before.length - prefixLength &&
    length < after.length - prefixLength &&
    before[before.length - length - 1] === after[after.length - length - 1]
  ) {
    length += 1;
  }
  return length;
}

/**
 * The compact replacement seam. It keeps literal common prefix/suffix text
 * unstyled, leaving only the smallest changed character span for the chosen
 * purple or explicit old/new presentation.
 */
export function buildInlineDiffFragments(before: string, after: string): InlineDiffFragment[] {
  const prefixLength = commonPrefixLength(before, after);
  const suffixLength = commonSuffixLength(before, after, prefixLength);
  // `commonSuffixLength` never overlaps the prefix, so both end offsets are at
  // or after `prefixLength`. A zero end offset means "nothing changed on this
  // side" and must stay zero: coercing it to `undefined` sliced to the end of
  // the string and emitted the whole line twice for a pure prefix insertion.
  const beforeChanged = before.slice(prefixLength, before.length - suffixLength);
  const afterChanged = after.slice(prefixLength, after.length - suffixLength);
  const fragments: InlineDiffFragment[] = [];
  const prefix = before.slice(0, prefixLength);
  const suffix = suffixLength === 0 ? "" : before.slice(before.length - suffixLength);
  if (prefix) fragments.push({ kind: "shared", text: prefix });
  if (beforeChanged) fragments.push({ kind: "removed", text: beforeChanged });
  if (afterChanged) fragments.push({ kind: "added", text: afterChanged });
  if (suffix) fragments.push({ kind: "shared", text: suffix });
  return fragments;
}

/**
 * Merges the production word-level line segments, then refines each changed
 * token by character so `formatPrice` → `formatAmount` keeps `format` normal.
 */
export function buildInlineLineFragments(
  before: readonly DiffSegmentLike[] | undefined,
  after: readonly DiffSegmentLike[] | undefined,
  fallbackBefore: string,
  fallbackAfter: string,
): InlineDiffFragment[] {
  const fallback = () =>
    markReplacementAdditions(buildInlineDiffFragments(fallbackBefore, fallbackAfter));
  if (!before || !after) return fallback();
  const fragments: InlineDiffFragment[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length || afterIndex < after.length) {
    const left = before[beforeIndex];
    const right = after[afterIndex];
    if (left && right && !left.changed && !right.changed && left.text === right.text) {
      appendFragment(fragments, { kind: "shared", text: left.text });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (left?.changed && right?.changed) {
      appendChangedSegmentFragments(fragments, left.text, right.text);
      beforeIndex += 1;
      afterIndex += 1;
    } else if (left?.changed) {
      appendFragment(fragments, { kind: "removed", text: left.text });
      beforeIndex += 1;
    } else if (right?.changed) {
      appendFragment(fragments, { kind: "added", text: right.text });
      afterIndex += 1;
    } else {
      return fallback();
    }
  }
  return preservesSourcePair(fragments, fallbackBefore, fallbackAfter) ? fragments : fallback();
}

/**
 * Treat a leading-indent adjustment independently from the code that follows
 * it. A wrapper such as `if` changes a statement's AST parent and commonly
 * adds indentation, but that must not make `foo()` look removed and re-added.
 *
 * We only take this path when the leading whitespace differs. Existing
 * production intraline segments remain authoritative for ordinary edits.
 */
export function buildIndentationAwareInlineLineFragments(
  before: readonly DiffSegmentLike[] | undefined,
  after: readonly DiffSegmentLike[] | undefined,
  fallbackBefore: string,
  fallbackAfter: string,
): InlineDiffFragment[] {
  const beforeIndent = leadingWhitespace(fallbackBefore);
  const afterIndent = leadingWhitespace(fallbackAfter);
  if (beforeIndent === afterIndent) {
    return buildInlineLineFragments(before, after, fallbackBefore, fallbackAfter);
  }

  const fragments: InlineDiffFragment[] = [];
  for (const fragment of buildInlineDiffFragments(beforeIndent, afterIndent)) {
    appendFragment(fragments, fragment);
  }

  const beforeCode = fallbackBefore.slice(beforeIndent.length);
  const afterCode = fallbackAfter.slice(afterIndent.length);
  const codeFragments = buildInlineDiffFragments(beforeCode, afterCode);
  const replacesCode = codeFragments.some((fragment) => fragment.kind === "removed");
  for (const fragment of codeFragments) {
    appendFragment(fragments, {
      ...fragment,
      kind: fragment.kind === "added" && replacesCode ? "replacement-added" : fragment.kind,
    });
  }
  return fragments;
}
