import type { MarkdownIt } from "markdown-it";
import { applyTaskListMarkers } from "../task-lists";
import { applyGithubAlerts } from "../github-alerts";
import { applyFootnotes } from "../footnotes";
import { applyMath } from "../math";

/** Enrich the canonical assistant parser without changing its text or link policy. */
export function applyOttoAssistantMarkdownExtensions(parser: MarkdownIt): MarkdownIt {
  return applyMath(applyFootnotes(applyTaskListMarkers(parser)));
}

/** Documents also recognize GitHub alerts; their shared renderer owns alert chrome. */
export function applyOttoDocumentMarkdownExtensions(parser: MarkdownIt): MarkdownIt {
  return applyMath(applyFootnotes(applyGithubAlerts(applyTaskListMarkers(parser))));
}
