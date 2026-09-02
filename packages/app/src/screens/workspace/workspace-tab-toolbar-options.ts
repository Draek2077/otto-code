export function shouldRevealTabToolbarOptions({
  hideTabToolbarOptions,
  isCompact,
  isToolbarActive,
  isNative,
  rowHovered,
}: {
  hideTabToolbarOptions: boolean;
  isCompact: boolean;
  isToolbarActive: boolean;
  isNative: boolean;
  rowHovered: boolean;
}): boolean {
  return !hideTabToolbarOptions || isNative || isCompact || rowHovered || isToolbarActive;
}
