export interface DomSourceTextRun {
  node: Text;
  start: number;
  end: number;
}

export function collectDomSourceTextRuns(
  root: HTMLElement,
  sourceRuns: readonly { text: string; start: number; end: number }[],
): DomSourceTextRun[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const mapped: DomSourceTextRun[] = [];
  let sourceIndex = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const value = node.textContent ?? "";
    if (!value) continue;
    // The rendered article also contains labels and transformed Markdown
    // constructs which have no one-to-one source text node. An unmatched node
    // must not poison every later selection: resume at the next matching raw
    // source run while preserving document order for repeated phrases.
    const matchIndex = sourceRuns.findIndex(
      (source, index) => index >= sourceIndex && source.text === value,
    );
    if (matchIndex === -1) continue;
    const source = sourceRuns[matchIndex];
    if (!source) continue;
    mapped.push({ node: node as Text, start: source.start, end: source.end });
    sourceIndex = matchIndex + 1;
  }
  return mapped;
}

/** Resolve a rendered selection to the exact raw Markdown span it represents. */
export function findSourceAnchorForDomRange(
  root: HTMLElement,
  range: Range,
  sourceRuns: readonly { text: string; start: number; end: number }[],
): { start: number; end: number } | null {
  const runs = collectDomSourceTextRuns(root, sourceRuns);
  const start = resolveSourceBoundary(runs, range.startContainer, range.startOffset, "start");
  const end = resolveSourceBoundary(runs, range.endContainer, range.endOffset, "end");
  if (!start || !end) return null;
  const sourceStart = start.run.start + start.offset;
  const sourceEnd = end.run.start + end.offset;
  if (sourceEnd <= sourceStart) return null;
  return { start: sourceStart, end: sourceEnd };
}

/**
 * Browser selections do not always start and end in text nodes. A drag that
 * begins or finishes at an inline element boundary reports that parent element
 * and a child index instead. Resolve those boundary points to the adjacent
 * mapped text run so a prior highlight never makes the next selection appear
 * to be outside the editable Markdown.
 */
function resolveSourceBoundary(
  runs: readonly DomSourceTextRun[],
  container: Node,
  offset: number,
  edge: "start" | "end",
): { run: DomSourceTextRun; offset: number } | null {
  const direct = runs.find((entry) => entry.node === container);
  if (direct) {
    return { run: direct, offset: Math.max(0, Math.min(offset, direct.node.length)) };
  }

  const first = edge === "start" ? 0 : runs.length - 1;
  const increment = edge === "start" ? 1 : -1;
  for (let index = first; index >= 0 && index < runs.length; index += increment) {
    const run = runs[index];
    if (!run) continue;
    const textRange = document.createRange();
    textRange.selectNodeContents(run.node);
    const position = textRange.comparePoint(container, offset);
    if ((edge === "start" && position !== 1) || (edge === "end" && position !== -1)) {
      return { run, offset: edge === "start" ? 0 : run.node.length };
    }
  }
  return null;
}

export function findDomRangeForSourceAnchor(
  root: HTMLElement,
  anchor: { start: number; end: number },
  sourceRuns: readonly { text: string; start: number; end: number }[],
): Range | null {
  const runs = collectDomSourceTextRuns(root, sourceRuns);
  const start = runs.find((entry) => anchor.start >= entry.start && anchor.start <= entry.end);
  const end = runs.find((entry) => anchor.end >= entry.start && anchor.end <= entry.end);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, anchor.start - start.start);
  range.setEnd(end.node, anchor.end - end.start);
  return range;
}
