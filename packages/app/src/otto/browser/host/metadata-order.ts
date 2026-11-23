/** Ordering only; tab content stays in Paseo's canonical browser records. */
export class HostBrowserMetadataOrder {
  private readonly revisions = new Map<string, number>();
  accept(browserId: string, revision: number | undefined) {
    if (revision === undefined || !Number.isSafeInteger(revision) || revision < 0)
      throw new Error("The host did not return revisioned browser metadata.");
    const previous = this.revisions.get(browserId);
    if (previous !== undefined && revision <= previous) return false;
    this.revisions.set(browserId, revision);
    return true;
  }
}
