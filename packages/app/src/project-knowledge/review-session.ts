/** Exact, editable Markdown owned by one temporary review directive. */
export type KnowledgeReviewAnchor =
  | { kind: "text"; start: number; end: number; label: string }
  | { kind: "fence"; start: number; end: number; label: string; language: string | null };

/** Temporary, in-memory directives collected while reviewing a Knowledge article. */
export interface KnowledgeReviewDirective {
  id: string;
  kind: "replace" | "refine";
  anchor: KnowledgeReviewAnchor;
  value: string;
}

/** The source pinned while a temporary in-place proposal is being reviewed. */
export type KnowledgeReviewTarget =
  | { kind: "record"; id: string; title: string; expectedUpdatedAt: string }
  | { kind: "root"; slug: string; title: string; expectedBodyDigest?: string };

/** A proposal belongs to the current Knowledge article, never to a workspace tab. */
export interface KnowledgeReviewProposal {
  target: KnowledgeReviewTarget;
  /** Source sent to the model and later committed after the reader accepts. */
  base: string;
  proposal: string;
  /** Clean, reader-facing source for the diff when the stored source has field sentinels. */
  displayBase?: string;
  displayProposal?: string;
}

/**
 * Direct replacements are made before the model sees the article, in reverse
 * source order so every anchor remains exact even when the replacement lengths
 * differ. Refinement anchors are then shifted into that updated article.
 */
export function applyDirectReplacements(
  source: string,
  directives: readonly KnowledgeReviewDirective[],
): {
  content: string;
  refinements: KnowledgeReviewDirective[];
  error: string | null;
} {
  const ordered = [...directives].sort((left, right) => left.anchor.start - right.anchor.start);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous && current && previous.anchor.end > current.anchor.start) {
      return {
        content: source,
        refinements: [],
        error: "Two review notes overlap. Remove one before generating a proposal.",
      };
    }
  }
  let content = source;
  const replacements = ordered.filter((directive) => directive.kind === "replace");
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const directive = replacements[index];
    if (!directive) continue;
    if (
      directive.anchor.start < 0 ||
      directive.anchor.end <= directive.anchor.start ||
      directive.anchor.end > source.length
    ) {
      return {
        content: source,
        refinements: [],
        error: "A review note no longer identifies editable article source. Re-select it.",
      };
    }
    content = `${content.slice(0, directive.anchor.start)}${directive.value}${content.slice(directive.anchor.end)}`;
  }
  const refinements: KnowledgeReviewDirective[] = [];
  for (const directive of ordered) {
    if (directive.kind !== "refine") continue;
    refinements.push({
      id: directive.id,
      kind: directive.kind,
      anchor: shiftAnchorAfterReplacements(directive.anchor, replacements),
      value: directive.value,
    });
  }
  return { content, refinements, error: null };
}

function shiftAnchorAfterReplacements(
  anchor: KnowledgeReviewAnchor,
  replacements: readonly KnowledgeReviewDirective[],
): KnowledgeReviewAnchor {
  const shift = replacements.reduce((total, directive) => {
    if (directive.anchor.end > anchor.start) return total;
    return total + directive.value.length - (directive.anchor.end - directive.anchor.start);
  }, 0);
  return { ...anchor, start: anchor.start + shift, end: anchor.end + shift };
}
