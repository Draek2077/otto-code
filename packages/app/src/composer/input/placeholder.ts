/**
 * Keeps the composer watermark on one line without abbreviating a caller's
 * placeholder before the input has a real layout measurement.
 */
export function resolveResponsivePlaceholder(input: {
  placeholder: string;
  compactPlaceholder: string | undefined;
  availableWidth: number;
  placeholderWidth: number;
}): string {
  if (
    !input.compactPlaceholder ||
    input.availableWidth <= 0 ||
    input.placeholderWidth <= input.availableWidth
  ) {
    return input.placeholder;
  }
  return input.compactPlaceholder;
}
