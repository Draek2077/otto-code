/** Temporary, in-memory directives collected while reviewing a Knowledge article. */
export type KnowledgeReviewDirective =
  | {
      id: string;
      kind: "replace";
      selectedText: string;
      beforeContext: string;
      afterContext: string;
      value: string;
    }
  | {
      id: string;
      kind: "refine";
      selectedText: string;
      beforeContext: string;
      afterContext: string;
      value: string;
    };

export function buildKnowledgeReviewInstruction(
  directives: readonly KnowledgeReviewDirective[],
): string {
  const refine = directives.filter((directive) => directive.kind === "refine");
  const replacements = directives.filter((directive) => directive.kind === "replace");
  return [
    "Refine this Project Knowledge article while preserving its Markdown structure and factual scope.",
    replacements.length
      ? "The exact replacements below are already applied in the source. Preserve their replacement text verbatim."
      : "",
    ...replacements.map((directive) => `- Exact replacement: ${JSON.stringify(directive.value)}`),
    refine.length ? "Apply these targeted editorial directions:" : "",
    ...refine.map(
      (directive) => `- For ${JSON.stringify(directive.selectedText)}: ${directive.value.trim()}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Direct replacements are made before the model sees the article. Context is
 * stored beside the selected text, not a DOM range, so this stays independent
 * of Markdown renderer structure. An ambiguous match is rejected rather than
 * silently replacing the wrong repeated phrase.
 */
export function applyDirectReplacements(
  source: string,
  directives: readonly KnowledgeReviewDirective[],
): { content: string; error: string | null } {
  let content = source;
  for (const directive of directives) {
    if (directive.kind !== "replace") continue;
    const candidates: number[] = [];
    let from = 0;
    while (true) {
      const index = content.indexOf(directive.selectedText, from);
      if (index < 0) break;
      const before = content.slice(Math.max(0, index - directive.beforeContext.length), index);
      const after = content.slice(
        index + directive.selectedText.length,
        index + directive.selectedText.length + directive.afterContext.length,
      );
      if (
        (!directive.beforeContext || before.endsWith(directive.beforeContext)) &&
        (!directive.afterContext || after.startsWith(directive.afterContext))
      ) {
        candidates.push(index);
      }
      from = index + directive.selectedText.length;
    }
    if (candidates.length !== 1) {
      return {
        content: source,
        error: "A replacement no longer identifies one exact passage. Re-select it.",
      };
    }
    const index = candidates[0];
    content = `${content.slice(0, index)}${directive.value}${content.slice(index + directive.selectedText.length)}`;
  }
  return { content, error: null };
}
