import MarkdownIt from "markdown-it";
import { applyTaskListMarkers } from "./task-lists";
import { applyGithubAlerts } from "./github-alerts";
import { applyFootnotes } from "./footnotes";
import { applyMath } from "./math";

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
export const defaultMarkdownParser = applyMath(
  applyFootnotes(
    applyGithubAlerts(applyTaskListMarkers(MarkdownIt({ typographer: true, linkify: true }))),
  ),
);
