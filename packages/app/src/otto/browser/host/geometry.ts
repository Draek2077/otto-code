export function hostTouchPhase(count: number, added: boolean) {
  if (!count) return "end";
  return added ? "start" : "move";
}
export function hostPointerPhase(type: string) {
  if (type === "pointerdown") return "down";
  return type === "pointerup" ? "up" : "move";
}
export function hostWheelScale(mode: number, height: number) {
  if (mode === 1) return 16;
  return mode === 2 ? height : 1;
}
export function hostPagePoint(input: {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  clamp?: boolean;
}): { x: number; y: number } | null {
  const { x, y, width, height, viewportWidth, viewportHeight } = input;
  if (
    ![x, y, width, height, viewportWidth, viewportHeight].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  )
    return null;
  const scale = Math.min(width / viewportWidth, height / viewportHeight),
    left = (width - viewportWidth * scale) / 2,
    top = (height - viewportHeight * scale) / 2,
    pageX = (x - left) / scale,
    pageY = (y - top) / scale;
  if (!input.clamp && (pageX < 0 || pageY < 0 || pageX > viewportWidth || pageY > viewportHeight))
    return null;
  return {
    x: Math.max(0, Math.min(viewportWidth, pageX)),
    y: Math.max(0, Math.min(viewportHeight, pageY)),
  };
}
