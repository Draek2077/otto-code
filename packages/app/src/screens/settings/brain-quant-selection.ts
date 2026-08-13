/** The quant the picker should initially expose for a repository. */
export interface QuantSelectionCandidate {
  quant: string;
  installed: boolean;
}

interface QuantPullJob {
  kind: string;
  target: string | null;
}

/**
 * An active download owns the picker until it settles. Otherwise, reopen on an
 * installed quant before falling back to the catalog's curated default. This
 * keeps the primary action meaningful (Delete rather than Download) and makes
 * bundle controls act on the quant the picker visibly selected.
 */
export function selectInitialBrainQuant(
  quants: QuantSelectionCandidate[],
  initialQuant: string | null,
  activeQuant: string | null,
): string | null {
  if (activeQuant) return activeQuant;
  return quants.find((quant) => quant.installed)?.quant ?? initialQuant;
}

/**
 * A pull from a sibling quant must not turn this quant's Download button into
 * Cancel. Before selection, any repository pull is useful for restoring the
 * picker after remount; once selected, only that quant owns its controls.
 */
export function activeBrainQuantJob<T extends QuantPullJob>(
  jobs: T[],
  repo: string,
  selectedQuant: string | null,
  jobTarget: string | null,
): T | undefined {
  if (jobTarget) return jobs.find((job) => job.kind === "pull" && job.target === jobTarget);
  const target = selectedQuant ? `${repo}#${selectedQuant}` : null;
  return jobs.find(
    (job) =>
      job.kind === "pull" &&
      (target ? job.target === target : (job.target?.startsWith(`${repo}#`) ?? false)),
  );
}
