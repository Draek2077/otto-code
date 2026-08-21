/**
 * Keeps the no-truncation contract for tool-call activity labels explicit and
 * shared by native and web render paths.
 */
export function resolveToolCallTextLayout(wrapToolCallText: boolean): {
  wrap: boolean;
  numberOfLines: number | undefined;
} {
  return {
    wrap: wrapToolCallText,
    numberOfLines: wrapToolCallText ? undefined : 1,
  };
}
