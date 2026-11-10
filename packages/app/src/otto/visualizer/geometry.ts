export interface VisualizerSize {
  width: number;
  height: number;
}
export interface VisualizerPosition {
  x: number;
  y: number;
}
export interface VisualizerAnchor {
  horizontal: "left" | "right";
  vertical: "top" | "bottom";
  x: number;
  y: number;
}
const clamp = (value: number, max: number) =>
  Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
export function visualizerPipSize(
  size: "small" | "medium",
  window: VisualizerSize,
): VisualizerSize {
  const width = size === "small" ? 280 : 420;
  const height = size === "small" ? 190 : 280;
  return {
    width: Math.min(width, Math.max(1, window.width - 16)),
    height: Math.min(height, Math.max(1, window.height - 16)),
  };
}
export function visualizerAnchor(
  position: VisualizerPosition,
  window: VisualizerSize,
  size: VisualizerSize,
): VisualizerAnchor {
  const freeX = Math.max(0, window.width - size.width),
    freeY = Math.max(0, window.height - size.height);
  const x = clamp(position.x, freeX),
    y = clamp(position.y, freeY);
  return {
    horizontal: x > freeX / 2 ? "right" : "left",
    vertical: y > freeY / 2 ? "bottom" : "top",
    x: Math.min(x, freeX - x),
    y: Math.min(y, freeY - y),
  };
}
export function resolveVisualizerAnchor(
  anchor: VisualizerAnchor,
  window: VisualizerSize,
  size: VisualizerSize,
): VisualizerPosition {
  const freeX = Math.max(0, window.width - size.width),
    freeY = Math.max(0, window.height - size.height);
  return {
    x: clamp(anchor.horizontal === "right" ? freeX - anchor.x : anchor.x, freeX),
    y: clamp(anchor.vertical === "bottom" ? freeY - anchor.y : anchor.y, freeY),
  };
}
