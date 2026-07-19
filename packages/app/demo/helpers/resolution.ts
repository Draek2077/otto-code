/**
 * Shared desktop capture resolution — 16:9 QHD, the highest-quality source
 * size the pipeline captures at (site delivery can downscale from here later;
 * capture never upscales). This is the *physical output* size: the pixel
 * dimensions of the PNGs/video, and the Electron lane's resize target (see
 * e2e/helpers/image.ts's resizePngToTarget).
 */
export const DESKTOP_CAPTURE_RESOLUTION = { width: 2560, height: 1440 } as const;

/** Fallback UI zoom when DEMO_ZOOM isn't set (the interactive tool sets it). */
export const DEFAULT_DESKTOP_CAPTURE_SCALE = 2.5;

/**
 * Ceiling for the zoom. Logical width is 2560 ÷ scale, and the app flips to its
 * compact/mobile layout (split panes gone, sidebars overlaid) below the `md`
 * breakpoint of 768px — see src/constants/layout.ts. 2560 ÷ 768 ≈ 3.33, so this
 * is the point past which a desktop capture stops being a desktop layout.
 */
export const MAX_DESKTOP_CAPTURE_SCALE = 3.3;

function resolveCaptureScale(): number {
  const raw = process.env.DEMO_ZOOM;
  if (!raw) return DEFAULT_DESKTOP_CAPTURE_SCALE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DESKTOP_CAPTURE_SCALE;
  // Clamp so a hand-set DEMO_ZOOM can't silently collapse the desktop layout.
  return Math.min(Math.max(parsed, 1), MAX_DESKTOP_CAPTURE_SCALE);
}

/**
 * Effective UI zoom for the desktop lanes, and the device-scale factor they
 * capture at. Chosen at run time via the DEMO_ZOOM env var (the `npm run
 * demo:run` picker sets it); defaults to DEFAULT_DESKTOP_CAPTURE_SCALE.
 *
 * The window lays out at DESKTOP_LAYOUT_VIEWPORT (logical CSS pixels = output ÷
 * this) but every pixel is captured at this multiple, so the app renders bigger
 * while the output still lands at full DESKTOP_CAPTURE_RESOLUTION. Higher =
 * bigger UI, but less content on screen and less logical *height* (2.5 → 576,
 * 3.0 → 480). Do NOT capture at scale 1 with the viewport set to the output
 * resolution — the app then lays out as if on a giant screen, every control
 * tiny. See MAX_DESKTOP_CAPTURE_SCALE for the ceiling.
 */
export const DESKTOP_CAPTURE_SCALE = resolveCaptureScale();

/**
 * Logical (CSS-pixel) viewport for the desktop lanes: the output resolution
 * divided by the capture scale (rounded to whole pixels). At 2.5× this is
 * 1024×576 — the app lays out at that density and captures at
 * DESKTOP_CAPTURE_SCALE to reach DESKTOP_CAPTURE_RESOLUTION. Used as the
 * Playwright browser viewport for the web lane and the real window size (DIP)
 * for the Electron lane.
 */
export const DESKTOP_LAYOUT_VIEWPORT = {
  width: Math.round(DESKTOP_CAPTURE_RESOLUTION.width / DESKTOP_CAPTURE_SCALE),
  height: Math.round(DESKTOP_CAPTURE_RESOLUTION.height / DESKTOP_CAPTURE_SCALE),
} as const;
