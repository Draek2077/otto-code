import { useEffect, useSyncExternalStore } from "react";
import { chooseSoftwareStepMs, DEFAULT_SOFTWARE_STEP_MS } from "@/components/continuous-motion";
import { useIsSoftwareCompositing } from "@/desktop/use-software-rendering";

// The step continuous indicators use while Chromium composites in software,
// sized to what this machine's full-window draw costs at the current window
// size (see continuous-motion.ts). One app-wide value: every instance must use
// the same step or their grids stop sharing frames.
//
// It is measured, not guessed: a short probe animates one 2px element every
// frame and compares the rAF interval against an idle one. Re-measured after
// a resize, because the cost of a software draw scales with window area.

const PROBE_FRAMES = 30;
const PROBE_START_DELAY_MS = 4_000;
const RESIZE_REPROBE_DELAY_MS = 1_500;

let stepMs = DEFAULT_SOFTWARE_STEP_MS;
let started = false;
let probing = false;
const listeners = new Set<() => void>();

function publish(next: number): void {
  if (next === stepMs) return;
  stepMs = next;
  for (const listener of listeners) listener();
}

function medianFrameIntervalMs(frames: number): Promise<number> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const tick = (time: number) => {
      stamps.push(time);
      if (stamps.length <= frames) {
        requestAnimationFrame(tick);
        return;
      }
      const gaps = stamps
        .slice(1)
        .map((value, index) => value - stamps[index])
        .sort((a, b) => a - b);
      resolve(gaps[Math.floor(gaps.length / 2)]);
    };
    requestAnimationFrame(tick);
  });
}

async function probe(): Promise<void> {
  // A hidden window has no frames to measure; the next resize or the next
  // visibility change retries.
  if (probing || document.visibilityState !== "visible") return;
  probing = true;
  const element = document.createElement("div");
  try {
    const idleFrameMs = await medianFrameIntervalMs(PROBE_FRAMES);
    element.setAttribute("aria-hidden", "true");
    element.style.cssText =
      "position:fixed;left:0;bottom:0;width:2px;height:2px;pointer-events:none;" +
      "background:rgba(128,128,128,0.02);z-index:2147483647";
    document.body.appendChild(element);
    // Composited opacity: any damage at all is a full software draw, which
    // is exactly the cost being measured.
    element.animate([{ opacity: 0.5 }, { opacity: 1 }], {
      duration: 200,
      iterations: Infinity,
      direction: "alternate",
    });
    const animatedFrameMs = await medianFrameIntervalMs(PROBE_FRAMES);
    publish(chooseSoftwareStepMs({ idleFrameMs, animatedFrameMs }));
  } finally {
    element.remove();
    probing = false;
  }
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  setTimeout(() => void probe(), PROBE_START_DELAY_MS);
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const reprobeSoon = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      void probe();
    }, RESIZE_REPROBE_DELAY_MS);
  };
  window.addEventListener("resize", reprobeSoon);
  document.addEventListener("visibilitychange", reprobeSoon);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getStepMs(): number {
  return stepMs;
}

/**
 * The step for continuous indicators while compositing in software, or null
 * when frames are GPU-composited and animations should run at full rate.
 */
export function useSoftwareMotionStepMs(): number | null {
  const softwareCompositing = useIsSoftwareCompositing();
  const current = useSyncExternalStore(subscribe, getStepMs, getStepMs);
  useEffect(() => {
    if (softwareCompositing) start();
  }, [softwareCompositing]);
  return softwareCompositing ? current : null;
}
