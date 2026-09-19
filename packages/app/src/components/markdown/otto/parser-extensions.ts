import type { MarkdownIt } from "markdown-it";
import { applyTaskListMarkers } from "../task-lists";
import { applyGithubAlerts } from "../github-alerts";
import { applyFootnotes } from "../footnotes";
import { applyMath } from "../math";
import { applyHtmlAnchors } from "../html-anchors";

/** Enrich the canonical assistant parser without changing its text or link policy. */
export function applyOttoAssistantMarkdownExtensions(parser: MarkdownIt): MarkdownIt {
  return applyMath(applyFootnotes(applyTaskListMarkers(parser)));
}

/**
 * Documents also recognize GitHub alerts, whose chrome the shared renderer
 * owns, and the explicit HTML anchors that document links can target.
 */
export function applyOttoDocumentMarkdownExtensions(parser: MarkdownIt): MarkdownIt {
  return applyHtmlAnchors(
    applyMath(applyFootnotes(applyGithubAlerts(applyTaskListMarkers(parser)))),
  );
}
