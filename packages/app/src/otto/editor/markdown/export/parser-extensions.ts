import type MarkdownIt from "markdown-it";
import { applyTaskListMarkers } from "./task-lists";
import { applyGithubAlerts } from "./github-alerts";
import { applyFootnotes } from "./footnotes";
import { applyMath } from "./math";
import { applyHtmlAnchors } from "./html-anchors";

/**
 * Export-only grammar restored from Otto. The live viewer and chat remain on
 * Paseo's current Markdown engine; these rules are not installed into either.
 */
export function applyOttoDocumentMarkdownExtensions(parser: MarkdownIt): MarkdownIt {
  return applyHtmlAnchors(
    applyMath(applyFootnotes(applyGithubAlerts(applyTaskListMarkers(parser)))),
  );
}
