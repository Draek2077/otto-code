export function getCenteredOptionScrollOffset(input: {
  optionTop: number;
  optionHeight: number;
  viewportHeight: number;
}): number {
  const { optionTop, optionHeight, viewportHeight } = input;
  return Math.max(0, optionTop - (viewportHeight - optionHeight) / 2);
}
