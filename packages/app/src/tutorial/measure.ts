import { Platform, StatusBar } from "react-native";
import { getTutorialAnchorNode, type TutorialAnchorId } from "./anchor-registry";
import type { Rect } from "./types";

export interface MeasureCancelToken {
  cancelled: boolean;
}

const DEFAULT_TIMEOUT_MS = 1500;

function androidStatusBarOffset(): number {
  // Matches the anchor→portal convention used by tooltip.tsx: on Android,
  // measureInWindow reports below the translucent status bar, so add its height
  // to land in the full-screen overlay's coordinate space. No-op elsewhere.
  return Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
}

function measureOnce(id: TutorialAnchorId): Promise<Rect | null> {
  const node = getTutorialAnchorNode(id);
  if (!node) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    node.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        resolve({ x, y: y + androidStatusBarOffset(), width, height });
      } else {
        resolve(null);
      }
    });
  });
}

function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// Waits for an anchor to mount (after navigation/panel animation) and settle,
// then returns its window-space rect. Requires two consecutive equal non-zero
// measurements so we never snapshot mid-animation. Polls until timeout; returns
// null if the anchor never became measurable (caller decides skip vs. centered
// fallback). Honors a cancel token so a superseded step stops measuring.
export function measureAnchorWithRetry(
  id: TutorialAnchorId,
  opts: { timeoutMs?: number; cancel?: MeasureCancelToken } = {},
): Promise<Rect | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let prev: Rect | null = null;

  return new Promise((resolve) => {
    const tick = async () => {
      if (opts.cancel?.cancelled) {
        resolve(null);
        return;
      }
      const rect = await measureOnce(id);
      if (opts.cancel?.cancelled) {
        resolve(null);
        return;
      }
      if (rect && prev && rectsEqual(rect, prev)) {
        resolve(rect);
        return;
      }
      prev = rect;
      if (Date.now() >= deadline) {
        resolve(rect);
        return;
      }
      requestAnimationFrame(() => void tick());
    };
    requestAnimationFrame(() => void tick());
  });
}
