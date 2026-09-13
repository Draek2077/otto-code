import { createMarkdownParser } from "@/utils/markdown-parser";
import { applyOttoDocumentMarkdownExtensions } from "./otto/parser-extensions";

/**
 * The markdown-it instance every rendered document is parsed with.
 *
 * Its own module rather than a const inside `renderer.tsx` because two kinds
 * of caller need it and only one of them can load a file full of JSX: the
 * renderer, and find-in-preview, which has to reason about the text the
 * renderer will show. A lookalike instance would tokenize slightly differently
 * as soon as one of these plugins changed, and find would quietly stop
 * agreeing with the document it is searching.
 */
export const defaultMarkdownParser = applyOttoDocumentMarkdownExtensions(
  createMarkdownParser({ linkify: true }),
);
