/**
 * Shared desktop capture resolution - 16:9 QHD, the highest-quality source
 * size the pipeline captures at (site delivery can downscale from here later;
 * capture never upscales). This is the *physical output* size: the pixel
 * dimensions of the PNGs/video, and the Electron lane's resize target (see
 * e2e/helpers/image.ts's resizePngToTarget).
 */
function resolveCaptureDimension(
  name: "DEMO_CAPTURE_WIDTH" | "DEMO_CAPTURE_HEIGHT" | "DEMO_LAYOUT_WIDTH" | "DEMO_LAYOUT_HEIGHT",
  fallback: number,
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 768 ? parsed : fallback;
}

/**
 * Physical output size for the desktop capture lanes. The QHD default is the
 * pipeline contract; an explicitly paired `DEMO_CAPTURE_WIDTH` /
 * `DEMO_CAPTURE_HEIGHT` is reserved for a one-off deliverable such as the
 * website hero and never changes other runs.
 */
export const DESKTOP_CAPTURE_RESOLUTION = {
  width: resolveCaptureDimension("DEMO_CAPTURE_WIDTH", 2560),
  height: resolveCaptureDimension("DEMO_CAPTURE_HEIGHT", 1440),
} as const;

/**
 * Logical desktop viewport for every staged desktop capture. 1536×864 is the
 * usable canvas of a 3840×2160 monitor at 250% Windows display scaling: real
 * desktop density, three-pane layouts intact, and no tiny-QHD UI.
 */
export const DESKTOP_LAYOUT_VIEWPORT = {
  width: resolveCaptureDimension("DEMO_LAYOUT_WIDTH", 1536),
  height: resolveCaptureDimension("DEMO_LAYOUT_HEIGHT", 864),
} as const;

/** Turns the fixed logical canvas into the requested web-capture output. */
export const DESKTOP_CAPTURE_SCALE =
  DESKTOP_CAPTURE_RESOLUTION.width / DESKTOP_LAYOUT_VIEWPORT.width;
