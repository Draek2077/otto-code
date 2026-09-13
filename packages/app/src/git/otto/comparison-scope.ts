/** Independent Otto Changes surfaces share the stable comparison store, not selections. */
export function withOttoComparisonScope(checkoutKey: string, modeScope?: string): string {
  return modeScope === undefined
    ? checkoutKey
    : `${checkoutKey}:surface=${encodeURIComponent(modeScope)}`;
}
