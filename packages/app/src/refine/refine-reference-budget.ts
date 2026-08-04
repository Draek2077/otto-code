// Choosing which read-only context files to send with a refine request.
//
// A caller like Context Management knows a lot of files that are *relevant* -
// the whole context graph - and sending all of them would routinely blow the
// daemon's whole-request size ceiling, failing the round with an error the user
// cannot act on (the working-set chips change a file's role, they do not remove
// it from the set).
//
// So the seed is budgeted here instead, deterministically: smallest first, until
// the budget is spent. Smallest-first is the right greedy rule for this job
// because reference value is roughly per-file rather than per-byte - knowing
// that `docs/hover.md` exists and what it covers is most of the benefit, and ten
// short docs tell the model more about a project than one long one.

export interface RefineReferenceCandidate {
  path: string;
  /** On-disk size. The context report already carries this per node. */
  bytes: number;
}

/**
 * Half the daemon's per-request ceiling, so the documents being rewritten always
 * have room. References are the expendable half of the request: losing one
 * costs context, losing the document being rewritten costs the job.
 */
export const DEFAULT_REFINE_REFERENCE_BUDGET_BYTES = 60_000;

/** Enough files to describe a project; past this the marginal one adds noise. */
export const MAX_REFINE_REFERENCES = 12;

export function selectReferencesWithinBudget(
  candidates: readonly RefineReferenceCandidate[],
  budgetBytes: number = DEFAULT_REFINE_REFERENCE_BUDGET_BYTES,
  maxCount: number = MAX_REFINE_REFERENCES,
): string[] {
  const ordered = [...candidates]
    .filter((candidate) => candidate.path.trim().length > 0)
    // Ties break on path so the seeded set is stable between runs - a working
    // set that reshuffles per round would make two rounds incomparable.
    .sort((left, right) => left.bytes - right.bytes || left.path.localeCompare(right.path));

  const chosen: string[] = [];
  let spent = 0;
  for (const candidate of ordered) {
    if (chosen.length >= maxCount) {
      break;
    }
    const size = Math.max(0, candidate.bytes);
    if (spent + size > budgetBytes) {
      // Keep going rather than stopping: a later, smaller file may still fit,
      // and skipping it would drop context for no gain.
      continue;
    }
    chosen.push(candidate.path);
    spent += size;
  }
  return chosen;
}
