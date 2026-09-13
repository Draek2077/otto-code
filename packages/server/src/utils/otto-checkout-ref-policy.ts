/** Local base names may resolve to origin after its fork point moves; explicit refs stay pinned. */
export function getOttoComparisonRefCandidates(
  refs: ReadonlyArray<string | null | undefined>,
): string[] {
  return refs.flatMap((ref) => {
    if (!ref) return [];
    if (ref.startsWith("refs/remotes/")) return [ref.slice("refs/remotes/".length)];
    if (ref.startsWith("refs/") || ref.startsWith("origin/")) return [ref];
    return [ref, `origin/${ref}`];
  });
}
