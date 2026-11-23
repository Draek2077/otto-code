export interface PageFindRequest {
  query: string;
  matchCase: boolean;
  matchDiacritics: boolean;
  wholeWords: boolean;
  highlightAll: boolean;
  direction: -1 | 0 | 1;
}
export interface PageFindResult {
  current: number;
  total: number;
  limited: boolean;
}

/** Self-contained: serialized into the existing browser guest, never the host document. */
export function runPageFind(request: PageFindRequest): PageFindResult {
  type HighlightWindow = Window & {
    CSS: { highlights: Map<string, unknown> };
    Highlight: new (...ranges: Range[]) => unknown;
    __ottoPageFind?: { key: string; index: number; cleanup: () => void };
  };
  const host = window as unknown as HighlightWindow;
  const previous = host.__ottoPageFind;
  previous?.cleanup();
  delete host.__ottoPageFind;
  const empty = { current: 0, total: 0, limited: false };
  if (!request.query) return empty;
  const matches: Range[] = [];
  const documents: Document[] = [];
  const styles: HTMLStyleElement[] = [];
  let limited = false;
  const normalize = (text: string) => {
    const decomposed = text.normalize("NFD");
    const accents = request.matchDiacritics ? decomposed : decomposed.replace(/\p{M}/gu, "");
    const folded = request.matchCase ? accents : accents.toLowerCase().replace(/ς/g, "σ");
    return folded.replace(/\s+/gu, " ");
  };
  const needle = normalize(request.query);
  if (!needle) return empty;
  const wordCharacter = /[\p{L}\p{N}\p{M}_]/u;

  const indexText = (text: string) => {
    // Map normalized graphemes back to original UTF-16 offsets. Removing accents
    // and folding case can change length; raw string indices cannot become ranges.
    const starts: number[] = [];
    const ends: number[] = [];
    let folded = "";
    for (const segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      text,
    )) {
      const normalized = normalize(segment.segment);
      if (normalized === " " && folded.endsWith(" ")) {
        ends[ends.length - 1] = segment.index + segment.segment.length;
        continue;
      }
      folded += normalized;
      for (let i = 0; i < normalized.length; i++) {
        starts.push(segment.index);
        ends.push(segment.index + segment.segment.length);
      }
    }
    return { starts, ends, folded };
  };

  const searchRoot = (root: Node, doc: Document) => {
    const nodes: { node: Text; start: number; end: number }[] = [];
    let text = "";
    const visit = (node: Node) => {
      if (text.length > 2_000_000) {
        limited = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent ?? "";
        nodes.push({ node: node as Text, start: text.length, end: text.length + value.length });
        text += value;
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        if (
          ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SELECT", "TEXTAREA"].includes(
            element.tagName,
          )
        )
          return;
        const style = doc.defaultView!.getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse"
        )
          return;
        const block = !["inline", "contents"].includes(style.display) || element.tagName === "BR";
        if (block) text += "\n";
        if (element.shadowRoot) searchRoot(element.shadowRoot, doc);
        if (element.tagName === "IFRAME") {
          try {
            const frame = (element as HTMLIFrameElement).contentDocument;
            if (frame?.body) searchDocument(frame);
          } catch {
            /* Cross-origin frames remain isolated. */
          }
        }
        for (const child of node.childNodes) visit(child);
        if (block) text += "\n";
        return;
      }
      for (const child of node.childNodes) visit(child);
    };
    visit(root);
    const { starts, ends, folded } = indexText(text);
    let offset = 0;
    let nodeIndex = 0;
    while ((offset = folded.indexOf(needle, offset)) !== -1) {
      const end = offset + needle.length;
      const before = Array.from(folded.slice(Math.max(0, offset - 2), offset)).at(-1) ?? "";
      const after = String.fromCodePoint(folded.codePointAt(end) ?? 32);
      const whole =
        !request.wholeWords || (!wordCharacter.test(before) && !wordCharacter.test(after));
      if (whole) {
        const startOffset = starts[offset]!;
        const endOffset = ends[end - 1]!;
        while (nodeIndex < nodes.length && nodes[nodeIndex]!.end <= startOffset) nodeIndex++;
        const first = nodes[nodeIndex];
        let lastIndex = nodeIndex;
        while (lastIndex < nodes.length && nodes[lastIndex]!.end < endOffset) lastIndex++;
        const last = nodes[lastIndex];
        if (first && last && first.start <= startOffset && last.start < endOffset) {
          const range = doc.createRange();
          range.setStart(first.node, startOffset - first.start);
          range.setEnd(last.node, endOffset - last.start);
          if (range.getClientRects().length) matches.push(range);
        }
      }
      if (matches.length >= 10_000) {
        limited = true;
        break;
      }
      offset = end;
    }
  };
  const searchDocument = (doc: Document) => {
    if (documents.includes(doc)) return;
    documents.push(doc);
    searchRoot(doc.body, doc);
  };
  searchDocument(document);
  const key = JSON.stringify([
    request.query,
    request.matchCase,
    request.matchDiacritics,
    request.wholeWords,
  ]);
  let index = request.direction === -1 ? matches.length - 1 : 0;
  if (previous?.key === key) index = previous.index + request.direction;
  index = matches.length ? (index + matches.length) % matches.length : -1;
  for (const doc of documents) {
    const target = doc.defaultView as unknown as HighlightWindow;
    const all = matches.filter((range) => range.startContainer.ownerDocument === doc);
    const active = matches[index];
    const style = doc.createElement("style");
    style.textContent =
      "::highlight(otto-page-find-all){background:#ffe082;color:#181818}::highlight(otto-page-find-active){background:#ff9632;color:#181818}";
    doc.documentElement.appendChild(style);
    styles.push(style);
    if (request.highlightAll)
      target.CSS.highlights.set("otto-page-find-all", new target.Highlight(...all));
    if (active?.startContainer.ownerDocument === doc) {
      target.CSS.highlights.set("otto-page-find-active", new target.Highlight(active));
      active.startContainer.parentElement?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant",
      });
    }
  }
  host.__ottoPageFind = {
    key,
    index,
    cleanup: () => {
      for (const doc of documents) {
        const target = doc.defaultView as unknown as HighlightWindow | null;
        target?.CSS.highlights.delete("otto-page-find-all");
        target?.CSS.highlights.delete("otto-page-find-active");
      }
      for (const style of styles) style.remove();
    },
  };
  return { current: index + 1, total: matches.length, limited };
}

export function buildPageFindScript(request: PageFindRequest): string {
  return `(${runPageFind.toString()})(${JSON.stringify(request)})`;
}
