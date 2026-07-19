import { writeFile } from "node:fs/promises";
import sharp from "sharp";

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Normalizes a captured PNG to an exact target resolution. Real OS window
 * captures (Electron's desktopCapturer, or a CDP page.screenshot() of a
 * native Electron window) reflect the capturing machine's actual display
 * scale factor — a window whose content area was set to WxH can come back
 * 2x, 1.5x, or whatever that machine's DPI setting is, not the logical size
 * (unlike a Playwright-driven browser context, which always renders at
 * exactly its configured viewport regardless of the host's display scaling).
 * Resizing down to an explicit target keeps demo output pixel-consistent
 * across different capture machines instead of baking in one machine's DPI.
 * No-ops if the file is already exactly the target size.
 */
export async function resizePngToTarget(pngPath: string, target: ImageSize): Promise<ImageSize> {
  const current = await sharp(pngPath).metadata();
  if (current.width === target.width && current.height === target.height) {
    return { width: current.width ?? target.width, height: current.height ?? target.height };
  }
  const resizedBuffer = await sharp(pngPath).resize(target.width, target.height).png().toBuffer();
  await writeFile(pngPath, resizedBuffer);
  return target;
}
