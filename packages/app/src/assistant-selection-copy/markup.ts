export const MARKDOWN_COPY_TAG_ATTRIBUTE = "data-otto-markdown-tag";
export const MARKDOWN_COPY_IGNORE_ATTRIBUTE = "data-otto-markdown-ignore";
export const MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE = "data-otto-markdown-list-marker";
export const MARKDOWN_COPY_UNWRAP_ATTRIBUTE = "data-otto-markdown-unwrap";
export const MARKDOWN_COPY_LIST_START_ATTRIBUTE = "data-otto-markdown-list-start";
export const MARKDOWN_COPY_LANGUAGE_ATTRIBUTE = "data-otto-markdown-language";
export const MARKDOWN_COPY_ALIGN_ATTRIBUTE = "data-otto-markdown-align";

/**
 * Trailing line breaks, with any indentation that followed the last one.
 *
 * Both ways of copying code strip these, for the same reason: pasting a trailing
 * newline into a terminal runs the last line. A fence body always ends in one, and
 * ends in several when the author left blank lines before the closing fence; a
 * selection picks one up whenever it overshoots the end of a rendered line.
 */
export const TRAILING_CODE_LINE_BREAKS = /(\r?\n[ \t]*)+$/;

export const markdownCopyDataSet = {
  blockquote: { ottoMarkdownTag: "blockquote" },
  br: { ottoMarkdownTag: "br" },
  code: { ottoMarkdownTag: "code" },
  h1: { ottoMarkdownTag: "h1" },
  h2: { ottoMarkdownTag: "h2" },
  h3: { ottoMarkdownTag: "h3" },
  h4: { ottoMarkdownTag: "h4" },
  h5: { ottoMarkdownTag: "h5" },
  h6: { ottoMarkdownTag: "h6" },
  hr: { ottoMarkdownTag: "hr" },
  ignore: { ottoMarkdownIgnore: "true" },
  li: { ottoMarkdownTag: "li" },
  listMarker: { ottoMarkdownIgnore: "true", ottoMarkdownListMarker: "true" },
  ol: { ottoMarkdownTag: "ol" },
  p: { ottoMarkdownTag: "p" },
  pre: { ottoMarkdownTag: "pre" },
  s: { ottoMarkdownTag: "s" },
  strong: { ottoMarkdownTag: "strong" },
  em: { ottoMarkdownTag: "em" },
  table: { ottoMarkdownTag: "table" },
  tbody: { ottoMarkdownTag: "tbody" },
  td: { ottoMarkdownTag: "td" },
  th: { ottoMarkdownTag: "th" },
  thead: { ottoMarkdownTag: "thead" },
  tr: { ottoMarkdownTag: "tr" },
  ul: { ottoMarkdownTag: "ul" },
  unwrap: { ottoMarkdownUnwrap: "true" },
} as const;

export type MarkdownCopyInlineTag = "br" | "code" | "em" | "s" | "strong";

export function markdownCopyOrderedListDataSet(start: unknown) {
  return {
    ...markdownCopyDataSet.ol,
    ottoMarkdownListStart: String(start ?? 1),
  } as const;
}

export function markdownCopyCodeBlockDataSet(language: string | null | undefined) {
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  return {
    ...markdownCopyDataSet.pre,
    ...(fenceLanguage ? { ottoMarkdownLanguage: fenceLanguage } : {}),
  } as const;
}

export function markdownCopyTableCellDataSet(tag: "td" | "th", style: unknown) {
  const alignment =
    typeof style === "string"
      ? style.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]
      : null;
  return {
    ...markdownCopyDataSet[tag],
    ...(alignment ? { ottoMarkdownAlign: alignment.toLowerCase() } : {}),
  } as const;
}
